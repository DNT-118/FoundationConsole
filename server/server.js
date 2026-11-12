// Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0
/**
 * Foundation Console 平台后端（唯一性平台 · 服务端化）。
 *
 * 功能：
 *  - /api/auth/*     注册（仅 QQ 邮箱 + SMTP 验证码）/ 登录 / 会话
 *  - /api/servers    服务器配置（按用户隔离，SLDataAPI API Key AES 加密存储）
 *  - /api/admin/*    管理员：SMTP 配置 / 用户管理 / 公告
 *  - /api/sl/data|call  按 serverId 白名单的 SLDataAPI 数据/控制（平台内部自动请求游戏服）
 *  - 静态托管 dist + SPA 回退
 *
 * 启动：node server/server.js（端口 PORT，默认 3000）
 * 安全：密码 scrypt、令牌 AES-256-GCM、会话校验、按 userId 过滤（防越权）、
 *       guest 角色强制清空 apiKey。
 */
const http = require('node:http')
const https = require('node:https')
const path = require('node:path')
const fs = require('node:fs')
const { join } = require('node:path')

const store = require('./store')
const auth = require('./auth')
const mail = require('./mail')
const crypto = require('./crypto')
const wsHub = require('./wsHub')
const { isForbiddenTarget, isPrivateHost, resolveHostChecked, isAllowedControlPath, isAllowedReadOnlyPath, isSameOrigin } = require('./security')
const { requestUpstream } = require('./upstream')
const { serveStatic } = require('./staticFiles')

// 请求错误在边界内处理；真正的未捕获异常交由 Node 退出，供进程守护重启。
process.on('uncaughtExceptionMonitor', (e) => {
  try { console.error('[PFC] uncaughtException:', e && e.stack ? e.stack : e) } catch { /* ignore */ }
})

// ================= 安全工具 =================

/** 所有响应统一附加的安全头（CSP / 点击劫持 / 嗅探 / 降级）。 */
function applySecurityHeaders(res) {
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; " +
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  )
  // 经 Cloudflare 时浏览器侧恒为 HTTPS；纯 HTTP 访问时浏览器会忽略此头，无副作用
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
}

// ---- HttpOnly 会话 cookie（登录成功时下发；前端不再需要 localStorage 存 token）----
const SESSION_COOKIE = 'pfc_session'

function getCookieToken(req) {
  const c = req.headers.cookie || ''
  const m = c.match(new RegExp('(?:^|;\\s*)' + SESSION_COOKIE + '=([^;]+)'))
  try { return m ? decodeURIComponent(m[1]) : '' } catch { return '' }
}

function setSessionCookie(req, res, token) {
  // 经 Cloudflare 时加 Secure（浏览器侧 HTTPS）；局域网直连 HTTP 时不加，保证可用
  const secure = (req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https') ? '; Secure' : ''
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600${secure}`,
  )
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
}

/** 服务器配置输入校验：host 必须为合法主机名/IP，port 在 1-65535。返回错误文案或 null。 */
function validateServerInput(b) {
  const host = String(b.host || '').trim().toLowerCase()
  const port = Number(b.port)
  if (!host || host.length > 253) return 'host 不能为空'
  try {
    const u = new URL('http://' + host + ':' + port)
    if (u.hostname !== host) return 'host 格式非法'
  } catch {
    return 'host/port 格式非法'
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) return '端口必须在 1-65535'
  return null
}

/**
 * 服务器配置出参脱敏：SL token / API Key 一律不回传明文。
 * 平台内部转发使用平台存储值注入，前端只需要知道"是否已配置"。
 */
function sanitizeServer(s) {
  return {
    id: s.id,
    host: s.host,
    port: s.port,
    label: s.label || '',
    controlTransport: s.controlTransport === 'ws' ? 'ws' : 'http',
    refetchInterval: s.refetchInterval,
    token: '',
    apiKey: s.apiKey ? '••••••' : '',
    apiKeyConfigured: !!s.apiKey,
    controlEnabled: !!s.apiKey,
    createdAt: s.createdAt,
  }
}

const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST || '0.0.0.0'
const listeners = []
const ROOT = join(__dirname, '..', 'dist')

// ================= 工具 =================

// ---- Outlook/Office365 OAuth2 在线授权流程 ----
// 管理员点"连接 Microsoft 账号" → /oauth2/start 生成授权 URL（state 会话 10 分钟有效）
// → 微软登录页 → 回跳 /oauth2/callback（浏览器直达，无 Authorization 头，state 即凭证）
// → code 换 refresh_token → 合并保存进 SMTP 配置 → 302 回 /settings?oauth=ok|error
const oauthStates = new Map()   // state -> { clientId, clientSecret, expires }

const OAUTH_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const OAUTH_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const OAUTH_SCOPE = 'offline_access https://outlook.office.com/SMTP.Send openid profile email'

/** 回调地址：由请求的 Host 推导（经 Cloudflare 隧道时 Host=域名，与 Azure 登记必须一致）。 */
function oauthRedirectUri(req) {
  const host = req.headers.host || 'localhost'
  return `https://${host}/api/admin/smtp/oauth2/callback`
}

function redirectOAuth(res, location) {
  applySecurityHeaders(res)
  res.writeHead(302, { Location: location })
  res.end()
}

/** POST 表单到微软 token 端点（code → refresh_token）。 */
function oauthExchange(form) {
  return new Promise((resolve, reject) => {
    const body = Object.entries(form)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    const req = https.request(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        try {
          const j = JSON.parse(data)
          if (res.statusCode >= 400) reject(new Error(j.error_description || j.error || `HTTP ${res.statusCode}`))
          else resolve(j)
        } catch {
          reject(new Error('token 响应解析失败: ' + String(data).slice(0, 160)))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('timeout')))
    req.end(body)
  })
}

function sendJSON(res, status, obj) {
  applySecurityHeaders(res)
  res.setHeader('Cache-Control', 'no-store')
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text ? JSON.parse(text) : {})
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}

function getBearer(req) {
  const h = req.headers.authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null
}

/** 从请求解析当前用户（未登录返回 null，不抛错）。 */
function currentUser(req) {
  return auth.authUser(getBearer(req) || getCookieToken(req))
}

/**
 * 平台 → 游戏服务器 的缓冲式转发（WS 枢纽 / /api/sl/data 用）：
 * 安全模型：DNS 校验 + 平台存储 token 注入 + 已校验 IP 连接（防 DNS rebinding）。
 * 返回 { ok, status, data, message }。
 */
async function resolveServerHost(server) {
  const owner = store.getUser(server.userId)
  if (!owner) return { ok: false, error: '服务器所属账户不存在' }
  return resolveHostChecked(server.host, owner.role === 'admin')
}

async function fetchGameServerToBuffer(server, method, path, body) {
  const hostCheck = await resolveServerHost(server)
  if (!hostCheck.ok) return { ok: false, status: 403, message: hostCheck.error }
  return requestUpstream(server, hostCheck.ips[0], method, path, body)
}

// ---- wsHub 依赖注入（模块加载完成后执行，见文件底部 wsHub.init） ----
function wsResolveUser(cookieHeader) {
  return currentUser({ headers: { cookie: cookieHeader || '' } })
}

function wsFetchHttp(serverId, method, path, body) {
  const server = store.findServerById(serverId)
  if (!server) return Promise.resolve({ ok: false, status: 404, message: '服务器不存在' })
  return fetchGameServerToBuffer(server, method, path, body)
}

// ================= Steam 资料/头像代理 =================

// steamid -> { avatar, persona, expires }（24h TTL；网络失败用过期缓存兜底）
const steamProfileCache = new Map()
// steamid -> 头像图片 Buffer（内存缓存，最多 300 张，FIFO 淘汰）
const avatarImageCache = new Map()
const STEAM_PROFILE_TTL = 24 * 60 * 60 * 1000

/** Steam Web API key：优先取设置页保存的配置（加密存储），其次环境变量 PFC_STEAM_KEY。 */
function steamApiKey() {
  return store.getSteamKey() || String(process.env.PFC_STEAM_KEY || '').trim()
}

/** 带超时/大小上限/重定向跟随的 https GET，返回 Buffer；失败一律 null（绝不抛异常）。 */
function httpGetBuffer(url, timeoutMs = 8000, maxBytes = 512 * 1024, redirects = 2) {
  return new Promise((resolve) => {
    let req
    try {
      req = https.get(url, { timeout: timeoutMs, headers: { 'user-agent': 'FoundationConsole/1.0' } }, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirects > 0) {
          r.resume()
          let next
          try { next = new URL(r.headers.location, url).toString() } catch { resolve(null); return }
          resolve(httpGetBuffer(next, timeoutMs, maxBytes, redirects - 1))
          return
        }
        if (r.statusCode !== 200) { r.resume(); resolve(null); return }
        const chunks = []
        let size = 0
        r.on('data', (c) => {
          size += c.length
          if (size > maxBytes) { try { req.destroy() } catch { /* ignore */ } resolve(null); return }
          chunks.push(c)
        })
        r.on('end', () => resolve(Buffer.concat(chunks)))
        r.on('error', () => resolve(null))
      })
    } catch {
      resolve(null)
      return
    }
    req.on('timeout', () => { try { req.destroy() } catch { /* ignore */ } resolve(null) })
    req.on('error', () => resolve(null))
  })
}

/**
 * 国内网络下 avatars.steamstatic.com 不可达，cloudflare 镜像（avatars.cloudflare.steamstatic.com）
 * 可达：返回按优先级排列的候选头像地址（镜像在前，原址兜底）。
 */
function avatarMirrorUrls(avatarFull) {
  const urls = []
  try {
    const u = new URL(avatarFull)
    if (u.hostname === 'avatars.steamstatic.com') {
      urls.push('https://avatars.cloudflare.steamstatic.com' + u.pathname + u.search)
    }
  } catch { /* 地址非法则只保留原址 */ }
  urls.push(avatarFull)
  return urls
}

/**
 * 解析 Steam 资料。优先 Web API（国内可达），未配置 key 时回退 steamcommunity XML。
 * 固定主机 + steamid 白名单格式（7656 开头 17 位），不存在 SSRF 面。
 */
async function getSteamProfile(steamid) {
  const hit = steamProfileCache.get(steamid)
  if (hit && hit.expires > Date.now()) return hit

  let prof = null
  const key = steamApiKey()
  if (key) {
    const buf = await httpGetBuffer(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(key)}&steamids=${steamid}`,
    )
    if (buf) {
      try {
        const p = JSON.parse(buf.toString('utf8'))?.response?.players?.[0]
        if (p && p.avatarfull) {
          prof = { avatar: p.avatarfull, persona: p.personaname || '', expires: Date.now() + STEAM_PROFILE_TTL }
        }
      } catch { /* 解析失败按失败处理 */ }
    }
  }

  if (!prof) {
    const buf = await httpGetBuffer(`https://steamcommunity.com/profiles/${steamid}/?xml=1`)
    if (!buf) {
      // 网络失败：用过期缓存兜底（宁可用旧头像也不让页面空白）
      return steamProfileCache.get(steamid) ?? null
    }
    const xml = buf.toString('utf8')
    const mAv = xml.match(/<avatarFull><!\[CDATA\[([^\]]*)\]\]><\/avatarFull>/)
    const mPe = xml.match(/<steamID><!\[CDATA\[([^\]]*)\]\]><\/steamID>/)
    prof = {
      avatar: mAv ? mAv[1] : '',
      persona: mPe ? mPe[1] : '',
      expires: Date.now() + STEAM_PROFILE_TTL,
    }
  }

  steamProfileCache.set(steamid, prof)
  return prof
}

// ================= API 路由 =================

async function handleApi(req, res, url, method) {
  const p = url.pathname.replace(/\/+$/, '') || '/'

  res.setHeader('Cache-Control', 'no-store')
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !isSameOrigin(req)) return sendJSON(res, 403, { success: false, message: '跨站请求被拒绝' })
  try {
    if (p === '/api/health' && method === 'GET') return sendJSON(res, 200, { success: true, status: 'ok' })
    // ---- 认证 ----
    if (p === '/api/auth/send-code' && method === 'POST') {
      const b = await readBody(req)
      // 真实客户端 IP：经 Cloudflare 时取 X-Forwarded-For 第一段，否则取 socket 地址
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || ''
      try {
        const r = await auth.sendCode(b.email, ip)
        return sendJSON(res, 200, { success: true, ...r })
      } catch (e) {
        // 业务错误（格式/限流/SMTP 未配置）统一 400 + 明确文案，不再静默
        return sendJSON(res, 400, { success: false, message: e.message })
      }
    }
    if (p === '/api/auth/register' && method === 'POST') {
      const b = await readBody(req)
      const r = auth.register(b.email, b.username, b.password, b.code)
      if (r && r.token) setSessionCookie(req, res, r.token)   // 注册即登录：下发 HttpOnly cookie
      return sendJSON(res, 200, { success: true, ...r })
    }
    if (p === '/api/auth/login' && method === 'POST') {
      const b = await readBody(req)
      // 真实客户端 IP（失败锁定按 IP 计数）：CF 时取 X-Forwarded-For 第一段
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || ''
      const { challenge, ...r } = auth.login(b.identifier, b.password, ip)
      if (challenge) {
        const secure = req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''
        res.setHeader('Set-Cookie', `pfc_2fa=${challenge}; HttpOnly; SameSite=Strict; Path=/api/auth/2fa; Max-Age=300${secure}`)
      }
      if (r && r.token) setSessionCookie(req, res, r.token)   // 登录成功：下发 HttpOnly cookie
      return sendJSON(res, 200, { success: true, ...r })
    }
    if (p === '/api/auth/2fa/verify' && method === 'POST') {
      const b = await readBody(req)
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || ''
      const challenge = (req.headers.cookie || '').match(/(?:^|;\s*)pfc_2fa=([^;]+)/)?.[1] || ''
      const r = auth.verify2fa(b.username, b.code, ip, challenge)
      if (r && r.token) setSessionCookie(req, res, r.token)   // 2FA 通过：下发 HttpOnly cookie
      return sendJSON(res, 200, { success: true, ...r })
    }
    if (p === '/api/auth/2fa/setup' && method === 'POST') {
      const user = currentUser(req)
      if (!user) return sendJSON(res, 401, { success: false, message: '未登录' })
      const r = auth.setup2fa(user)
      return sendJSON(res, 200, { success: true, ...r })
    }
    if (p === '/api/auth/2fa/enable' && method === 'POST') {
      const user = currentUser(req)
      if (!user) return sendJSON(res, 401, { success: false, message: '未登录' })
      const b = await readBody(req)
      auth.enable2fa(user, b.secret, b.code)
      return sendJSON(res, 200, { success: true })
    }
    if (p === '/api/auth/2fa/disable' && method === 'POST') {
      const user = currentUser(req)
      if (!user) return sendJSON(res, 401, { success: false, message: '未登录' })
      const b = await readBody(req)
      auth.disable2fa(user, b.code)
      return sendJSON(res, 200, { success: true })
    }
    if (p === '/api/auth/2fa/status' && method === 'GET') {
      const user = currentUser(req)
      if (!user) return sendJSON(res, 401, { success: false, message: '未登录' })
      const enabled = !!store.getTotpSecret(user.username)
      return sendJSON(res, 200, { success: true, enabled })
    }
    if (p === '/api/auth/logout' && method === 'POST') {
      const token = getBearer(req) || getCookieToken(req)
      if (token) store.destroySession(token)
      clearSessionCookie(res)   // 同时清掉 HttpOnly cookie
      return sendJSON(res, 200, { success: true })
    }
    if (p === '/api/auth/status' && method === 'GET') {
      // 首次安装引导：是否已有用户 / SMTP 是否已配置（无需登录）
      const hasUsers = Object.keys(store.getUsers()).length > 0
      return sendJSON(res, 200, {
        success: true,
        firstRun: !hasUsers,
        smtpConfigured: !!store.getSmtpConfig(),
      })
    }
    if (p === '/api/me' && method === 'GET') {
      const user = currentUser(req)
      if (!user) return sendJSON(res, 401, { success: false, message: '未登录' })
      return sendJSON(res, 200, { success: true, user })
    }

    // ---- 公告（需登录；配置读写仅管理员） ----
    if (p === '/api/announcement' && method === 'GET') {
      const user = currentUser(req)
      if (!user) return sendJSON(res, 401, { success: false, message: '未登录' })
      return sendJSON(res, 200, { success: true, announcement: store.getAnnouncement() })
    }
    if (p === '/api/admin/announcement' && method === 'GET') {
      const user = currentUser(req)
      auth.requireAdmin(user)
      return sendJSON(res, 200, { success: true, announcement: store.getAnnouncement() })
    }
    if (p === '/api/admin/announcement' && method === 'PUT') {
      const user = currentUser(req)
      auth.requireAdmin(user)
      const b = await readBody(req)
      const saved = store.saveAnnouncement(b)
      return sendJSON(res, 200, { success: true, announcement: saved })
    }

    // ---- 公告列表（正式公告页，多条目；写入/删除仅管理员） ----
    if (p === '/api/announcements' && method === 'GET') {
      const user = currentUser(req)
      if (!user) return sendJSON(res, 401, { success: false, message: '未登录' })
      return sendJSON(res, 200, { success: true, items: store.getAnnouncements() })
    }
    if (p === '/api/admin/announcements' && method === 'POST') {
      const user = currentUser(req)
      auth.requireAdmin(user)
      const b = await readBody(req)
      if (!String(b.title || '').trim()) {
        return sendJSON(res, 400, { success: false, message: '标题不能为空' })
      }
      const item = store.addAnnouncement({ title: b.title, content: b.content }, user.username)
      return sendJSON(res, 200, { success: true, item })
    }
    if (p.startsWith('/api/admin/announcements/') && method === 'DELETE') {
      const user = currentUser(req)
      auth.requireAdmin(user)
      const id = p.slice('/api/admin/announcements/'.length)
      const ok = store.removeAnnouncement(id)
      if (!ok) return sendJSON(res, 404, { success: false, message: '公告不存在' })
      return sendJSON(res, 200, { success: true })
    }

    // ---- 关于页内容（鸣谢/赞助；写入仅管理员） ----
    if (p === '/api/about' && method === 'GET') {
      const user = currentUser(req)
      if (!user) return sendJSON(res, 401, { success: false, message: '未登录' })
      return sendJSON(res, 200, { success: true, about: store.getAbout() })
    }
    if (p === '/api/admin/about' && method === 'PUT') {
      const user = currentUser(req)
      auth.requireAdmin(user)
      const b = await readBody(req)
      const saved = store.saveAbout({ thanks: b.thanks, sponsors: b.sponsors })
      return sendJSON(res, 200, { success: true, about: saved })
    }

    // ---- SL 数据/控制（替代旧 /api/sl/proxy）----
    // 只接受 serverId（当前用户已注册的服务器），目标 URL/token 全部来自平台存储，
    // 浏览器无法指定任意地址 —— SSRF 面收敛为"仅本人服务器"。
    // 数据读取：平台内部自动请求游戏服务器（DNS 校验 + 已校验 IP + 存储 token 注入）。
    if (p === '/api/sl/data' && method === 'GET') {
      const user = currentUser(req)
      if (!user) return sendJSON(res, 401, { success: false, message: '未登录' })
      const id = String(url.searchParams.get('serverId') || '')
      const server = store.listServers(user.username).find((s) => s.id === id)
      if (!server) return sendJSON(res, 404, { success: false, message: '服务器不存在' })
      // SLDataAPI v2.5.5：只读 GET 路径白名单（verify_token 通道）。
      // /plugins/adapted 适配插件发现；/plugins/<id>/<route> 适配插件只读子路径。
      const path = String(url.searchParams.get('path') || '/get_sl_data')
      if (!isAllowedReadOnlyPath(path)) {
        return sendJSON(res, 400, { success: false, message: 'path 不在只读白名单' })
      }
      const r = await fetchGameServerToBuffer(server, 'GET', path)
      if (!r.ok) {
        return sendJSON(res, r.status && r.status >= 400 ? r.status : 502, {
          success: false, message: r.message || '游戏服务器请求失败',
        })
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(r.data))
      return
    }
    // 控制调用：经 WS 枢纽协商式执行（按 controlTransport 自动选择通道 + mismatch 翻转）。
    if (p === '/api/sl/call' && method === 'POST') {
      const user = currentUser(req)
      if (!user) return sendJSON(res, 401, { success: false, message: '未登录' })
      const b = await readBody(req)
      const id = String(b.serverId || '')
      const path = String(b.path || '')
      if (!isAllowedControlPath(path)) {
        return sendJSON(res, 400, { success: false, message: 'path 非法' })
      }
      const server = store.listServers(user.username).find((s) => s.id === id)
      if (!server) return sendJSON(res, 404, { success: false, message: '服务器不存在' })
      if (user.role === 'guest') return sendJSON(res, 403, { success: false, message: '访客不可执行控制操作' })
      const r = await wsHub.callForServer(server, path, b.body)
      const status = r.status && r.status >= 200 && r.status < 300 ? 200 : (r.status || 502)
      const bodyObj = r.data ?? { success: false, message: r.message || '上游错误' }
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj))
      return
    }

    // ---- 服务器配置（需登录，按用户隔离） ----
    if (p === '/api/servers' && method === 'GET') {
      const user = currentUser(req)
      if (!user) return sendJSON(res, 401, { success: false, message: '未登录' })
      // 凭据打码：token/API Key 不回传明文（代理层使用平台存储值，前端无需持有）
      return sendJSON(res, 200, { success: true, servers: store.listServers(user.username).map(sanitizeServer) })
    }
    if (p === '/api/servers' && method === 'POST') {
      const user = currentUser(req)
      if (!user) return sendJSON(res, 401, { success: false, message: '未登录' })
      const b = await readBody(req)
      // 输入校验：host 必须是合法主机名/IP（防 URL 注入），端口限 1-65535
      const verr = validateServerInput(b)
      if (verr) return sendJSON(res, 400, { success: false, message: verr })
      // DNS 解析校验：域名解析到回环/链路本地/全零一律拒绝；私网仅管理员
      // （堵 nip.io/sslip.io/localtest.me 类域名绕过 IP 字面量拦截的 SSRF）
      const hostCheck = await resolveHostChecked(b.host, (user.role ?? 'guest') === 'admin')
      if (!hostCheck.ok) return sendJSON(res, 400, { success: false, message: hostCheck.error })
      // 私网/回环主机仅管理员可注册（开放注册下防内网 SSRF）
      if (isPrivateHost(b.host) && user.role !== 'admin') {
        return sendJSON(res, 400, { success: false, message: '私网/本机地址仅管理员可注册' })
      }
      // 越权防御：guest 角色强制不允许 API Key（服务端强制，前端隐藏只是体验层）
      const apiKey = user.role === 'guest' ? '' : String(b.apiKey || b.controlToken || '')
      const s = store.addServer(user.username, { ...b, apiKey })
      return sendJSON(res, 200, { success: true, server: sanitizeServer(s) })
    }
    if (p.startsWith('/api/servers/') && method === 'PUT') {
      const user = currentUser(req)
      if (!user) return sendJSON(res, 401, { success: false, message: '未登录' })
      const id = p.slice('/api/servers/'.length)
      const b = await readBody(req)
      const verr = validateServerInput(b)
      if (verr) return sendJSON(res, 400, { success: false, message: verr })
      const hostCheck = await resolveHostChecked(b.host, (user.role ?? 'guest') === 'admin')
      if (!hostCheck.ok) return sendJSON(res, 400, { success: false, message: hostCheck.error })
      if (isPrivateHost(b.host) && user.role !== 'admin') {
        return sendJSON(res, 400, { success: false, message: '私网/本机地址仅管理员可注册' })
      }
      const patch = { ...b }
      if (user.role === 'guest') patch.apiKey = ''
      else if (b.apiKey !== undefined || b.controlToken !== undefined) {
        patch.apiKey = String(b.apiKey ?? b.controlToken ?? '')
      }
      const s = store.updateServer(user.username, id, patch)
      if (s) wsHub.invalidateServer(id)
      if (!s) return sendJSON(res, 404, { success: false, message: '服务器不存在' })
      return sendJSON(res, 200, { success: true, server: sanitizeServer(s) })
    }
    if (p.startsWith('/api/servers/') && method === 'DELETE') {
      const user = currentUser(req)
      if (!user) return sendJSON(res, 401, { success: false, message: '未登录' })
      const id = p.slice('/api/servers/'.length)
      if (!store.removeServer(user.username, id)) {
        return sendJSON(res, 404, { success: false, message: '服务器不存在' })
      }
      wsHub.invalidateServer(id)
      return sendJSON(res, 200, { success: true })
    }

    // ---- 管理员 ----
    if (p === '/api/admin/smtp' && method === 'GET') {
      const user = currentUser(req)
      auth.requireAdmin(user)
      const smtp = store.getSmtpConfig()
      return sendJSON(res, 200, {
        success: true,
        smtp: smtp
          ? {
              authMode: smtp.authMode,
              host: smtp.host, port: smtp.port, user: smtp.user, from: smtp.from,
              clientId: smtp.clientId,
              configured: true,
            }
          : { configured: false },
      })
    }
    if (p === '/api/admin/smtp' && method === 'PUT') {
      const user = currentUser(req)
      auth.requireAdmin(user)
      const b = await readBody(req)
      store.setSmtpConfig({
        authMode: b.authMode, host: b.host, port: b.port, user: b.user,
        pass: b.pass, from: b.from,
        clientId: b.clientId, clientSecret: b.clientSecret, refreshToken: b.refreshToken,
      })
      return sendJSON(res, 200, { success: true })
    }
    if (p === '/api/admin/smtp/test' && method === 'POST') {
      // 测试发送：用表单当前值（不保存）真实发一封，报告 host/端口/解析 IP，用于定位配置问题
      const user = currentUser(req)
      auth.requireAdmin(user)
      const b = await readBody(req)
      // 收件人优先级：显式 to > 发信邮箱 user > 发件人 from（from 可能只是显示名，必须最后兜底）
      const to = String(b.to || b.user || b.from || '').trim()
      if (!to) return sendJSON(res, 400, { success: false, message: '缺少测试收件地址（请填写发信邮箱或收件地址）' })
      const cfg = {
        authMode: b.authMode === 'oauth2' ? 'oauth2' : 'password',
        host: b.host, port: b.port, user: b.user, pass: b.pass, from: b.from,
        clientId: b.clientId, clientSecret: b.clientSecret, refreshToken: b.refreshToken,
      }
      try {
        const r = await mail.sendTest(cfg, to)
        return sendJSON(res, 200, { success: true, ...r })
      } catch (e) {
        return sendJSON(res, 200, { success: false, message: e.message, host: e.host, port: e.port, ip: e.ip })
      }
    }
    if (p === '/api/admin/smtp/oauth2/start' && method === 'GET') {
      // 生成微软授权 URL（读取已保存的 clientId/clientSecret；浏览器跳转过去）
      const user = currentUser(req)
      auth.requireAdmin(user)
      const smtp = store.getSmtpConfig()
      if (!smtp || !smtp.clientId || !smtp.clientSecret) {
        return sendJSON(res, 400, { success: false, message: '请先在邮箱配置中保存 Client ID / Client Secret（OAuth2 模式）' })
      }
      const state = crypto.randomToken(24)
      oauthStates.set(state, { clientId: smtp.clientId, clientSecret: smtp.clientSecret, expires: Date.now() + 10 * 60 * 1000 })
      // 顺手清理过期会话
      for (const [k, v] of oauthStates) if (v.expires < Date.now()) oauthStates.delete(k)
      const redirectUri = oauthRedirectUri(req)
      const url = OAUTH_AUTH_URL +
        '?client_id=' + encodeURIComponent(smtp.clientId) +
        '&response_type=code' +
        '&redirect_uri=' + encodeURIComponent(redirectUri) +
        '&scope=' + encodeURIComponent(OAUTH_SCOPE) +
        '&response_mode=query' +
        '&state=' + encodeURIComponent(state)
      return sendJSON(res, 200, { success: true, url, redirectUri })
    }
    if (p === '/api/admin/smtp/oauth2/callback' && method === 'GET') {
      // 微软回跳（浏览器直达，无 Authorization 头 —— state 即凭证，10 分钟有效）
      const q = new URLSearchParams(url.search || '')
      const code = q.get('code')
      const state = q.get('state')
      const errMsg = q.get('error_description') || q.get('error')
      const entry = state ? oauthStates.get(state) : null
      if (errMsg) {
        return redirectOAuth(res, '/settings?oauth=error&msg=' + encodeURIComponent('微软拒绝授权：' + errMsg))
      }
      if (!code || !entry) {
        return redirectOAuth(res, '/settings?oauth=error&msg=' + encodeURIComponent('授权回调无效或已过期，请重新点击"连接 Microsoft 账号"'))
      }
      oauthStates.delete(state)
      try {
        const tok = await oauthExchange({
          client_id: entry.clientId,
          client_secret: entry.clientSecret,
          code,
          redirect_uri: oauthRedirectUri(req),
          grant_type: 'authorization_code',
          scope: OAUTH_SCOPE,
        })
        let email = ''
        try {
          const idt = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString('utf8'))
          email = idt.email || idt.preferred_username || ''
        } catch { /* id_token 缺失时发信邮箱保持原值 */ }
        const cur = store.getSmtpConfig() || {}
        store.setSmtpConfig({
          authMode: 'oauth2',
          host: cur.host || 'smtp.office365.com',
          port: cur.port || 587,
          user: email || cur.user || '',
          pass: cur.pass,
          from: cur.from || '',
          clientId: entry.clientId,
          clientSecret: entry.clientSecret,
          refreshToken: tok.refresh_token || '',
        })
        console.log(`[PFC] OAuth2 授权成功：${email || '(邮箱未知)'}`)
        return redirectOAuth(res, '/settings?oauth=ok')
      } catch (e) {
        return redirectOAuth(res, '/settings?oauth=error&msg=' + encodeURIComponent('换取 token 失败：' + e.message))
      }
    }
    if (p === '/api/admin/users' && method === 'GET') {
      const user = currentUser(req)
      auth.requireAdmin(user)
      const users = Object.values(store.getUsers()).map((u) => ({
        username: u.username, email: u.email, role: u.role ?? 'guest', createdAt: u.createdAt,
      }))
      return sendJSON(res, 200, { success: true, users })
    }
    if (p === '/api/admin/users' && method === 'POST') {
      const user = currentUser(req)
      auth.requireAdmin(user)
      const b = await readBody(req)
      const email = String(b.email || '').trim().toLowerCase()
      if (!/^[A-Za-z0-9._%+-]+@qq\.com$/i.test(email)) {
        return sendJSON(res, 400, { success: false, message: '仅支持 QQ 邮箱（@qq.com）' })
      }
      auth.validateCredentials(String(b.username || ''), b.password)
      if (store.getUser(b.username)) return sendJSON(res, 400, { success: false, message: '用户名已被占用' })
      const role = ['admin', 'user', 'guest'].includes(b.role) ? b.role : 'guest'
      store.upsertUser(b.username, {
        username: String(b.username).trim(),
        email,
        role,
        passwordHash: require('./crypto').hashPassword(b.password),
        createdAt: Date.now(),
      })
      return sendJSON(res, 200, { success: true })
    }
    if (p.startsWith('/api/admin/users/')) {
      const username = p.slice('/api/admin/users/'.length)
      const admin = currentUser(req)
      auth.requireAdmin(admin)
      const target = store.getUser(username)
      if (!target) return sendJSON(res, 404, { success: false, message: '用户不存在' })

      if (method === 'DELETE') {
        const targetRole = target.role ?? 'guest'
        if (targetRole === 'admin') {
          const admins = Object.values(store.getUsers()).filter((u) => (u.role ?? 'guest') === 'admin')
          if (admins.length <= 1) return sendJSON(res, 400, { success: false, message: '不能删除最后一个管理员' })
        }
        store.deleteUser(username)
        return sendJSON(res, 200, { success: true })
      }
      if (method === 'PUT') {
        const b = await readBody(req)
        if (b.role) {
          if (!['admin', 'user', 'guest'].includes(b.role)) {
            return sendJSON(res, 400, { success: false, message: '无效角色' })
          }
          const targetRole = target.role ?? 'guest'
          if (targetRole === 'admin' && b.role !== 'admin') {
            const admins = Object.values(store.getUsers()).filter((u) => (u.role ?? 'guest') === 'admin')
            if (admins.length <= 1) return sendJSON(res, 400, { success: false, message: '不能降级最后一个管理员' })
          }
          target.role = b.role
        }
        if (b.password) {
          if (typeof b.password !== 'string' || b.password.length < 8) {
            return sendJSON(res, 400, { success: false, message: '密码至少 8 位' })
          }
          target.passwordHash = require('./crypto').hashPassword(b.password)
        }
        store.upsertUser(username, target)
        return sendJSON(res, 200, { success: true })
      }
    }
    if (p === '/api/admin/steam' && method === 'GET') {
      const user = currentUser(req)
      auth.requireAdmin(user)
      const key = steamApiKey()
      return sendJSON(res, 200, {
        success: true,
        configured: !!key,
        // 只回显首尾片段，完整 key 不回传浏览器（防泄露到前端状态/截图）
        hint: key.length >= 8 ? `${key.slice(0, 3)}…${key.slice(-3)}` : '',
      })
    }
    if (p === '/api/admin/steam' && method === 'PUT') {
      const user = currentUser(req)
      auth.requireAdmin(user)
      const b = await readBody(req)
      store.setSteamKey(String(b.key || ''))
      return sendJSON(res, 200, { success: true })
    }

    // ---- Steam 资料/头像（需登录；平台代理 steamcommunity + Steam CDN，规避 CORS/CSP） ----
    if (p === '/api/steam/profile' && method === 'GET') {
      const user = currentUser(req)
      if (!user) return sendJSON(res, 401, { success: false, message: '未登录' })
      const steamid = String(url.searchParams.get('steamid') || '').trim()
      if (!/^7656\d{13}$/.test(steamid)) {
        return sendJSON(res, 400, { success: false, message: 'steamid 非法' })
      }
      const prof = await getSteamProfile(steamid)
      if (!prof || !prof.avatar) return sendJSON(res, 404, { success: false, message: '获取 Steam 资料失败' })
      return sendJSON(res, 200, {
        success: true,
        steamId: steamid,
        persona: prof.persona,
        avatar: `/api/steam/avatar?steamid=${steamid}`,
      })
    }
    if (p === '/api/steam/avatar' && method === 'GET') {
      const user = currentUser(req)
      if (!user) return sendJSON(res, 401, { success: false, message: '未登录' })
      const steamid = String(url.searchParams.get('steamid') || '').trim()
      if (!/^7656\d{13}$/.test(steamid)) {
        return sendJSON(res, 400, { success: false, message: 'steamid 非法' })
      }
      const prof = await getSteamProfile(steamid)
      if (!prof || !prof.avatar) {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ success: false, message: '无头像' }))
        return
      }
      let img = avatarImageCache.get(steamid)
      if (!img) {
        // 国内网络：cloudflare 镜像优先，原址兜底
        for (const u of avatarMirrorUrls(prof.avatar)) {
          img = await httpGetBuffer(u, 8000, 512 * 1024)
          if (img) break
        }
        if (!img) {
          res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ success: false, message: '头像下载失败' }))
          return
        }
        if (avatarImageCache.size >= 300) {
          const first = avatarImageCache.keys().next().value
          if (first !== undefined) avatarImageCache.delete(first)
        }
        avatarImageCache.set(steamid, img)
      }
      res.writeHead(200, {
        'content-type': 'image/jpeg',
        'cache-control': 'public, max-age=86400',
      })
      res.end(img)
      return
    }

    return sendJSON(res, 404, { success: false, message: 'not found' })
  } catch (e) {
    // 限流类错误：429 + Retry-After（登录/2FA 失败锁定）
    if (e && e.statusCode) {
      if (e.retryAfter) res.setHeader('Retry-After', String(e.retryAfter))
      return sendJSON(res, e.statusCode, { success: false, message: e instanceof Error ? e.message : String(e) })
    }
    return sendJSON(res, 400, { success: false, message: e instanceof Error ? e.message : String(e) })
  }
}

// ================= HTTP(S) 服务 =================

/** 主请求处理器。 */
async function handleRequest(req, res) {
  applySecurityHeaders(res)   // 所有响应统一安全头
  const url = req.url ?? '/'
  const parsed = new URL(url, 'http://x')
  const method = req.method ?? 'GET'

  // 平台 API（/api/sl/data、/api/sl/call 等内置于 handleApi：
  // 不再暴露通用 URL 代理，浏览器只能按 serverId 请求自己已注册的服务器，
  // 由平台内部自动请求游戏服务器 —— SSRF 面收敛为"仅本人服务器"）
  if (parsed.pathname.startsWith('/api/')) {
    return handleApi(req, res, parsed, method)
  }

  return serveStatic(req, res, ROOT, parsed.pathname)
}

// ---- SSL 支持 ----
// 证书来源（按优先级）：
//   1. 环境变量 SSL_CERT_PATH / SSL_KEY_PATH
//   2. certs/cert.pem + certs/key.pem（安装脚本可自动放置）
function resolveTls() {
  const certPath = process.env.SSL_CERT_PATH || path.join(__dirname, 'certs', 'cert.pem')
  const keyPath = process.env.SSL_KEY_PATH || path.join(__dirname, 'certs', 'key.pem')
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) return null
  try {
    return {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    }
  } catch {
    return null
  }
}

const tls = resolveTls()

// ================= 语音转发 WebSocket 代理（v2.3） =================
// 浏览器 WS → 平台（登录+白名单+私网限制）→ 游戏服务器语音 WS（注入 API Key）。
// 上游使用原生 HTTP Upgrade，以便发送 Authorization 头且不把密钥放进 URL。

/** 解析升级请求里的 Cookie 会话（复用 HTTP 会话）。 */
function getCookieFromUpgrade(req) {
  const cookie = req.headers.cookie || ''
  for (const part of cookie.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const k = part.slice(0, idx).trim()
    if (k === 'pfc_session') return part.slice(idx + 1).trim()
  }
  return ''
}

/** 处理浏览器 → 平台的 WS 升级：/api/sl/voice?target=host%3Aport */
async function handleVoiceUpgrade(req, socket, head) {
  const parsed = new URL(req.url || '/', 'http://x')
  if (parsed.pathname !== '/api/sl/voice') return false
  if (!isSameOrigin(req)) { socket.destroy(); return true }

  const deny = (code, msg) => {
    // WS 握手失败：直接返回 HTTP 错误并关闭
    const reason = code === 401 ? 'Unauthorized'
      : code === 403 ? 'Forbidden'
        : code === 502 ? 'Bad Gateway'
          : 'Bad Request'
    socket.write(
      `HTTP/1.1 ${code} ${reason}\r\n` +
      'Content-Type: application/json\r\nConnection: close\r\n\r\n' +
      JSON.stringify({ success: false, error: msg })
    )
    socket.destroy()
  }

  try {
    // ★ 关键：upgrade 事件回调结束后，Node 会销毁没有 data 监听器的 socket。
    //   本函数是 async（DNS 校验要 await），在第一个 await 之前必须【同步接管】
    //   socket，否则浏览器侧会收到 1006（异常断开）——这是"WS 一连接就断"的根因。
    socket.on('data', () => { /* 占位：标记 socket 已被接管，真实转发在桥接后注册 */ })
    socket.on('error', () => { /* 占位：防未捕获异常 */ })
    socket.pause() // 上游握手完成前不丢弃浏览器提前发来的帧

    // 1. 登录校验（复用 HTTP 会话 cookie）
    const user = currentUser({ headers: { cookie: req.headers.cookie || '' } })
    if (!user) return deny(401, 'proxy: 未登录'), true
    if (user.role === 'guest') return deny(403, '访客不可使用语音控制'), true

    // 2. 目标解析 + 白名单
    const targetHost = parsed.searchParams.get('target') || ''
    const [host, portStr] = targetHost.split(':')
    const port = Number(portStr)
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return deny(400, 'proxy: target 非法'), true
    }
    const match = store.listServers(user.username)
      .find((s) => s.host.toLowerCase() === host.toLowerCase() && Number(s.port) === port)
    if (!match) return deny(403, 'proxy: 目标不在已注册服务器列表中'), true
    if (isForbiddenTarget(host)) return deny(403, 'proxy: 目标地址被禁止'), true

    // 3. DNS 校验 + 私网限制（与 HTTP 代理一致）
    const hostCheck = await resolveHostChecked(host, user.role === 'admin')
    if (!hostCheck.ok) return deny(403, `proxy: ${hostCheck.error}`), true
    if (isPrivateHost(host) && user.role !== 'admin') {
      return deny(403, 'proxy: 私网目标仅管理员可用'), true
    }

    // 4. API Key 注入（凭据平台存储，浏览器不持有）
    const apiKey = match.apiKey || ''
    if (!apiKey) return deny(403, 'proxy: 该服务器未配置 API Key'), true

    // 5. 语音端口：优先目标服务器注册时配置（默认 8082）
    const voicePort = Number(parsed.searchParams.get('voice_port') || 8082)
    if (!Number.isInteger(voicePort) || voicePort < 1 || voicePort > 65535) return deny(400, '语音端口无效'), true
    // 6. 先完成到上游的带头 Upgrade；成功后再接受浏览器握手。
    const upstreamKey = require('node:crypto').randomBytes(16).toString('base64')
    const upstream = await new Promise((resolve) => {
      const upReq = http.request({
        host: hostCheck.ips[0],
        port: voicePort,
        path: '/ws',
        headers: {
          Host: `${host}:${voicePort}`,
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': upstreamKey,
          'Sec-WebSocket-Version': '13',
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 8000,
      })
      upReq.once('upgrade', (_res, upSocket, upHead) => resolve({ socket: upSocket, head: upHead }))
      upReq.once('response', (upRes) => {
        upRes.resume()
        resolve({ error: `上游拒绝连接（HTTP ${upRes.statusCode || 502}）` })
      })
      upReq.once('timeout', () => upReq.destroy(new Error('timeout')))
      upReq.once('error', () => resolve({ error: '上游连接失败' }))
      upReq.end()
    })
    if (upstream.error) return deny(502, `voice: ${upstream.error}`), true
    if (socket.destroyed) { upstream.socket.destroy(); return true }

    const browserKey = (req.headers['sec-websocket-key'] || '').trim()
    const accept = require('node:crypto').createHash('sha1')
      .update(browserKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    )

    // 7. 两侧都已完成 WebSocket 握手，原始帧可直接双向转发：浏览器帧带 mask，
    //    上游帧不带 mask，正好符合各自对客户端/服务端帧的要求。
    if (head?.length) upstream.socket.write(head)
    if (upstream.head?.length) socket.write(upstream.head)
    socket.pipe(upstream.socket).pipe(socket)
    socket.resume()
    const closePeer = () => {
      try { socket.destroy() } catch { /* ignore */ }
      try { upstream.socket.destroy() } catch { /* ignore */ }
    }
    socket.once('error', closePeer)
    upstream.socket.once('error', closePeer)
    const sessionCheck = setInterval(() => {
      const live = currentUser(req)
      if (!live || live.role === 'guest' || !store.listServers(live.username).some(s => s.id === match.id && s.apiKey === apiKey)) closePeer()
    }, 30000)
    sessionCheck.unref()
    socket.once('close', () => clearInterval(sessionCheck))
    socket.once('close', closePeer)
    upstream.socket.once('close', closePeer)
  } catch (e) {
    console.error('[PFC] voice upgrade 外层异常:', e && e.stack ? e.stack : e)
    try { socket.destroy() } catch { /* ignore */ }
  }
  return true
}

// 顶层异常兜底：async handleRequest 抛错时若响应未发送则回 502 JSON，
// 避免响应悬空导致 cloudflared 返回 502 HTML（前端显示"代理转发失败"）
function safeHandle(req, res) {
  handleRequest(req, res).catch((e) => {
    try {
      console.error('[PFC] handleRequest 异常:', e && e.stack ? e.stack : e)
    } catch { /* ignore */ }
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: 'proxy: 内部错误' }))
    } else {
      try { res.end() } catch { /* ignore */ }
    }
  })
}

function safeUpgrade(req, socket, head) {
  socket.on('error', () => socket.destroy())
  try {
    const parsed = new URL(req.url || '/', 'http://x')
    if (parsed.pathname === '/api/sl/ws') { wsHub.attach(req, socket, head); return }
    void handleVoiceUpgrade(req, socket, head).then((handled) => {
      if (handled === false) socket.destroy() // 非语音路径的 WS：拒绝
    }).catch(() => socket.destroy())
  } catch { socket.destroy() }
}

if (tls) {
  const secureServer = https.createServer(tls, safeHandle)
  secureServer.on('upgrade', safeUpgrade)
  // TLS 握手失败诊断（525 排查用）：记录错误码与来源，不中断服务
  secureServer.on('tlsClientError', (err, socket) => {
    try {
      console.error('[PFC] TLS handshake error:', (err && err.code) || '', (err && err.message) || '',
        'from', (socket && socket.remoteAddress) || '?')
    } catch { /* ignore */ }
  })
  listeners.push(secureServer)
  secureServer.listen(PORT, HOST, () => {
    console.log(`[PFC] HTTPS 平台服务已启动：https://${HOST}:${PORT} (dist: ${ROOT})`)
  })

  // 可选：80 端口 HTTP → HTTPS 重定向（HTTP_REDIRECT_PORT=80 时启用）
  const redirectPort = Number(process.env.HTTP_REDIRECT_PORT || 0)
  if (redirectPort > 0) {
    const redirectServer = http.createServer((req, res) => {
      const host = req.headers.host || 'localhost'
      res.writeHead(301, { Location: `https://${host}${req.url}` })
      res.end()
    })
    listeners.push(redirectServer)
    redirectServer.listen(redirectPort, HOST, () => {
      console.log(`[PFC] HTTP→HTTPS 重定向已启用：:${redirectPort} → https`)
    })
  }
} else {
  const plainServer = http.createServer(safeHandle)
  plainServer.on('upgrade', safeUpgrade)
  listeners.push(plainServer)
  plainServer.listen(PORT, HOST, () => {
    console.log(`[PFC] 平台服务已启动（HTTP）：http://${HOST}:${PORT} (dist: ${ROOT})`)
    console.log('[PFC] 提示：未检测到 SSL 证书 — 将 cert.pem/key.pem 放入 certs/ 或设置 SSL_CERT_PATH/SSL_KEY_PATH 以启用 HTTPS')
  })
}

if (!store.getSmtpConfig()) {
  console.log('[PFC] 提示：SMTP 未配置 — 登录管理员后在 设置 → 邮箱配置 中填写 QQ 邮箱与授权码')
}

// WS 控制枢纽依赖注入（函数均已声明，见 docs/ws-control-design.md）
wsHub.init({
  resolveUser: wsResolveUser,
  listServers: (username) => store.listServers(username),
  findServer: (id) => store.findServerById(id),
  isOwned: (username, id) => store.listServers(username).some((s) => s.id === id),
  fetchHttp: wsFetchHttp,
  resolveServerHost,
})

let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  wsHub.shutdown()
  for (const listener of listeners) listener.close()
  const timer = setTimeout(() => process.exit(0), 10000)
  timer.unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
