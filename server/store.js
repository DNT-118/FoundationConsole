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

/** 解密后返回；兼容 2.5 时代以 controlToken 存储的记录。 */
function decryptServer(s, mk) {
  const encryptedApiKey = s.apiKey || s.controlToken || ''
  const { controlToken: _legacyControlToken, ...rest } = s
  return {
    ...rest,
    token: crypto.decrypt(s.token, mk) ?? '',
    apiKey: encryptedApiKey ? (crypto.decrypt(encryptedApiKey, mk) ?? '') : '',
  }
}

function listServers(userId) {
  const mk = masterKey()
  return getServers()
    .filter((s) => s.userId === userId)
    .map((s) => decryptServer(s, mk))
}

function addServer(userId, input) {
  const mk = masterKey()
  const servers = getServers()
  const s = encryptServer({
    id: 'srv_' + crypto.randomToken(6),
    userId,
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

/** 校验验证码（成功即删除，一次性）。 */
function consumeCode(email, code) {
  const codes = getCodes()
  const entry = codes[email]
  if (!entry) return false
  if (entry.expiresAt < Date.now()) return false
  if (entry.code !== String(code).trim()) return false
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
    clientId: crypto.decrypt(cfg.smtp.clientId ?? '', mk) ?? '',
    clientSecret: crypto.decrypt(cfg.smtp.clientSecret ?? '', mk) ?? '',
    refreshToken: crypto.decrypt(cfg.smtp.refreshToken ?? '', mk) ?? '',
  }
}

function setSmtpConfig({ authMode, host, port, user, pass, from, clientId, clientSecret, refreshToken }) {
  const mk = masterKey()
  saveConfig({
    ...getConfig(),
    smtp: {
      authMode: authMode === 'oauth2' ? 'oauth2' : 'password',
      host: String(host || 'smtp.qq.com').trim(),
      port: Number(port) || 465,
      user: String(user || '').trim(),
      pass: crypto.encrypt(String(pass || ''), mk),
      from: String(from || '').trim(),
      clientId: crypto.encrypt(String(clientId || ''), mk),
      clientSecret: crypto.encrypt(String(clientSecret || ''), mk),
      refreshToken: crypto.encrypt(String(refreshToken || ''), mk),
    },
  })
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

module.exports = {
  masterKey,
  getUser, upsertUser, deleteUser, getUsers,
  getTotpSecret, setTotpSecret, clearTotpSecret,
  createSession, getSessionUser, destroySession,
  listServers, addServer, updateServer, removeServer, findServerById,
  setCode, consumeCode, codeCooldown,
  getSmtpConfig, setSmtpConfig,
  getSteamKey, setSteamKey,
  isAdminBootstrapped, markAdminBootstrapped,
  getAnnouncement, saveAnnouncement,
  getAnnouncements, addAnnouncement, removeAnnouncement,
  getAbout, saveAbout,
}
