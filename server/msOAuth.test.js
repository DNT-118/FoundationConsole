// Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0
/**
 * Microsoft OAuth（msOAuth）单元测试：全部走注入的伪传输，绝不真实请求微软。
 * 覆盖：设备码轮询各状态、state 校验（管理员绑定 / 一次性 / 10 分钟过期）、
 * 刷新令牌轮换写回、invalid_grant 处理、tid 选主机。
 * SMTP 表单"空字段保留"语义的存储层测试在 store.test.js。
 */
const { test, before } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// 独立数据目录（本文件测试也在隔离进程里跑）
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfc-msoauth-test-'))
process.env.PFC_DATA_DIR = dir
process.env.PFC_MASTER_KEY = 'isolated-msoauth-test-key'
process.env.PFC_MS_CLIENT_ID = 'test-client-id'
process.env.PFC_MS_TENANT = 'testtenant'
process.env.PFC_MS_REDIRECT_URI = 'https://console.example.com/api/admin/smtp/ms/callback'
afterAll()

function afterAll() {
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } })
}

const msOAuth = require('./msOAuth')
const store = require('./store')

// ---------- 伪传输 ----------

const calls = []           // { url, form }
let pollScript = []        // 依次返回的设备码轮询结果
let refreshResponse = null // { status, body } 或 null（=成功默认）
let authorizeRedeemResponse = null

function mkIdToken(email, tid) {
  const payload = Buffer.from(JSON.stringify({ email, tid })).toString('base64url')
  return `header.${payload}.sig`
}

function respond(json, status = 200) { return { status, body: JSON.stringify(json) } }

msOAuth.setTransport(async ({ url, form }) => {
  calls.push({ url, form })
  if (url.includes('/oauth2/v2.0/devicecode')) {
    return respond({ device_code: 'dc-1', user_code: 'ABCD-EFGH', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5 })
  }
  if (url.includes('/oauth2/v2.0/token')) {
    if (form.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
      const next = pollScript.shift() ?? { tokens: { access_token: 'at-d', refresh_token: 'rt-d', expires_in: 3600, id_token: mkIdToken('admin@qq.com', 'org-tid') } }
      if (next.pending) return respond({ error: 'authorization_pending', error_description: 'Waiting' }, 400)
      if (next.slowDown) return respond({ error: 'slow_down', error_description: 'Slow down' }, 400)
      if (next.declined) return respond({ error: 'authorization_declined', error_description: 'Denied' }, 400)
      if (next.expired) return respond({ error: 'expired_token', error_description: 'Expired' }, 400)
      if (next.error) return respond({ error: next.error, error_description: 'upstream error' }, 400)
      return respond(next.tokens)
    }
    if (form.grant_type === 'refresh_token') {
      if (refreshResponse) return refreshResponse
      return respond({ access_token: 'at-1', refresh_token: 'rt-2', expires_in: 3600, id_token: mkIdToken('user@example.com', 'org-tid') })
    }
    if (form.grant_type === 'authorization_code') {
      if (authorizeRedeemResponse) return authorizeRedeemResponse
      return respond({ access_token: 'at-a', refresh_token: 'rt-a', expires_in: 3600, id_token: mkIdToken('linked@qq.com', '9188040d-6c67-4c5b-b112-36a304b66dad') })
    }
  }
  return respond({ error: 'unsupported' }, 400)
})

before(() => {
  store.setSmtpConfig({ authMode: 'oauth2', user: 'admin@qq.com', host: 'smtp.qq.com', port: 465 })
})

// ---------- tid 选主机 ----------

test('SMTP host follows id_token tid: personal tenant vs organization', () => {
  assert.deepEqual(msOAuth.smtpHostForTid('9188040d-6c67-4c5b-b112-36a304b66dad'), { host: 'smtp-mail.outlook.com', port: 587 })
  assert.deepEqual(msOAuth.smtpHostForTid('72f988bf-86f1-41af-91ab-2d7cd011db47'), { host: 'smtp.office365.com', port: 587 })
  assert.deepEqual(msOAuth.smtpHostForTid(''), { host: 'smtp.office365.com', port: 587 })
  assert.deepEqual(msOAuth.smtpHostForTid(undefined), { host: 'smtp.office365.com', port: 587 })
})

// ---------- 设备代码流 ----------

test('device code start binds the admin session and returns the user code', async () => {
  calls.length = 0
  const r = await msOAuth.startDeviceCode('admin1')
  assert.ok(r.id && r.userCode === 'ABCD-EFGH' && r.interval === 5)
  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.includes('login.microsoftonline.com/testtenant/'), calls[0].url)
  assert.equal(calls[0].form.client_id, 'test-client-id')
  assert.ok(calls[0].form.scope.includes('SMTP.Send'))
  // 会话绑定发起管理员
  assert.equal(msOAuth.__test.deviceSessions.get(r.id).admin, 'admin1')
})

test('device code poll handles pending / slow_down / declined / expired / done', async () => {
  // pending → 保持轮询
  pollScript = [{ pending: true }]
  const started = await msOAuth.startDeviceCode('admin1')
  const p1 = await msOAuth.pollDeviceCode(started.id, 'admin1')
  assert.equal(p1.status, 'pending')
  assert.equal(p1.interval, 5)

  // slow_down → 间隔 +5（RFC 8628）
  pollScript = [{ slowDown: true }]
  const p2 = await msOAuth.pollDeviceCode(started.id, 'admin1')
  assert.equal(p2.status, 'slow_down')
  assert.equal(p2.interval, 10)

  // done → 返回令牌并删除会话
  pollScript = [{ tokens: { access_token: 'at-x', refresh_token: 'rt-x', expires_in: 3600, id_token: mkIdToken('admin@qq.com', 'org-tid') } }]
  const p3 = await msOAuth.pollDeviceCode(started.id, 'admin1')
  assert.equal(p3.status, 'done')
  assert.equal(p3.tokens.refresh_token, 'rt-x')
  assert.equal(msOAuth.__test.deviceSessions.has(started.id), false)

  // declined / expired → 结构化结果
  pollScript = [{ declined: true }]
  const s2 = await msOAuth.startDeviceCode('admin1')
  assert.equal((await msOAuth.pollDeviceCode(s2.id, 'admin1')).status, 'declined')
  assert.equal(msOAuth.__test.deviceSessions.has(s2.id), false)

  pollScript = [{ expired: true }]
  const s3 = await msOAuth.startDeviceCode('admin1')
  assert.equal((await msOAuth.pollDeviceCode(s3.id, 'admin1')).status, 'expired')

  // 上游其它错误 → error + message
  pollScript = [{ error: 'some_upstream_error' }]
  const s4 = await msOAuth.startDeviceCode('admin1')
  const pErr = await msOAuth.pollDeviceCode(s4.id, 'admin1')
  assert.equal(pErr.status, 'error')
  assert.ok(pErr.message)
})

test('device code sessions are bound to the initiating admin and expire', async () => {
  const s = await msOAuth.startDeviceCode('adminA')
  // 他人 poll → 拒绝
  const wrong = await msOAuth.pollDeviceCode(s.id, 'adminB')
  assert.equal(wrong.status, 'error')
  // 未知 id → 拒绝
  const unknown = await msOAuth.pollDeviceCode('nope', 'adminA')
  assert.equal(unknown.status, 'error')
  // 本地过期（改 expiresAt 模拟 30 分钟流逝）→ expired
  msOAuth.__test.deviceSessions.get(s.id).expiresAt = Date.now() - 1
  const expired = await msOAuth.pollDeviceCode(s.id, 'adminA')
  assert.equal(expired.status, 'expired')
})

// ---------- 授权码 + PKCE（state 校验） ----------

test('authorize start builds PKCE url from the configured redirect uri only', () => {
  const r = msOAuth.startAuthorize('admin1')
  assert.ok(r && r.url)
  const u = new URL(r.url)
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256')
  assert.ok(u.searchParams.get('code_challenge'))
  assert.equal(u.searchParams.get('redirect_uri'), 'https://console.example.com/api/admin/smtp/ms/callback')
  assert.ok(u.searchParams.get('scope').includes('offline_access'))
})

test('authorize state is one-time, admin-bound and expires after 10 minutes', async () => {
  // 他人兑换 → 拒绝（state 一次性，立即作废）
  const s1 = msOAuth.startAuthorize('admin1')
  const r1 = await msOAuth.redeemAuthorize(s1.state, 'code-1', 'admin2')
  assert.equal(r1.error, 'invalid_state')
  // 已用的 state 不能重复兑换
  const r1b = await msOAuth.redeemAuthorize(s1.state, 'code-1', 'admin1')
  assert.equal(r1b.error, 'invalid_state')

  // 过期 state → 拒绝
  const s2 = msOAuth.startAuthorize('admin1')
  msOAuth.__test.authCodeStates.get(s2.state).expires = Date.now() - 1
  const r2 = await msOAuth.redeemAuthorize(s2.state, 'code-2', 'admin1')
  assert.equal(r2.error, 'invalid_state')

  // 正常兑换 → 令牌；PKCE verifier 参与
  const s3 = msOAuth.startAuthorize('admin1')
  calls.length = 0
  const r3 = await msOAuth.redeemAuthorize(s3.state, 'code-3', 'admin1')
  assert.ok(r3.access_token)
  assert.equal(calls[0].form.grant_type, 'authorization_code')
  assert.ok(calls[0].form.code_verifier)
  assert.equal(calls[0].form.redirect_uri, 'https://console.example.com/api/admin/smtp/ms/callback')

  // 回调地址未配置时 startAuthorize 返回 null（路由回 400，走设备代码流）
  const uri = process.env.PFC_MS_REDIRECT_URI
  const pub = process.env.PFC_PUBLIC_URL
  delete process.env.PFC_MS_REDIRECT_URI
  delete process.env.PFC_PUBLIC_URL
  assert.equal(msOAuth.startAuthorize('admin1'), null)
  process.env.PFC_MS_REDIRECT_URI = uri
  if (pub !== undefined) process.env.PFC_PUBLIC_URL = pub
})

// ---------- 刷新令牌轮换写回 ----------

test('access token refresh rotates the refresh token back to storage and caches', async () => {
  let storedRt = 'rt-1'
  let markedReauth = 0
  const hooks = {
    getRefreshToken: async () => storedRt,
    saveRefreshToken: async (rt) => { storedRt = rt },
    markReauth: async () => { markedReauth += 1 },
  }
  msOAuth.invalidateAccessToken('smtp')
  calls.length = 0

  const tok1 = await msOAuth.getAccessToken('smtp', hooks)
  assert.equal(tok1, 'at-1')
  assert.equal(storedRt, 'rt-2', '新的 refresh_token 必须轮换写回')
  const tokenCallsAfterFirst = calls.length

  // 缓存命中：不再出网
  const tok2 = await msOAuth.getAccessToken('smtp', hooks)
  assert.equal(tok2, 'at-1')
  assert.equal(calls.length, tokenCallsAfterFirst)

  // invalid_grant → 清缓存 + 标记需要重新授权，错误原样抛出
  refreshResponse = { status: 400, body: JSON.stringify({ error: 'invalid_grant', error_description: 'Token expired' }) }
  msOAuth.invalidateAccessToken('smtp')
  await assert.rejects(msOAuth.getAccessToken('smtp', hooks), e => e.code === 'invalid_grant')
  assert.equal(markedReauth, 1)
  refreshResponse = null

  // 未连接 → not_linked
  msOAuth.invalidateAccessToken('smtp')
  await assert.rejects(msOAuth.getAccessToken('smtp', { getRefreshToken: async () => '' }), e => e.code === 'not_linked')
})
