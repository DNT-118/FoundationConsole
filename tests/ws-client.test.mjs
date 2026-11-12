import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { ApiError } from '../src/api/request.ts'

// Exercise the real client with a controllable browser socket/clock and memory stores.
function client() {
  let seq = 0
  const timers = new Map(), sockets = []
  const clock = { setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms }); return id }, setInterval: () => ++seq }
  const clear = id => timers.delete(id)
  const store = state => ({ getState: () => state, subscribe: () => {} })
  const empty = store({ applyState() {}, applyError() {}, setStatus() {}, append() {}, reset() {} })
  const modules = {
    'zustand': { create: () => init => { let state; const set = patch => Object.assign(state, patch); state = init(set); return store(state) } },
    '@/store/authStore': { useAuthStore: store({ session: { username: 'test' } }) },
    '@/ws/stateStore': { useWsStateStore: empty }, '@/ws/eventsStore': { useWsEventsStore: empty }, '@/api/request': { ApiError },
    '@/ws/upstreamStore': { useUpstreamStore: empty },
  }
  class Socket {
    sent = []
    constructor() { sockets.push(this) }
    send(raw) { this.sent.push(JSON.parse(raw)) }
    close() { this.onclose?.() }
  }
  const exports = {}
  const source = readFileSync(new URL('../src/ws/hub.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(compiled, { exports, require: name => { assert.ok(modules[name], name); return modules[name] }, WebSocket: Socket, window: clock, clearTimeout: clear, clearInterval() {}, location: { protocol: 'http:', host: 'fixture' }, DOMException, console })
  return { hub: exports.wsHub, sockets, timers }
}

test('cancelled and timed-out queued commands are never sent on reconnect', async () => {
  const { hub, sockets, timers } = client()
  const abort = new AbortController()
  const cancelled = hub.call('a', '/control/broadcast', {}, abort.signal)
  abort.abort()
  await assert.rejects(cancelled, e => e.name === 'AbortError')
  const expired = hub.call('a', '/control/broadcast', {})
  for (const timer of [...timers.values()]) if (timer.ms === 45000) timer.fn()
  await assert.rejects(expired, /超时/)
  sockets[0].onopen()
  assert.equal(sockets[0].sent.filter(m => m.type === 'call').length, 0)
  hub.disconnect()
})

test('business results preserve messages; disconnect rejects pending commands without resending', async () => {
  const { hub, sockets } = client()
  const pending = hub.call('a', '/control/broadcast', {})
  sockets[0].onopen()
  const call = sockets[0].sent.find(m => m.type === 'call')
  sockets[0].onmessage({ data: JSON.stringify({ type: 'result', reqId: call.reqId, ok: true, status: 200, data: { success: true, message: 'broadcast sent', data: { duration_seconds: 5 } } }) })
  const result = await pending
  assert.equal(result.message, 'broadcast sent')
  assert.equal(result.data.duration_seconds, 5)
  const interrupted = hub.call('a', '/control/staffchat', {})
  sockets[0].onclose()
  await assert.rejects(interrupted, /断开/)
  assert.equal(sockets[0].sent.filter(m => m.type === 'call').length, 2)
  hub.disconnect()
})
