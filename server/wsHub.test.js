const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { once } = require('node:events')
const { WebSocket, WebSocketServer } = require('ws')
const hub = require('./wsHub')
after(() => hub.shutdown())

function message(ws, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', onMessage); reject(new Error('message timeout')) }, 4000)
    function onMessage(raw) { const msg = JSON.parse(raw.toString()); if (predicate(msg)) { clearTimeout(timer); ws.off('message', onMessage); resolve(msg) } }
    ws.on('message', onMessage)
  })
}

test('PEAK WebSocket relay: concurrency, isolation, permissions, transport negotiation and invalidation', async t => {
  const game = http.createServer()
  const gameWs = new WebSocketServer({ server: game })
  const calls = [], handshakes = []
  gameWs.on('connection', (ws, req) => {
    handshakes.push(req.headers.authorization)
    ws.send(JSON.stringify({ type: 'hello' }))
    ws.on('message', raw => {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return }
      if (msg.type === 'subscribe_events') { ws.send(JSON.stringify({ type: 'events_subscribed' })); ws.send(JSON.stringify({ type: 'event', event: 'round_started', utc: new Date().toISOString(), data: { round: 1 } })); return }
      if (msg.type !== 'call') return
      calls.push(msg)
      const denied = msg.path === '/control/audit/list'
      setTimeout(() => ws.send(JSON.stringify({ type: 'result', reqId: msg.reqId, ok: !denied, status: denied ? 403 : 200, data: { success: !denied, message: denied ? 'duty forbidden' : 'sent', data: msg.body } })), 10)
    })
  })
  await new Promise(resolve => game.listen(0, '127.0.0.1', resolve))
  const server = { id: 'owned', userId: 'owner', host: '127.0.0.1', port: game.address().port, apiKey: 'test-key', controlTransport: 'ws' }
  let authorized = true, role = 'admin', httpCalls = 0
  let resolveHost = async () => ({ ok: true, ips: ['127.0.0.1'] })
  hub.init({
    resolveUser: cookie => authorized && cookie === 'session=test' ? { username: 'owner', role } : null,
    listServers: () => [server], findServer: id => id === server.id ? server : null,
    isOwned: (_user, id) => id === server.id,
    resolveServerHost: () => resolveHost(),
    fetchHttp: async (_id, method) => {
      if (method === 'GET') return { ok: true, data: { success: true } }
      httpCalls++
      return { ok: false, status: 404, data: { data: { code: 'transport_mismatch', use: 'ws' } } }
    },
  })
  const platform = http.createServer()
  platform.on('upgrade', (req, socket, head) => hub.attach(req, socket, head))
  await new Promise(resolve => platform.listen(0, '127.0.0.1', resolve))
  const browserUrl = `ws://127.0.0.1:${platform.address().port}/api/sl/ws`
  const browsers = []
  t.after(() => {
    hub.shutdown()
    for (const ws of browsers) ws.terminate()
    for (const ws of gameWs.clients) ws.terminate()
    gameWs.close(); game.close(); platform.close()
  })

  const results = await Promise.all(Array.from({ length: 8 }, (_, n) => hub.callForServer(server, '/control/broadcast', { message: `message-${n}` })))
  assert.equal(handshakes.length, 1, 'concurrent calls share one upstream handshake')
  assert.equal(calls.length, 8)
  assert.equal(new Set(calls.map(c => c.reqId)).size, 8)
  assert.ok(results.every(r => r.ok && r.data.message === 'sent'))
  assert.equal(handshakes[0], 'Bearer test-key')

  for (let i = 0; i < 2; i++) {
    const ws = new WebSocket(browserUrl, { headers: { Cookie: 'session=test' } })
    browsers.push(ws)
    await once(ws, 'open')
  }
  const responses = browsers.map((ws, i) => {
    const waiting = message(ws, m => m.type === 'result')
    ws.send(JSON.stringify({ type: 'call', reqId: 'same-browser-id', serverId: 'owned', path: '/control/staffchat', body: { client: i } }))
    return waiting
  })
  const reply = await Promise.all(responses)
  assert.equal(reply[0].data.data.client, 0)
  assert.equal(reply[1].data.data.client, 1)

  const denied = await hub.callForServer(server, '/control/audit/list', {})
  assert.equal(denied.status, 403)
  assert.equal(denied.message, 'duty forbidden')
  assert.equal(httpCalls, 0, 'permission failures must never fall back or retry')
  assert.equal((await hub.callForServer(server, '/control/../get_sl_data', {})).status, 400)

  const event = message(browsers[0], m => m.type === 'event')
  browsers[0].send(JSON.stringify({ type: 'subscribe_events', serverIds: ['owned'] }))
  assert.equal((await event).event, 'round_started')

  const before = calls.length
  role = 'guest'
  const guestReply = message(browsers[0], m => m.type === 'result')
  browsers[0].send(JSON.stringify({ type: 'call', reqId: 'guest', serverId: 'owned', path: '/control/broadcast' }))
  assert.equal((await guestReply).status, 403)
  assert.equal(calls.length, before)
  authorized = false
  const closed = once(browsers[0], 'close')
  browsers[0].send(JSON.stringify({ type: 'ping' }))
  await closed
  browsers[1].terminate()

  server.apiKey = 'rotated-test-key'
  server.controlTransport = 'http'
  hub.invalidateServer(server.id)
  const switched = await hub.callForServer(server, '/control/broadcast', { message: 'negotiated-once' })
  assert.ok(switched.ok)
  assert.equal(httpCalls, 1)
  assert.equal(handshakes.at(-1), 'Bearer rotated-test-key')
  assert.equal(calls.filter(c => c.body.message === 'negotiated-once').length, 1)

  // A pending DNS lookup must not resurrect revoked credentials after configuration changes.
  server.controlTransport = 'ws'
  hub.invalidateServer(server.id)
  let releaseLookup
  resolveHost = () => new Promise(resolve => { releaseLookup = resolve })
  const pendingCall = hub.callForServer(server, '/control/broadcast', { message: 'stale-config' })
  const handshakeCount = handshakes.length
  hub.invalidateServer(server.id)
  releaseLookup({ ok: true, ips: ['127.0.0.1'] })
  assert.equal((await pendingCall).status, 409)
  assert.equal(handshakes.length, handshakeCount)
  assert.equal(calls.filter(c => c.body.message === 'stale-config').length, 0)
})
