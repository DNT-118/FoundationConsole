// Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0
/**
 * 数据持久化：JSON 文件 + 原子写入（临时文件 + rename）。
 * 目录：server/data/
 *  - users.json      账户（密码 scrypt 哈希 + 邮箱 + 角色）
 *  - servers.json    服务器配置（apiKey 用主密钥 AES 加密存储）
 *  - sessions.json   会话 token → userId
 *  - codes.json      邮箱验证码
 *  - config.json     SMTP 配置（授权码加密存储）
 *  - master.key      主密钥（首次启动生成；优先用环境变量 PFC_MASTER_KEY）
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('./crypto')

// 测试和迁移校验可通过 PFC_DATA_DIR 使用隔离数据目录；生产默认仍为 server/data。
const DATA_DIR = process.env.PFC_DATA_DIR
  ? path.resolve(process.env.PFC_DATA_DIR)
  : path.join(__dirname, 'data')

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

/** 主密钥：环境变量优先，否则 data/master.key（首次生成）。 */
function masterKey() {
  if (process.env.PFC_MASTER_KEY) return process.env.PFC_MASTER_KEY
  ensureDir()
  const keyFile = path.join(DATA_DIR, 'master.key')
  if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf8').trim()
  const key = crypto.randomToken(48)
  fs.writeFileSync(keyFile, key, { mode: 0o600 })
  return key
}

/** 原子写入 JSON。 */
function saveJSON(name, data) {
  ensureDir()
  const file = path.join(DATA_DIR, name)
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600, flush: true })
  fs.renameSync(tmp, file)
}

/** 读取 JSON；不存在返回默认值。 */
function loadJSON(name, fallback) {
  ensureDir()
  const file = path.join(DATA_DIR, name)
  if (!fs.existsSync(file)) return fallback
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (cause) {
    // 数据损坏时禁止当作空库继续写入，尤其不能重新开放首管理员注册。
    const error = new Error(`无法读取 ${name}，请检查数据文件或恢复备份`, { cause })
    error.statusCode = 503
    throw error
  }
}

// ================= 账户 =================

function getUsers() {
  return loadJSON('users.json', { users: {} }).users
}

function saveUsers(users) {
  saveJSON('users.json', { users })
}

function getUser(username) {
  const users = getUsers()
  const key = String(username).toLowerCase()
  return Object.hasOwn(users, key) ? users[key] : null
}

function upsertUser(username, user) {
  const users = getUsers()
  Object.defineProperty(users, String(username).toLowerCase(), { value: user, enumerable: true, writable: true, configurable: true })
  saveUsers(users)
}

function deleteUser(username) {
  const users = getUsers()
  delete users[String(username).toLowerCase()]
  saveUsers(users)
}

// ================= 双因素（TOTP secret，加密存储） =================

function getTotpSecret(username) {
  const user = getUser(username)
  if (!user || !user.totpSecret) return null
  return crypto.decrypt(user.totpSecret, masterKey())
}

function setTotpSecret(username, secret) {
  const user = getUser(username)
  if (!user) return
  user.totpSecret = crypto.encrypt(secret, masterKey())
  upsertUser(username, user)
}

function clearTotpSecret(username) {
  const user = getUser(username)
  if (!user) return
  delete user.totpSecret
  delete user.totpLastStep
  upsertUser(username, user)
}

// ================= 会话 =================

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 天

function getSessions() {
  const raw = loadJSON('sessions.json', { sessions: {} }).sessions
  // 清理过期
  const now = Date.now()
  let dirty = false
  for (const [token, s] of Object.entries(raw)) {
    if (s.expiresAt < now) { delete raw[token]; dirty = true }
  }
  if (dirty) saveJSON('sessions.json', { sessions: raw })
  return raw
}

function createSession(userId) {
  const token = crypto.randomToken()
  const sessions = getSessions()
  sessions[token] = { userId, expiresAt: Date.now() + SESSION_TTL_MS }
  saveJSON('sessions.json', { sessions })
  return token
}

function getSessionUser(token) {
  if (!token) return null
  const s = getSessions()[token]
  if (!s) return null
  if (s.expiresAt < Date.now()) {
    destroySession(token)
    return null
  }
  return s.userId
}

function destroySession(token) {
  const sessions = getSessions()
  delete sessions[token]
  saveJSON('sessions.json', { sessions })
}

// ================= 服务器配置（按用户隔离） =================

function getServers() {
  return loadJSON('servers.json', { servers: [] }).servers
}

function saveServers(servers) {
  saveJSON('servers.json', { servers })
}

/** 加密存储服务器配置。旧 controlToken 字段只用于读取迁移，不再写回。 */
function encryptServer(s, mk) {
  const { controlToken: _legacyControlToken, ...rest } = s
  return {
    ...rest,
    token: crypto.encrypt(s.token ?? '', mk),
    apiKey: s.apiKey ? crypto.encrypt(s.apiKey, mk) : '',
  }
}

/** 解密后返回；兼容 2.5 时代以 controlToken 存储的记录。
 *  R4 迁移：旧记录无 owner/members —— owner 回填为 userId（原有"创建者即所有者"语义），members 置空。 */
function decryptServer(s, mk) {
  const encryptedApiKey = s.apiKey || s.controlToken || ''
  const { controlToken: _legacyControlToken, ...rest } = s
  return {
    ...rest,
    owner: rest.owner || rest.userId,
    members: rest.members && typeof rest.members === 'object' ? rest.members : {},
    token: crypto.decrypt(s.token, mk) ?? '',
    apiKey: encryptedApiKey ? (crypto.decrypt(encryptedApiKey, mk) ?? '') : '',
  }
}

/** 成员角色：viewer（只看数据）/ operator（值班操作）/ manager（管理成员与定时任务）。所有者恒为最高。 */
const SERVER_ROLES = ['viewer', 'operator', 'manager']

/** 用户对某服务器的有效角色：'owner' | 'manager' | 'operator' | 'viewer' | null（无访问）。 */
function accessRole(username, serverId) {
  const s = getServers().find((x) => x.id === serverId)
  if (!s) return null
  if (s.userId === username) return 'owner'
  const role = s.members?.[username]
  return SERVER_ROLES.includes(role) ? role : null
}

/** 用户可访问的服务器（自有 + 被分享），解密后附带计算字段 _role；sharedBy 标记分享来源。 */
function listServers(userId) {
  const mk = masterKey()
  return getServers()
    .filter((s) => s.userId === userId || (s.members && s.members[userId]))
    .map((s) => {
      const d = decryptServer(s, mk)
      d._role = d.owner === userId ? 'owner' : (s.members[userId] || 'viewer')
      if (d.owner !== userId) d.sharedBy = d.owner
      return d
    })
}

/** 添加成员（owner/manager 可调用；目标必须是平台已有用户且非所有者）。 */
function setMember(serverId, actorUsername, target, role) {
  if (!SERVER_ROLES.includes(role)) return { ok: false, error: '无效角色' }
  if (!getUser(target)) return { ok: false, error: '目标用户不存在' }
  const servers = getServers()
  const s = servers.find((x) => x.id === serverId)
  if (!s) return { ok: false, error: '服务器不存在' }
  const d = decryptServer(s, masterKey())
  const actorRole = accessRole(actorUsername, serverId)
  if (actorRole !== 'owner' && actorRole !== 'manager') return { ok: false, error: '仅所有者或管理者可管理成员' }
  if (target === d.owner) return { ok: false, error: '不能修改所有者的角色' }
  if (target !== actorUsername && actorRole !== 'owner') {
    // manager 只能授予不高于自己的角色
    const granted = SERVER_ROLES.indexOf(role)
    if (granted >= SERVER_ROLES.indexOf('manager')) return { ok: false, error: '管理者只能授予 operator 及以下角色' }
  }
  d.members[target] = role
  servers[servers.indexOf(s)] = encryptServer(d, masterKey())
  saveServers(servers)
  return { ok: true, members: Object.entries(d.members).map(([username, r]) => ({ username, role: r })) }
}

/** 移除成员（owner/manager 可调用；manager 只能移除 viewer/operator）。 */
function removeMember(serverId, actorUsername, target) {
  const servers = getServers()
  const s = servers.find((x) => x.id === serverId)
  if (!s) return { ok: false, error: '服务器不存在' }
  const d = decryptServer(s, masterKey())
  const actorRole = accessRole(actorUsername, serverId)
  if (actorRole !== 'owner' && actorRole !== 'manager') return { ok: false, error: '仅所有者或管理者可管理成员' }
  if (target === d.owner) return { ok: false, error: '不能移除所有者' }
  if (actorRole === 'manager' && d.members[target] === 'manager') {
    return { ok: false, error: '管理者不能移除其他管理者' }
  }
  if (!d.members[target]) return { ok: false, error: '该用户不是成员' }
  delete d.members[target]
  servers[servers.indexOf(s)] = encryptServer(d, masterKey())
  saveServers(servers)
  return { ok: true, members: Object.entries(d.members).map(([username, r]) => ({ username, role: r })) }
}

/** 成员列表（仅 owner/manager 可调用）。 */
function listMembers(serverId, actorUsername) {
  const s = getServers().find((x) => x.id === serverId)
  if (!s) return { ok: false, error: '服务器不存在' }
  const actorRole = accessRole(actorUsername, serverId)
  if (actorRole !== 'owner' && actorRole !== 'manager') return { ok: false, error: '仅所有者或管理者可查看成员' }
  return { ok: true, members: Object.entries(s.members || {}).map(([username, role]) => ({ username, role })) }
}

function addServer(userId, input) {
  const mk = masterKey()
  const servers = getServers()
  const s = encryptServer({
    id: 'srv_' + crypto.randomToken(6),
    userId,
    owner: userId,
    members: {},
    host: String(input.host || '').trim(),
    port: Number(input.port) || 8081,
    token: String(input.token || ''),
    apiKey: String(input.apiKey || input.controlToken || ''),
    label: input.label || '',
    controlTransport: input.controlTransport === 'ws' ? 'ws' : 'http',
    refetchInterval: Math.max(1000, Number(input.refetchInterval) || 5000),
    createdAt: Date.now(),
  }, mk)
  servers.push(s)
  saveServers(servers)
  return decryptServer(s, mk)
}

/** 更新自己的服务器；返回更新后的明文配置，未找到/不属于自己返回 null。 */
function updateServer(userId, id, patch) {
  const mk = masterKey()
  const servers = getServers()
  const idx = servers.findIndex((s) => s.id === id && s.userId === userId)
  if (idx < 0) return null
  const cur = decryptServer(servers[idx], mk)
  const merged = {
    ...cur,
    host: patch.host !== undefined ? String(patch.host).trim() : cur.host,
    port: patch.port !== undefined ? Number(patch.port) : cur.port,
    token: patch.token !== undefined ? String(patch.token) : cur.token,
    apiKey: patch.apiKey !== undefined
      ? String(patch.apiKey)
      : (patch.controlToken !== undefined ? String(patch.controlToken) : cur.apiKey),
    label: patch.label !== undefined ? String(patch.label) : cur.label,
    controlTransport: patch.controlTransport !== undefined ? (patch.controlTransport === 'ws' ? 'ws' : 'http') : cur.controlTransport,
    refetchInterval: patch.refetchInterval !== undefined ? Math.max(1000, Number(patch.refetchInterval)) : cur.refetchInterval,
  }
  servers[idx] = encryptServer(merged, mk)
  saveServers(servers)
  return decryptServer(servers[idx], mk)
}

function removeServer(userId, id) {
  const servers = getServers()
  const next = servers.filter((s) => !(s.id === id && s.userId === userId))
  if (next.length === servers.length) return false
  saveServers(next)
  return true
}

/** 按 id 查找服务器记录（解密后，含凭据）——WS 枢纽的轮询器/控制中继用（server.js 注入）。 */
function findServerById(id) {
  const mk = masterKey()
  const s = getServers().find((x) => x.id === id)
  return s ? decryptServer(s, mk) : null
}

// ================= 验证码 =================

function getCodes() {
  const raw = loadJSON('codes.json', { codes: {} }).codes
  const now = Date.now()
  let dirty = false
  for (const [email, c] of Object.entries(raw)) {
    if (c.expiresAt < now || c.sentAt > now) { delete raw[email]; dirty = true }
  }
  if (dirty) saveJSON('codes.json', { codes: raw })
  return raw
}

function setCode(email, code) {
  const codes = getCodes()
  codes[email] = { code, expiresAt: Date.now() + 5 * 60 * 1000, sentAt: Date.now() }
  saveJSON('codes.json', { codes })
}

/** 校验验证码（成功即删除，一次性）。连续 5 次错误即作废——防 6 位码在 5 分钟窗口内被暴力猜测。 */
function consumeCode(email, code) {
  const codes = getCodes()
  const entry = codes[email]
  if (!entry) return false
  if (entry.expiresAt < Date.now()) return false
  if (entry.code !== String(code).trim()) {
    entry.attempts = (entry.attempts || 0) + 1
    if (entry.attempts >= 5) delete codes[email]
    saveJSON('codes.json', { codes })
    return false
  }
  delete codes[email]
  saveJSON('codes.json', { codes })
  return true
}

/** 距上次发送的秒数（限流用）；未发送过返回 Infinity。 */
function codeCooldown(email) {
  const c = getCodes()[email]
  if (!c) return Infinity
  return (c.sentAt + 60 * 1000 - Date.now()) / 1000
}

// ================= SMTP 配置 =================

function getConfig() {
  return loadJSON('config.json', { smtp: null })
}

function saveConfig(cfg) {
  saveJSON('config.json', cfg)
}

/** 解密后的完整 SMTP 配置（仅服务端内部使用；GET 接口走 getSmtpView，绝不回明文）。 */
function getSmtpConfig() {
  const cfg = getConfig()
  if (!cfg.smtp) return null
  const mk = masterKey()
  return {
    authMode: cfg.smtp.authMode === 'oauth2' ? 'oauth2' : 'password',
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    user: cfg.smtp.user,
    pass: crypto.decrypt(cfg.smtp.pass, mk) ?? '',
    from: cfg.smtp.from,
    // Microsoft OAuth（设备码/授权码流程写入；refresh_token 加密落盘）
    msRefreshToken: crypto.decrypt(cfg.smtp.msRefreshToken ?? '', mk) ?? '',
    msAccountEmail: cfg.smtp.msAccountEmail || '',
    msTid: cfg.smtp.msTid || '',
    msSmtpHost: cfg.smtp.msSmtpHost || '',
    msNeedsReauth: !!cfg.smtp.msNeedsReauth,
  }
}

/** 密钥字段语义：undefined/'' = 保留原值；null = 显式清除；非空字符串 = 覆盖。 */
function keepSecret(prevPlain, v) {
  if (v === null) return ''
  if (v === undefined || v === '') return prevPlain || ''
  return String(v)
}

/**
 * 保存 SMTP 表单配置。
 *  - secret（pass）为空 = 保留原值，null = 清除（修复"保存时清空输入框会把密码抹掉"）；
 *  - Microsoft OAuth 令牌不经此表单进入/清除：由 saveMicrosoftAuth / clearMicrosoftAuth 管理。
 */
function setSmtpConfig(patch = {}) {
  const cfg = getConfig()
  const prev = cfg.smtp || {}
  const mk = masterKey()
  const prevPass = prev.pass ? (crypto.decrypt(prev.pass, mk) ?? '') : ''
  const nextPass = keepSecret(prevPass, patch.pass)
  cfg.smtp = {
    authMode: patch.authMode !== undefined
      ? (patch.authMode === 'oauth2' ? 'oauth2' : 'password')
      : (prev.authMode === 'oauth2' ? 'oauth2' : 'password'),
    host: String(patch.host ?? prev.host ?? 'smtp.qq.com').trim() || 'smtp.qq.com',
    port: Number(patch.port) || Number(prev.port) || 465,
    user: String(patch.user ?? prev.user ?? '').trim(),
    pass: nextPass ? crypto.encrypt(nextPass, mk) : '',
    from: String(patch.from ?? prev.from ?? '').trim(),
    msRefreshToken: prev.msRefreshToken || '',
    msAccountEmail: prev.msAccountEmail || '',
    msTid: prev.msTid || '',
    msSmtpHost: prev.msSmtpHost || '',
    msNeedsReauth: !!prev.msNeedsReauth,
  }
  saveConfig(cfg)
}

/**
 * Microsoft OAuth 授权 / 刷新轮换的落盘入口。
 * refreshToken 用 master.key AES-256-GCM 加密；accountEmail/tid/smtpHost 明文（非机密）。
 */
function saveMicrosoftAuth({ refreshToken, accountEmail, tid, smtpHost, needsReauth } = {}) {
  const cfg = getConfig()
  const prev = cfg.smtp || {}
  const mk = masterKey()
  cfg.smtp = {
    authMode: prev.authMode === 'oauth2' ? 'oauth2' : (prev.authMode || 'oauth2'),
    host: prev.host || 'smtp.qq.com',
    port: Number(prev.port) || 465,
    user: prev.user || accountEmail || '',
    pass: prev.pass || '',
    from: prev.from || '',
    msRefreshToken: refreshToken !== undefined
      ? (refreshToken ? crypto.encrypt(String(refreshToken), mk) : '')
      : (prev.msRefreshToken || ''),
    msAccountEmail: accountEmail !== undefined ? String(accountEmail || '') : (prev.msAccountEmail || ''),
    msTid: tid !== undefined ? String(tid || '') : (prev.msTid || ''),
    msSmtpHost: smtpHost !== undefined ? String(smtpHost || '') : (prev.msSmtpHost || ''),
    msNeedsReauth: needsReauth !== undefined ? !!needsReauth : !!prev.msNeedsReauth,
  }
  saveConfig(cfg)
}

/** 断开 Microsoft 账号：删除全部 MS 字段。 */
function clearMicrosoftAuth() {
  const cfg = getConfig()
  if (!cfg.smtp) return
  delete cfg.smtp.msRefreshToken
  delete cfg.smtp.msAccountEmail
  delete cfg.smtp.msTid
  delete cfg.smtp.msSmtpHost
  delete cfg.smtp.msNeedsReauth
  saveConfig(cfg)
}

/** GET /api/admin/smtp 的安全视图：secret 只回布尔，绝不回明文/令牌。 */
function getSmtpView() {
  const cfg = getConfig()
  if (!cfg.smtp) return { configured: false }
  const s = cfg.smtp
  return {
    configured: true,
    authMode: s.authMode === 'oauth2' ? 'oauth2' : 'password',
    host: s.host,
    port: s.port,
    user: s.user,
    from: s.from,
    secretConfigured: !!s.pass,
    ms: {
      refreshTokenConfigured: !!s.msRefreshToken,
      accountEmail: s.msAccountEmail || '',
      tid: s.msTid || '',
      hostOverride: s.msSmtpHost || '',
      needsReauth: !!s.msNeedsReauth,
    },
  }
}

// ================= 管理员引导标记 =================

/** 首个管理员是否已引导过（落盘于 config.json，用户数据被清空后也不会再次自动授管理员）。 */
function isAdminBootstrapped() {
  return !!getConfig().adminBootstrapped
}

function markAdminBootstrapped() {
  const cfg = getConfig()
  cfg.adminBootstrapped = true
  saveConfig(cfg)
}

// ================= Steam Web API Key =================

/** Steam Web API key（加密存储）；未配置返回空串。 */
function getSteamKey() {
  const cfg = getConfig()
  if (!cfg.steamKey) return ''
  return crypto.decrypt(cfg.steamKey, masterKey()) ?? ''
}

/** 保存/清除 Steam Web API key（空串 = 删除）。 */
function setSteamKey(key) {
  const cfg = getConfig()
  const k = String(key || '').trim()
  if (k) cfg.steamKey = crypto.encrypt(k, masterKey())
  else delete cfg.steamKey
  saveConfig(cfg)
}

// ================= 注册模式与邀请码（R4 定位：私有内部部署） =================

/** 注册模式：open（默认，QQ 邮箱自助注册）/ closed（关闭自助注册）/ invite（邀请制）。
 *  三种模式下 QQ 邮箱限制与邮箱验证码逻辑均不变；首个管理员引导不受模式限制。 */
const REGISTRATION_MODES = ['open', 'closed', 'invite']

function getRegistrationMode() {
  const m = getConfig().registrationMode
  return REGISTRATION_MODES.includes(m) ? m : 'open'
}

function setRegistrationMode(mode) {
  if (!REGISTRATION_MODES.includes(mode)) throw new Error('无效注册模式')
  const cfg = getConfig()
  cfg.registrationMode = mode
  saveConfig(cfg)
  return mode
}

function getInvites() {
  return loadJSON('invites.json', { invites: [] }).invites
}

function saveInvites(invites) {
  saveJSON('invites.json', { invites })
}

/** 生成一次性邀请码（仅管理员）。明文只在创建响应中返回一次，列表仅显示前缀。 */
function createInvite(createdBy) {
  const invites = getInvites()
  if (invites.filter((i) => !i.used).length >= 20) throw new Error('未使用的邀请码过多（上限 20），请先吊销')
  const invite = {
    id: 'iv_' + crypto.randomToken(6),
    code: 'inv_' + crypto.randomToken(12),
    createdBy: String(createdBy || ''),
    createdAt: Date.now(),
    used: false,
    usedBy: '',
    usedAt: 0,
  }
  invites.push(invite)
  saveInvites(invites)
  return invite
}

function listInvites() {
  // 脱敏：列表不回明文
  return getInvites().map((i) => ({ ...i, code: i.code.slice(0, 8) + '…' }))
}

function revokeInvite(id) {
  const invites = getInvites()
  const next = invites.filter((i) => !(i.id === id && !i.used))
  if (next.length === invites.length) return false
  saveInvites(next)
  return true
}

/** 校验邀请码有效性（不消费——注册全链路通过后才消费，避免验证码失败白烧邀请码）。 */
function validateInvite(code) {
  return getInvites().some((x) => x.code === String(code || '').trim() && !x.used)
}

/** 消费一次性邀请码（注册成功路径调用）。 */
function consumeInvite(code, username) {
  const invites = getInvites()
  const i = invites.find((x) => x.code === String(code || '').trim() && !x.used)
  if (!i) return false
  i.used = true
  i.usedBy = String(username || '')
  i.usedAt = Date.now()
  saveInvites(invites)
  return true
}

// ================= 玩家历史配置（R4） =================

/** 玩家历史保留天数（默认 30，1-365）。 */
function getPlayerHistoryDays() {
  const d = Number(getConfig().playerHistoryDays)
  return Number.isFinite(d) && d >= 1 && d <= 365 ? Math.floor(d) : 30
}

function setPlayerHistoryDays(days) {
  const cfg = getConfig()
  const d = Math.min(365, Math.max(1, Math.floor(Number(days) || 30)))
  cfg.playerHistoryDays = d
  saveConfig(cfg)
  return d
}

// ================= 公告 =================

const DEFAULT_ANNOUNCEMENT = {
  enabled: true,        // 公告页面是否启用
  popupEnabled: true,   // 登录通知弹窗是否启用
  version: 1,           // 内容版本（内容变更自动 +1，前端弹窗据版本判断是否再次提醒）
  title: { zh: '', en: '' },
  content: { zh: '', en: '' },
  updatedAt: 0,
}

/** 读取公告配置；不存在返回默认值（兜底合并，防旧数据缺字段）。 */
function getAnnouncement() {
  const a = loadJSON('announcement.json', null)
  if (!a) return JSON.parse(JSON.stringify(DEFAULT_ANNOUNCEMENT))
  return {
    ...DEFAULT_ANNOUNCEMENT,
    ...a,
    title: { ...DEFAULT_ANNOUNCEMENT.title, ...(a.title || {}) },
    content: { ...DEFAULT_ANNOUNCEMENT.content, ...(a.content || {}) },
  }
}

/** 保存公告配置；内容变化时自动提升 version（前端弹窗据版本判断是否再次提醒）。 */
function saveAnnouncement(data) {
  const prev = getAnnouncement()
  const next = {
    enabled: !!data.enabled,
    popupEnabled: !!data.popupEnabled,
    title: {
      zh: String(data.title?.zh ?? '').trim().slice(0, 300),
      en: String(data.title?.en ?? '').trim().slice(0, 300),
    },
    content: {
      zh: String(data.content?.zh ?? '').trim().slice(0, 20000),
      en: String(data.content?.en ?? '').trim().slice(0, 20000),
    },
  }
  const contentChanged =
    next.title.zh !== prev.title.zh || next.title.en !== prev.title.en ||
    next.content.zh !== prev.content.zh || next.content.en !== prev.content.en
  next.version = contentChanged ? (prev.version || 1) + 1 : (prev.version || 1)
  next.updatedAt = Date.now()
  saveJSON('announcement.json', next)
  return next
}

// ================= 公告列表（正式公告页，多条目） =================

/** 全部公告条目（按创建时间倒序）。 */
function getAnnouncements() {
  const items = loadJSON('announcements.json', { items: [] }).items || []
  return items.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

/** 新增公告；返回完整条目。 */
function addAnnouncement(data, author) {
  const items = loadJSON('announcements.json', { items: [] }).items || []
  const item = {
    id: 'a_' + crypto.randomToken(6),
    title: String(data.title || '').trim().slice(0, 300),
    content: String(data.content || '').trim().slice(0, 50000),
    author: String(author || ''),
    createdAt: Date.now(),
  }
  items.push(item)
  saveJSON('announcements.json', { items })
  return item
}

/** 删除公告；不存在返回 false。 */
function removeAnnouncement(id) {
  const items = loadJSON('announcements.json', { items: [] }).items || []
  const next = items.filter((i) => i.id !== id)
  if (next.length === items.length) return false
  saveJSON('announcements.json', { items: next })
  return true
}

// ================= 关于页（鸣谢 / 赞助，管理员可改） =================

/** 读取关于页内容；缺省返回空表。 */
function getAbout() {
  const a = loadJSON('about.json', null)
  return {
    thanks: Array.isArray(a?.thanks) ? a.thanks.map((x) => String(x).slice(0, 200)) : [],
    sponsors: Array.isArray(a?.sponsors) ? a.sponsors.map((x) => String(x).slice(0, 200)) : [],
  }
}

/** 保存关于页内容；支持数组或换行分隔文本。 */
function saveAbout(data) {
  const norm = (v) => {
    const arr = Array.isArray(v) ? v : String(v || '').split(/\r?\n/)
    return arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 100)
  }
  const next = { thanks: norm(data.thanks), sponsors: norm(data.sponsors) }
  saveJSON('about.json', next)
  return next
}

// ================= 通知规则（R4：基于控制 WS 事件） =================

/** 平台可订阅的 12 种真实事件（WsEventBridge）。 */
const NOTIFY_EVENTS = [
  'player_banned', 'player_kicked', 'player_escaped', 'player_role_changed', 'player_reported',
  'wave_respawned', 'decontamination_started', 'generator_activated', 'scp_terminated',
  'warhead_started', 'warhead_stopped', 'warhead_detonated',
]

function getNotifyRules() {
  return loadJSON('notifyRules.json', { rules: [] }).rules
}

function saveNotifyRules(rules) {
  saveJSON('notifyRules.json', { rules })
}

/** 规则上限（防滥用）。 */
const NOTIFY_RULES_MAX = 20

/** username 缺省 = 全部（调度/通知评估用）。 */
function listNotifyRules(username) {
  const all = getNotifyRules()
  return username ? all.filter((r) => r.username === username) : all
}

/** 校验并规范化规则；serverId '*' 表示全部可访问服务器。 */
function addNotifyRule(username, input) {
  const rules = getNotifyRules()
  if (rules.filter((r) => r.username === username).length >= NOTIFY_RULES_MAX) {
    throw new Error(`通知规则最多 ${NOTIFY_RULES_MAX} 条`)
  }
  const events = Array.isArray(input.events) ? input.events.filter((e) => NOTIFY_EVENTS.includes(e)) : []
  if (events.length === 0) throw new Error('至少选择一种事件')
  const rule = {
    id: 'nr_' + crypto.randomToken(6),
    username,
    serverId: input.serverId && input.serverId !== '*' ? String(input.serverId) : '*',
    events,
    inapp: input.inapp !== false,
    email: input.email === true,
    minIntervalSeconds: Math.min(3600, Math.max(10, Number(input.minIntervalSeconds) || 300)),
    enabled: input.enabled !== false,
    createdAt: Date.now(),
  }
  rules.push(rule)
  saveNotifyRules(rules)
  return rule
}

function updateNotifyRule(username, id, patch) {
  const rules = getNotifyRules()
  const r = rules.find((x) => x.id === id && x.username === username)
  if (!r) return null
  if (Array.isArray(patch.events)) {
    const events = patch.events.filter((e) => NOTIFY_EVENTS.includes(e))
    if (events.length === 0) throw new Error('至少选择一种事件')
    r.events = events
  }
  if (patch.serverId !== undefined) r.serverId = patch.serverId && patch.serverId !== '*' ? String(patch.serverId) : '*'
  if (patch.inapp !== undefined) r.inapp = patch.inapp !== false
  if (patch.email !== undefined) r.email = patch.email === true
  if (patch.enabled !== undefined) r.enabled = !!patch.enabled
  if (patch.minIntervalSeconds !== undefined) r.minIntervalSeconds = Math.min(3600, Math.max(10, Number(patch.minIntervalSeconds) || 300))
  saveNotifyRules(rules)
  return r
}

function removeNotifyRule(username, id) {
  const rules = getNotifyRules()
  const next = rules.filter((x) => !(x.id === id && x.username === username))
  if (next.length === rules.length) return false
  saveNotifyRules(next)
  return true
}

// ================= 平台内通知（通知中心收件箱） =================

const NOTIFY_INBOX_MAX = 100

function getNotifications() {
  return loadJSON('notifications.json', { items: [] }).items
}

function saveNotifications(items) {
  saveJSON('notifications.json', { items })
}

/** 追加一条平台内通知（每用户保留最近 NOTIFY_INBOX_MAX 条）。 */
function addNotification(item) {
  const items = getNotifications()
  items.unshift({
    id: 'nt_' + crypto.randomToken(8),
    read: false,
    ...item,
    utc: item.utc || new Date().toISOString(),
  })
  // 每用户只保留最新 N 条
  const perUser = new Map()
  for (const it of items) {
    const list = perUser.get(it.username) || []
    list.push(it)
    perUser.set(it.username, list)
  }
  const kept = []
  for (const list of perUser.values()) kept.push(...list.slice(0, NOTIFY_INBOX_MAX))
  saveNotifications(kept)
}

function listNotifications(username) {
  return getNotifications().filter((n) => n.username === username).slice(0, 50)
}

function markNotificationsRead(username, ids) {
  const items = getNotifications()
  const idSet = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null
  let changed = false
  for (const n of items) {
    if (n.username !== username) continue
    if (idSet && !idSet.has(n.id)) continue
    if (!n.read) { n.read = true; changed = true }
  }
  if (changed) saveNotifications(items)
  return changed
}

function clearNotifications(username) {
  saveNotifications(getNotifications().filter((n) => n.username !== username))
}

// ================= 定时任务（R4：定时广播 / CASSIE / 控制台命令） =================

const SCHEDULE_KINDS = ['broadcast', 'cassie', 'console']
const SCHEDULE_INTERVAL_MIN = 60        // 最小间隔 60s（防止高频刷屏）
const SCHEDULE_INTERVAL_MAX = 7 * 86400 // 最大 7 天
const SCHEDULE_RUNS_MAX = 20            // 每任务保留最近 20 条执行记录
const SCHEDULES_MAX = 50

function getSchedules() {
  return loadJSON('schedules.json', { schedules: [] }).schedules
}

function saveSchedules(schedules) {
  saveJSON('schedules.json', { schedules })
}

function listSchedules(username) {
  // 用户可访问（自有/被分享且 manager+）的服务器上的任务都可见
  const ids = new Set(listServers(username).map((s) => s.id))
  return getSchedules().filter((s) => ids.has(s.serverId))
}

/** 调度器专用：全部任务（不按用户过滤）。 */
function listSchedulesForScheduler() {
  return getSchedules()
}

function validateSchedulePayload(kind, payload) {
  const p = payload && typeof payload === 'object' ? payload : {}
  if (kind === 'broadcast') {
    const message = String(p.message || '').trim()
    if (!message || message.length > 500) throw new Error('广播内容不能为空且不超过 500 字符')
    const duration = Number(p.duration_seconds) || 5
    return { message, duration_seconds: Math.min(60, Math.max(1, duration)), clear_previous: p.clear_previous === true }
  }
  if (kind === 'cassie') {
    const message = String(p.message || '').trim()
    if (!message || message.length > 2000) throw new Error('CASSIE 播报内容不能为空且不超过 2000 字符')
    return {
      message,
      isNoisy: p.isNoisy !== false,
      ...(String(p.translation || '').trim() ? { translation: String(p.translation).trim() } : {}),
    }
  }
  if (kind === 'console') {
    const command = String(p.command || '').trim()
    if (!command || command.length > 500) throw new Error('命令不能为空且不超过 500 字符')
    if (/^(sldataapi|slda)\b/i.test(command)) throw new Error('禁止定时执行 sldataapi / slda 管理命令')
    return { command }
  }
  throw new Error('未知任务类型')
}

/** 创建定时任务（serverId 必须为 actor 可访问且 manager+ 的服务器）。 */
function addSchedule(actor, serverId, input) {
  const role = accessRole(actor, serverId)
  if (role !== 'owner' && role !== 'manager') throw new Error('仅所有者或管理者可创建定时任务')
  const kind = String(input.kind || '')
  if (!SCHEDULE_KINDS.includes(kind)) throw new Error('未知任务类型')
  const payload = validateSchedulePayload(kind, input.payload)
  const schedules = getSchedules()
  if (schedules.length >= SCHEDULES_MAX) throw new Error(`定时任务总数已达上限 ${SCHEDULES_MAX}`)
  const s = {
    id: 'sch_' + crypto.randomToken(6),
    serverId,
    username: actor,
    kind,
    payload,
    intervalSeconds: Math.min(SCHEDULE_INTERVAL_MAX, Math.max(SCHEDULE_INTERVAL_MIN, Number(input.intervalSeconds) || 300)),
    enabled: input.enabled !== false,
    createdAt: Date.now(),
    lastRunAt: 0,
    lastStatus: '',
    runs: [],
  }
  schedules.push(s)
  saveSchedules(schedules)
  return s
}

/** 更新（启用/暂停/改间隔/改内容）；actor 需 manager+。 */
function updateSchedule(actor, id, patch) {
  const schedules = getSchedules()
  const s = schedules.find((x) => x.id === id)
  if (!s) return null
  const role = accessRole(actor, s.serverId)
  if (role !== 'owner' && role !== 'manager') throw new Error('仅所有者或管理者可修改定时任务')
  if (patch.enabled !== undefined) {
    s.enabled = !!patch.enabled
    // 恢复启用时从当前时间重新计时，避免立即补跑历史欠账
    if (s.enabled) s.lastRunAt = Date.now()
  }
  if (patch.intervalSeconds !== undefined) {
    s.intervalSeconds = Math.min(SCHEDULE_INTERVAL_MAX, Math.max(SCHEDULE_INTERVAL_MIN, Number(patch.intervalSeconds) || 300))
  }
  if (patch.payload !== undefined) s.payload = validateSchedulePayload(s.kind, patch.payload)
  saveSchedules(schedules)
  return s
}

function removeSchedule(actor, id) {
  const schedules = getSchedules()
  const s = schedules.find((x) => x.id === id)
  if (!s) return false
  const role = accessRole(actor, s.serverId)
  if (role !== 'owner' && role !== 'manager') throw new Error('仅所有者或管理者可删除定时任务')
  saveSchedules(schedules.filter((x) => x.id !== id))
  return true
}

/** 调度器记录一次执行（持久化 lastRunAt 与滚动执行记录；服务重启后按 lastRunAt 恢复节奏）。 */
function recordScheduleRun(id, ok, message) {
  const schedules = getSchedules()
  const s = schedules.find((x) => x.id === id)
  if (!s) return
  s.lastRunAt = Date.now()
  s.lastStatus = ok ? 'ok' : 'fail'
  s.runs = [{ utc: new Date().toISOString(), ok, message: String(message || '').slice(0, 300) }, ...(s.runs || [])].slice(0, SCHEDULE_RUNS_MAX)
  saveSchedules(schedules)
}

module.exports = {
  masterKey,
  getUser, upsertUser, deleteUser, getUsers,
  getTotpSecret, setTotpSecret, clearTotpSecret,
  createSession, getSessionUser, destroySession,
  listServers, addServer, updateServer, removeServer, findServerById,
  setCode, consumeCode, codeCooldown,
  getSmtpConfig, setSmtpConfig, getSmtpView,
  saveMicrosoftAuth, clearMicrosoftAuth,
  accessRole, setMember, removeMember, listMembers,
  listNotifyRules, addNotifyRule, updateNotifyRule, removeNotifyRule, NOTIFY_EVENTS,
  addNotification, listNotifications, markNotificationsRead, clearNotifications,
  listSchedules, listSchedulesForScheduler, addSchedule, updateSchedule, removeSchedule, recordScheduleRun, validateSchedulePayload,
  getPlayerHistoryDays, setPlayerHistoryDays,
  getRegistrationMode, setRegistrationMode, createInvite, listInvites, revokeInvite, validateInvite, consumeInvite,
  getSteamKey, setSteamKey,
  isAdminBootstrapped, markAdminBootstrapped,
  getAnnouncement, saveAnnouncement,
  getAnnouncements, addAnnouncement, removeAnnouncement,
  getAbout, saveAbout,
}
