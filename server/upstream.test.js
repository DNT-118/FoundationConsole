const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { requestUpstream } = require('./upstream')

async function fixture(t, handler) {
  const server = http.createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  return { host: 'game.example', port: server.address().port, token: 'test-verify', apiKey: 'test-api-key' }
}

test('PEAK data and control credentials are headers only; POST is sent once', async t => {
  const calls = []
  const server = await fixture(t, (req, res) => {
    calls.push({ url: req.url, auth: req.headers.authorization })
    res.end(JSON.stringify({ success: true, message: 'ok' }))
  })
  assert.ok((await requestUpstream(server, '127.0.0.1', 'GET', '/get_sl_data')).ok)
  assert.ok((await requestUpstream(server, '127.0.0.1', 'POST', '/control/broadcast', '{"message":"hello"}')).ok)
  assert.deepEqual(calls, [{ url: '/get_sl_data', auth: 'Bearer test-verify' }, { url: '/control/broadcast', auth: 'Bearer test-api-key' }])
})

test('truncated, oversized, non-JSON and timed-out responses are explicit failures', async t => {
  const server = await fixture(t, (req, res) => {
    if (req.url === '/hang') return
    if (req.url === '/truncated') { res.writeHead(200, { 'Content-Length': 1000 }); res.write('{"success":'); setImmediate(() => res.destroy()); return }
    res.end(req.url === '/large' ? JSON.stringify({ success: true, text: 'x'.repeat(1024) }) : '<html>bad gateway</html>')
  })
  for (const route of ['/hang', '/truncated', '/large', '/html']) {
    const result = await requestUpstream(server, '127.0.0.1', 'GET', route, undefined, { timeoutMs: 150, maxBytes: 100 })
    assert.equal(result.ok, false, route)
    assert.ok(result.status >= 500, route)
  }
})

test('upstream business and permission failures preserve their details', async t => {
  const server = await fixture(t, (_req, res) => { res.writeHead(403); res.end(JSON.stringify({ success: false, message: 'API Key forbidden' })) })
  const result = await requestUpstream(server, '127.0.0.1', 'POST', '/control/audit/list', '{}')
  assert.equal(result.status, 403)
  assert.equal(result.message, 'API Key forbidden')
})
