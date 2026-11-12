const { test } = require('node:test')
const assert = require('node:assert/strict')
const { isForbiddenIp, isPrivateIp, isAllowedControlPath, isAllowedReadOnlyPath, resolveHostChecked, isSameOrigin, normalizePublicOrigin } = require('./security')

test('SSRF: IPv4, IPv6 and mapped/expanded forms are classified consistently', async () => {
  for (const ip of ['127.0.0.1', '169.254.169.254', '0.0.0.0', '::1', '0:0:0:0:0:0:0:1', '::ffff:7f00:1', '[::ffff:169.254.169.254]', 'fe90::1', 'ff02::1', '224.0.0.1']) {
    assert.equal(isForbiddenIp(ip), true, ip)
    assert.equal((await resolveHostChecked(ip, true)).ok, false, ip)
  }
  for (const ip of ['10.0.0.1', '192.168.1.1', '::ffff:c0a8:101', 'fd00::1', '100.64.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip)
    assert.equal((await resolveHostChecked(ip, false)).ok, false, ip)
    assert.equal((await resolveHostChecked(ip, true)).ok, true, ip)
  }
  assert.equal(isPrivateIp('1.1.1.1'), false)
  assert.equal(isForbiddenIp('2606:4700::1111'), false)
})

test('proxy paths cannot escape the selected authentication plane', () => {
  for (const p of ['/control/broadcast', '/control/staffchat', '/control/audit/list', '/control/moderation/ban_list']) assert.ok(isAllowedControlPath(p))
  for (const p of ['/get_sl_data', '//evil', '/control/../get_sl_data', '/control/%2e%2e/foo', '/control/x?token=x', '/control/x#x', '/control/x\\y']) assert.equal(isAllowedControlPath(p), false, p)
  for (const p of ['/get_sl_data', '/plugins/adapted', '/plugins/example.plugin/status']) assert.ok(isAllowedReadOnlyPath(p))
  for (const p of ['/control/logs', '/plugins/../x', '/plugins/x/y/z', '/plugins/x/y?x=1']) assert.equal(isAllowedReadOnlyPath(p), false, p)
})

test('[beta] adapted plugin action routes admit plugin ids with dots/dashes but no traversal', () => {
  for (const p of ['/control/adapted/example.plugin/reload', '/control/adapted/my-plugin_2/door-open', '/control/adapted/a/b']) assert.ok(isAllowedControlPath(p), p)
  for (const p of ['/control/adapted/../x', '/control/adapted/a..b/c', '/control/adapted/a/b/c', '/control/adapted/a', '/control/adapted/.hidden/x', '/control/adapted/a/b?x=1', '/control/adapted/x/y/z', '/control/Adapted/a/b']) {
    assert.equal(isAllowedControlPath(p), false, p)
  }
})

test('cross-site mutations and WebSocket handshakes are denied', () => {
  assert.ok(isSameOrigin({ headers: { host: 'console.example', origin: 'https://console.example' } }))
  assert.ok(isSameOrigin({ headers: { host: 'console.example' } }))
  assert.equal(isSameOrigin({ headers: { host: 'console.example', origin: 'https://attacker.example' } }), false)
  assert.equal(isSameOrigin({ headers: { host: 'console.example', origin: 'null' } }), false)
})

test('configured public origin survives Tunnel Host rewriting without trusting forwarded headers', () => {
  const publicOrigin = normalizePublicOrigin('https://Console.Example:443/')
  assert.equal(publicOrigin, 'https://console.example')
  const request = origin => ({ headers: { host: '127.0.0.1:3000', origin } })
  assert.equal(isSameOrigin(request(publicOrigin), null), false, 'reproduces the previous Tunnel failure')
  assert.ok(isSameOrigin(request(publicOrigin), publicOrigin))
  assert.ok(isSameOrigin(request('https://console.example:443'), publicOrigin))
  for (const origin of ['https://attacker.example', 'http://console.example', 'https://console.example:8443', 'https://console.example.attacker.test', 'http://127.0.0.1:3000', 'null', 'https://user@console.example', 'https://console.example/path']) {
    const req = request(origin)
    req.headers['x-forwarded-host'] = 'attacker.example'
    req.headers.forwarded = 'host=attacker.example;proto=https'
    req.headers['sec-fetch-site'] = 'same-origin'
    assert.equal(isSameOrigin(req, publicOrigin), false, origin)
  }
  assert.equal(isSameOrigin({ headers: { host: '127.0.0.1:3000', 'sec-fetch-site': 'cross-site' } }, publicOrigin), false)
  for (const value of ['null', 'ftp://console.example', 'https://user:pass@console.example', 'https://console.example/path', 'https://console.example?x=1']) {
    assert.throws(() => normalizePublicOrigin(value))
  }
})
