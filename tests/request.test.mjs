import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requestJson, ApiError } from '../src/api/request.ts'

test('a failed or timed-out control request is never replayed', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('{"success":false,"message":"denied"}', { status: 502 }) })
  await assert.rejects(requestJson('/api/sl/call', { method: 'POST' }), e => e instanceof ApiError && e.status === 502)
  assert.equal(calls, 1)
})

test('response body reads are included in the request deadline', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => ({ text: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')))) }))
  await assert.rejects(requestJson('/api/sl/data', {}, 15), /请求超时/)
})

test('external abort stays cancellation and does not retry', async t => {
  const abort = new AbortController()
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))))
  const request = requestJson('/api/sl/data', { signal: abort.signal })
  abort.abort()
  await assert.rejects(request, e => e.name === 'AbortError')
})

test('invalid payloads and successful HTTP business errors remain errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{"success":false,"message":"not permitted"}'))
  await assert.rejects(requestJson('/api/sl/call'), /not permitted/)
  globalThis.fetch.mock.mockImplementation(async () => new Response('<html>gateway</html>', { status: 502 }))
  await assert.rejects(requestJson('/api/sl/data'), /有效 JSON/)
})
