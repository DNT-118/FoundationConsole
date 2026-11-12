// Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0
/**
 * Microsoft Entra ID OAuth2（SMTP XOAUTH2）—— 多租户公共客户端。
 *
 * 两条授权路径：
 *  1. 设备代码流（默认）：管理员在远程公网控制台操作，无法依赖 localhost 回调。
 *     POST {authority}/oauth2/v2.0/devicecode → 用户码 + verification_uri →
 *     后端按 interval 轮询 token 端点（authorization_pending / slow_down /
 *     authorization_declined / expired_token 全部结构化处理）。
 *     会话绑定发起的管理员，poll 时校验 username。
 *  2. 授权码 + PKCE（S256，可选）：配置了 PFC_MS_REDIRECT_URI（或 PFC_PUBLIC_URL
 *     可推导回调地址）时可用；state 绑定管理员会话、10 分钟过期、一次性。
 *     回调地址只来自 PFC_MS_REDIRECT_URI / PFC_PUBLIC_URL，绝不用 Host 头推导。
 *
 * 令牌：
 *  - refresh_token 由调用方（store.saveMicrosoftAuth）用 master.key 加密落盘；
 *  - access token 仅内存缓存（带过期，提前 60s 视为过期）；
 *  - 刷新后把新的 refresh_token 轮换写回；invalid_grant → 标记需要重新授权。
 *
 * 测试：setTransport(fn) 注入伪传输，绝不出网。
 */
const crypto = require('node:crypto')
const https = require('node:https')

/** 默认 client ID：Entra 多租户公共应用（非机密，可作出厂默认值）。 */
const DEFAULT_CLIENT_ID = '05ff2f04-c7a1-46b6-b27d-af361e57b4d3'
/** 微软个人账户租户（outlook.com 个人邮箱）。 */
const PERSONAL_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad'
const DEFAULT_SCOPES = 'https://outlook.office.com/SMTP.Send offline_access openid email profile'
const STATE_TTL_MS = 10 * 60 * 1000
const DEVICE_SESSION_TTL_MS = 30 * 60 * 1000

function msEnv() {
  return {
    clientId: String(process.env.PFC_MS_CLIENT_ID || DEFAULT_CLIENT_ID).trim(),
    tenant: (String(process.env.PFC_MS_TENANT || 'common').trim() || 'common').toLowerCase(),
    clientSecret: String(process.env.PFC_MS_CLIENT_SECRET || '').trim(),
    redirectUri: String(process.env.PFC_MS_REDIRECT_URI || '').trim(),
    scopes: String(process.env.PFC_MS_SCOPES || DEFAULT_SCOPES).trim(),
  }
}

function authority(tenant) {
  return `https://login.microsoftonline.com/${encodeURIComponent(String(tenant || 'common').trim())}`
}

/** 回调地址：只从 PFC_MS_REDIRECT_URI / PFC_PUBLIC_URL 推导（绝不用请求 Host 头）。 */
function redirectUriConfigured() {
  const env = msEnv()
  if (env.redirectUri) return env.redirectUri
  const pub = String(process.env.PFC_PUBLIC_URL || '').trim()
  if (pub) {
    try { return new URL(pub).origin + '/api/admin/smtp/ms/callback' } catch { /* 非法配置忽略 */ }
  }
  return ''
}

// ---------- 传输（可注入） ----------

/** 默认传输：真实 HTTPS POST（application/x-www-form-urlencoded）。 */
function defaultTransport({ url, form }) {
  return new Promise((resolve) => {
    const body = Object.entries(form)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 15000,
    }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }) })
    req.on('error', () => resolve({ status: 0, body: '' }))
    req.end(body)
  })
}

let transport = defaultTransport
/** 测试注入：setTransport(async ({url, form}) => ({status, body}))。 */
function setTransport(fn) { transport = fn || defaultTransport }

function postForm(url, form) {
  return transport({ url, form })
}

function parseTokenResponse(status, body) {
  let j
  try { j = JSON.parse(body) } catch { return { error: 'response_parse', error_description: 'token 响应不是合法 JSON' } }
  if (status !== 200 || !j.access_token) {
    return { error: j.error || 'http_error', error_description: j.error_description || `HTTP ${status}` }
  }
  return j
}

// ---------- 设备代码流 ----------

// id -> { admin, deviceCode, interval, expiresAt }
const deviceSessions = new Map()

function pruneSessions() {
  const now = Date.now()
  for (const [k, v] of deviceSessions) if (v.expiresAt < now) deviceSessions.delete(k)
  for (const [k, v] of authCodeStates) if (v.expires < now) authCodeStates.delete(k)
}

/** 发起设备代码流。返回 { id, userCode, verificationUri, expiresIn, interval }。 */
async function startDeviceCode(adminUsername) {
  const env = msEnv()
  const { status, body } = await postForm(`${authority(env.tenant)}/oauth2/v2.0/devicecode`, {
    client_id: env.clientId,
    scope: env.scopes,
  })
  let j
  try { j = JSON.parse(body) } catch { throw new Error('设备代码响应不是合法 JSON') }
  if (status !== 200 || !j.device_code || !j.user_code) {
    throw new Error(j.error_description || j.error || `HTTP ${status}`)
  }
  pruneSessions()
  const id = crypto.randomBytes(24).toString('hex')
  const interval = Math.max(1, Number(j.interval) || 5)
  deviceSessions.set(id, {
    admin: String(adminUsername || ''),
    deviceCode: String(j.device_code),
    interval,
    expiresAt: Math.min(
      Date.now() + DEVICE_SESSION_TTL_MS,
      Date.now() + (Number(j.expires_in) || 900) * 1000,
    ),
  })
  return {
    id,
    userCode: String(j.user_code),
    verificationUri: String(j.verification_uri || 'https://microsoft.com/devicelogin'),
    expiresIn: Number(j.expires_in) || 900,
    interval,
  }
}

/** 轮询设备代码（结构化返回 pending/slow_down/done/declined/expired/error）。 */
async function pollDeviceCode(id, adminUsername) {
  const s = deviceSessions.get(String(id || ''))
  if (!s || s.admin !== String(adminUsername || '')) {
    return { status: 'error', message: '设备代码会话不存在、已过期或不属于当前管理员' }
  }
  if (Date.now() > s.expiresAt) {
    deviceSessions.delete(String(id))
    return { status: 'expired' }
  }
  const env = msEnv()
  const { status, body } = await postForm(`${authority(env.tenant)}/oauth2/v2.0/token`, {
    client_id: env.clientId,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: s.deviceCode,
  })
  let j
  try { j = JSON.parse(body) } catch { return { status: 'error', message: 'token 响应不是合法 JSON' } }
  if (!j || typeof j !== 'object') return { status: 'error', message: 'token 响应格式异常' }

  if (status === 200 && j.access_token) {
    deviceSessions.delete(String(id))
    return { status: 'done', tokens: j }
  }
  switch (j.error) {
    case 'authorization_pending':
      return { status: 'pending', interval: s.interval }
    case 'slow_down':
      // RFC 8628：slow_down 要求在原间隔上 +5s
      s.interval = s.interval + 5
      return { status: 'slow_down', interval: s.interval }
    case 'authorization_declined':
      deviceSessions.delete(String(id))
      return { status: 'declined' }
    case 'expired_token':
      deviceSessions.delete(String(id))
      return { status: 'expired' }
    default:
      deviceSessions.delete(String(id))
      return { status: 'error', message: j.error_description || j.error || `HTTP ${status}` }
  }
}

// ---------- 授权码 + PKCE（可选） ----------

// state -> { admin, verifier, redirectUri, expires }
const authCodeStates = new Map()

function base64url(buf) { return Buffer.from(buf).toString('base64url') }

/**
 * 发起授权码 + PKCE。未配置回调地址时返回 null（路由据此回 400）。
 * 返回 { url, state }；state 绑定管理员并 10 分钟过期。
 */
function startAuthorize(adminUsername) {
  const env = msEnv()
  const redirectUri = redirectUriConfigured()
  if (!redirectUri) return null
  pruneSessions()
  const verifier = base64url(crypto.randomBytes(48))
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  const state = crypto.randomBytes(24).toString('hex')
  authCodeStates.set(state, {
    admin: String(adminUsername || ''),
    verifier,
    redirectUri,
    expires: Date.now() + STATE_TTL_MS,
  })
  const q = new URLSearchParams({
    client_id: env.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: env.scopes,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  return { url: `${authority(env.tenant)}/oauth2/v2.0/authorize?${q.toString()}`, state }
}

/** 回调兑换授权码。state 一次性；校验管理员绑定与 10 分钟过期。 */
async function redeemAuthorize(state, code, adminUsername) {
  const key = String(state || '')
  const s = authCodeStates.get(key)
  authCodeStates.delete(key) // 一次性
  if (!s) return { error: 'invalid_state', error_description: 'state 无效或已使用' }
  if (s.admin !== String(adminUsername || '')) {
    return { error: 'invalid_state', error_description: 'state 不属于当前管理员会话' }
  }
  if (Date.now() > s.expires) return { error: 'invalid_state', error_description: 'state 已过期（10 分钟）' }
  if (!code) return { error: 'invalid_request', error_description: '缺少 code' }

  const env = msEnv()
  const form = {
    client_id: env.clientId,
    grant_type: 'authorization_code',
    code: String(code),
    redirect_uri: s.redirectUri,
    code_verifier: s.verifier,
    scope: env.scopes,
  }
  if (env.clientSecret) form.client_secret = env.clientSecret
  const { status, body } = await postForm(`${authority(env.tenant)}/oauth2/v2.0/token`, form)
  const parsed = parseTokenResponse(status, body)
  if (parsed.error) return parsed
  return parsed
}

// ---------- 令牌 ----------

/** 解析 id_token payload（不验签——令牌来自 TLS 直连的 token 端点）。 */
function parseIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'))
    return {
      email: payload.email || payload.upn || payload.preferred_username || '',
      tid: String(payload.tid || ''),
    }
  } catch {
    return { email: '', tid: '' }
  }
}

/** SMTP 主机按 tid 自动选择：个人账户 → smtp-mail.outlook.com，组织/未知 → smtp.office365.com（均 587 STARTTLS）。 */
function smtpHostForTid(tid) {
  return String(tid || '').trim().toLowerCase() === PERSONAL_TENANT_ID
    ? { host: 'smtp-mail.outlook.com', port: 587 }
    : { host: 'smtp.office365.com', port: 587 }
}

/** 用 refresh_token 换新令牌。失败时 e.code = 上游 error（如 invalid_grant）。 */
async function refreshTokens(refreshToken) {
  const env = msEnv()
  const { status, body } = await postForm(`${authority(env.tenant)}/oauth2/v2.0/token`, {
    client_id: env.clientId,
    grant_type: 'refresh_token',
    refresh_token: String(refreshToken || ''),
    scope: env.scopes,
  })
  const parsed = parseTokenResponse(status, body)
  if (parsed.error) {
    const e = new Error(parsed.error_description)
    e.code = parsed.error
    throw e
  }
  return parsed
}

// access token 内存缓存：key -> { token, expiresAt }
const accessTokenCache = new Map()

/** 清空访问令牌缓存（断开/重授权时调用）。 */
function invalidateAccessToken(key) { accessTokenCache.delete(String(key || '')) }

/**
 * 取可用 access token：命中缓存直接返回；否则刷新并轮换写回。
 * hooks: { getRefreshToken(): Promise<string>, saveRefreshToken(rt): Promise<void>,
 *          markReauth?(): Promise<void>, markLinked?(): Promise<void> }
 * invalid_grant → 清缓存 + hooks.markReauth()（UI 显示"需要重新授权"）。
 */
async function getAccessToken(key, hooks) {
  const cacheKey = String(key || '')
  const hit = accessTokenCache.get(cacheKey)
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token

  const rt = await hooks.getRefreshToken()
  if (!rt) {
    const e = new Error('未连接 Microsoft 账号 — 请管理员在设置页完成授权')
    e.code = 'not_linked'
    throw e
  }
  try {
    const tokens = await refreshTokens(rt)
    // 每次刷新把新 refresh_token 轮换写回（上游可能旋转令牌）
    if (tokens.refresh_token) await hooks.saveRefreshToken(String(tokens.refresh_token))
    accessTokenCache.set(cacheKey, {
      token: String(tokens.access_token),
      expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
    })
    if (hooks.markLinked) await hooks.markLinked()
    return String(tokens.access_token)
  } catch (e) {
    if (e && e.code === 'invalid_grant') {
      accessTokenCache.delete(cacheKey)
      if (hooks.markReauth) await hooks.markReauth()
    }
    throw e
  }
}

module.exports = {
  DEFAULT_CLIENT_ID,
  PERSONAL_TENANT_ID,
  DEFAULT_SCOPES,
  msEnv,
  authority,
  redirectUriConfigured,
  setTransport,
  startDeviceCode,
  pollDeviceCode,
  startAuthorize,
  redeemAuthorize,
  parseIdToken,
  smtpHostForTid,
  refreshTokens,
  getAccessToken,
  invalidateAccessToken,
  // 测试钩子（不用于生产代码路径判断）
  __test: { deviceSessions, authCodeStates },
}
