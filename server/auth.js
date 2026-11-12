// Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0
/**
 * 认证业务：注册（仅 QQ 邮箱 + 验证码）/ 登录 / 会话 / 角色管理。
 * 所有函数抛出的错误消息直接返回给前端。
 */
const store = require('./store')
const crypto = require('./crypto')
const mail = require('./mail')
const totp = require('./totp')

const QQ_RE = /^[A-Za-z0-9._%+-]+@qq\.com$/i
const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{2,20}$/

/** 校验用户名/密码格式（与前端一致）。 */
function validateCredentials(username, password) {
  if (!USERNAME_RE.test(username)) {
    throw new Error('用户名需为 2-20 位字母/数字/下划线/中文')
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('密码至少 8 位')
  }
  if (password.length > 64) {
    throw new Error('密码过长（最多 64 位）')
  }
}

/** 发送注册验证码（仅 QQ 邮箱；按 IP + 邮箱双重限速，防验证码轰炸）。 */
const ipCodeCooldown = new Map()   // IP -> 上次发送时间戳（内存态，进程重启即清零）
// 按 IP 的发送配额（内存态）：每小时 10 封、每天 30 封，防邮件轰炸/SMTP 信誉消耗
const ipCodeQuota = new Map()      // IP -> { hourStart, hourCount, dayStart, dayCount }

function checkIpQuota(ip) {
  const now = Date.now()
  const q = ipCodeQuota.get(ip)
  if (!q) return
  if (now - q.hourStart < 3600000 && q.hourCount >= 10) {
    throw new Error('该来源发送验证码过于频繁，请 1 小时后再试')
  }
  if (now - q.dayStart < 86400000 && q.dayCount >= 30) {
    throw new Error('该来源今日发送验证码已达上限，请明天再试')
  }
}

function bumpIpQuota(ip) {
  const now = Date.now()
  let q = ipCodeQuota.get(ip)
  if (!q || now - q.dayStart >= 86400000) {
    q = { hourStart: now, hourCount: 0, dayStart: now, dayCount: 0 }
  } else if (now - q.hourStart >= 3600000) {
    q.hourStart = now
    q.hourCount = 0
  }
  q.hourCount++
  q.dayCount++
  ipCodeQuota.set(ip, q)
  if (ipCodeQuota.size > 5000) {
    for (const [k, v] of ipCodeQuota) if (now - v.dayStart >= 86400000) ipCodeQuota.delete(k)
  }
}

async function sendCode(email, ip) {
  email = String(email || '').trim().toLowerCase()
  if (!QQ_RE.test(email)) {
    throw new Error('仅支持 QQ 邮箱（@qq.com）注册')
  }
  if (Object.values(store.getUsers()).some(user => user.email?.toLowerCase() === email)) {
    throw new Error('该邮箱已注册')
  }
  const cooldown = store.codeCooldown(email)
  if (cooldown !== Infinity && cooldown > 0) {
    throw new Error(`发送过于频繁，请 ${Math.ceil(cooldown)} 秒后重试`)
  }
  // 同一 IP 60 秒内只允许发一次（不区分邮箱，防轰炸）
  const ipKey = ip || 'unknown'
  const lastIp = ipCodeCooldown.get(ipKey)
  if (lastIp && Date.now() - lastIp < 60000) {
    const wait = Math.ceil((60000 - (Date.now() - lastIp)) / 1000)
    throw new Error(`发送过于频繁，请 ${wait} 秒后重试`)
  }
  // 按 IP 的发送配额：每小时 10 封、每天 30 封（防邮件轰炸消耗 SMTP 信誉）
  checkIpQuota(ipKey)
  const smtp = store.getSmtpConfig()
  const code = crypto.randomCode()
  await mail.sendVerificationEmail(smtp, email, code)
  store.setCode(email, code)
  ipCodeCooldown.set(ipKey, Date.now())
  bumpIpQuota(ipKey)
  // 定期清理过期条目，防止 Map 无限膨胀
  if (ipCodeCooldown.size > 1000) {
    for (const [k, v] of ipCodeCooldown) if (Date.now() - v > 60000) ipCodeCooldown.delete(k)
  }
  return { ok: true }
}

/** 注册（首个账户免验证码：避免 SMTP 未配置时死锁；后续注册必须 QQ 邮箱验证码）。 */
function register(email, username, password, code) {
  email = String(email || '').trim().toLowerCase()
  username = String(username || '').trim()
  if (!QQ_RE.test(email)) throw new Error('仅支持 QQ 邮箱（@qq.com）注册')
  validateCredentials(username, password)

  // 首个管理员引导只允许发生一次：落盘标记后，即使用户数据被清空也不会再次
  // 出现"抢先注册即得管理员"（防审计报告问题 5）
  const isFirst = Object.keys(store.getUsers()).length === 0 && !store.isAdminBootstrapped()
  if (!isFirst) {
    // 非首次：必须通过邮箱验证码（防垃圾注册）
    if (!store.consumeCode(email, code)) {
      throw new Error('验证码错误或已过期')
    }
  }

  if (store.getUser(username)) throw new Error('用户名已被占用')
  if (Object.values(store.getUsers()).some(user => user.email?.toLowerCase() === email)) throw new Error('该邮箱已注册')

  store.upsertUser(username, {
    username,
    email,
    role: isFirst ? 'admin' : 'guest',
    passwordHash: crypto.hashPassword(password),
    createdAt: Date.now(),
  })
  if (isFirst) store.markAdminBootstrapped()
  const token = store.createSession(username)
  return { token, user: { username, email, role: isFirst ? 'admin' : 'guest' } }
}

/**
 * 登录：支持用户名或邮箱。
 * 已启用 2FA 的用户：第一步只返回 pending2fa（不发会话 token），
 * 前端引导输入 6 位动态码后调 verify2fa 完成登录。
 */
// ================= 登录/2FA 失败锁定 =================
// 同一账号或同一 IP 在 5 分钟窗口内失败 5 次 → 锁定 5 分钟（防密码/6 位动态码爆破）
const MAX_FAILS = 5
const WINDOW_MS = 5 * 60 * 1000
const LOCK_MS = 5 * 60 * 1000
const failMap = new Map()   // key -> { count, windowStart }
const loginChallenges = new Map() // password-verified, short-lived, single-use second-factor challenges

function checkLocked(key) {
  const e = failMap.get(key)
  if (!e) return 0
  if (e.count < MAX_FAILS) {
    if (Date.now() - e.windowStart > WINDOW_MS) failMap.delete(key)
    return 0
  }
  const until = e.windowStart + WINDOW_MS + LOCK_MS
  if (Date.now() >= until) { failMap.delete(key); return 0 }
  return Math.ceil((until - Date.now()) / 1000)
}

function registerFail(key) {
  const e = failMap.get(key)
  if (!e || Date.now() - e.windowStart > WINDOW_MS) {
    failMap.set(key, { count: 1, windowStart: Date.now() })
  } else {
    failMap.set(key, { count: e.count + 1, windowStart: e.windowStart })
  }
  if (failMap.size > 2000) {
    for (const [k, v] of failMap) if (Date.now() - v.windowStart > WINDOW_MS + LOCK_MS) failMap.delete(k)
  }
}

function resetFails(key) {
  failMap.delete(key)
}

function lockWait(keys) {
  let max = 0
  for (const k of keys) max = Math.max(max, checkLocked(k))
  return max
}

/** 登录（密码 + 可选 2FA 第一步）。失败按账号/IP 计数锁定。 */
function login(identifier, password, ip) {
  identifier = String(identifier || '').trim().toLowerCase()
  const acctKey = 'l:' + identifier
  const ipKey = 'lip:' + (ip || '')
  // 锁定返回 429 + Retry-After（可观测限流），文案与账号存在性无关
  // （锁定期间对"存在的用户"和"不存在的用户"响应完全一致，防枚举）
  const locked = lockWait([acctKey, ipKey])
  if (locked > 0) {
    const err = new Error('尝试次数过多，请稍后重试')
    err.statusCode = 429
    err.retryAfter = locked
    throw err
  }
  let user = store.getUser(identifier)
  if (!user && identifier.includes('@')) {
    const all = store.getUsers()
    const found = Object.values(all).find((u) => u.email === identifier)
    if (found) user = store.getUser(found.username)
  }
  if (!user || !crypto.verifyPassword(password, user.passwordHash)) {
    registerFail(acctKey)
    registerFail(ipKey)
    throw new Error('用户名或密码错误')
  }
  // 密码正确：重置密码失败计数（2FA 步骤有独立计数）
  resetFails(acctKey)
  resetFails(ipKey)
  const secret = store.getTotpSecret(user.username)
  if (user.totpSecret && !secret) throw new Error('双因素配置无法解密，请联系管理员检查主密钥')
  if (secret) {
    for (const [key, value] of loginChallenges) if (value.expires < Date.now()) loginChallenges.delete(key)
    if (loginChallenges.size >= 1000) throw new Error('登录请求过多，请稍后重试')
    const challenge = crypto.randomToken()
    loginChallenges.set(challenge, { username: user.username, passwordHash: user.passwordHash, expires: Date.now() + 5 * 60 * 1000 })
    return { pending2fa: true, username: user.username, challenge }
  }
  const token = store.createSession(user.username)
  return { token, user: { username: user.username, email: user.email, role: user.role ?? 'guest' } }
}

/** 2FA 第二步：校验动态码并签发会话。失败按账号/IP 计数锁定，防 6 位码爆破。 */
function verify2fa(username, code, ip, challenge) {
  const name = String(username || '').trim()
  const acctKey = 't:' + name.toLowerCase()
  const ipKey = 'tip:' + (ip || '')
  const locked = lockWait([acctKey, ipKey])
  if (locked > 0) {
    const err = new Error('尝试次数过多，请稍后重试')
    err.statusCode = 429
    err.retryAfter = locked
    throw err
  }
  const user = store.getUser(name)
  const proof = loginChallenges.get(challenge)
  if (!proof || proof.expires < Date.now() || proof.username !== user?.username || proof.passwordHash !== user?.passwordHash) {
    if (proof?.expires < Date.now()) loginChallenges.delete(challenge)
    throw new Error('请先验证密码，或重新登录后输入动态码')
  }
  const secret = user ? store.getTotpSecret(user.username) : null
  // 用户不存在 / 未启用 2FA / 验证码错误：统一文案（防用户名枚举），
  // 且前两种情况同样执行一次等时校验，抹平时序侧信道
  if (!user || !secret) {
    totp.totpVerify('JBSWY3DPEHPK3PXP', code)
    registerFail(acctKey)
    registerFail(ipKey)
    throw new Error('验证码错误或已过期')
  }
  const step = totp.totpMatchStep(secret, code)
  if (step === null) {
    registerFail(acctKey)
    registerFail(ipKey)
    throw new Error('验证码错误或已过期')
  }
  // TOTP 防重放：同一 30 秒窗口内同一验证码只允许成功一次
  if (Number.isFinite(user.totpLastStep) && user.totpLastStep >= step) {
    registerFail(acctKey)
    registerFail(ipKey)
    throw new Error('验证码错误或已过期')
  }
  store.upsertUser(user.username, { ...user, totpLastStep: step })
  loginChallenges.delete(challenge)
  resetFails(acctKey)
  resetFails(ipKey)
  const token = store.createSession(user.username)
  return { token, user: { username: user.username, email: user.email, role: user.role ?? 'guest' } }
}

/** 生成 2FA 密钥（登录用户自助开启）：返回 secret + otpauth URI（未保存，等确认）。 */
function setup2fa(user) {
  const secret = totp.generateTotpSecret()
  return { secret, uri: totp.totpUri(secret, user.username) }
}

/** 启用 2FA：校验一次动态码后保存 secret。 */
function enable2fa(user, secret, code) {
  if (store.getUser(user.username)?.totpSecret) throw new Error('请先验证当前动态码并关闭双因素验证，再更换密钥')
  if (!/^[A-Z2-7]{16,128}$/.test(String(secret || '').toUpperCase().replace(/\s/g, ''))) throw new Error('双因素密钥格式无效')
  if (!totp.totpVerify(String(secret || '').toUpperCase().replace(/\s/g, ''), code)) {
    throw new Error('验证码错误 — 请用认证器扫描或手动输入密钥后填入当前动态码')
  }
  store.setTotpSecret(user.username, String(secret).toUpperCase().replace(/\s/g, ''))
  return { ok: true }
}

/** 禁用 2FA：需提供当前动态码。 */
function disable2fa(user, code) {
  const secret = store.getTotpSecret(user.username)
  if (!secret) throw new Error('该用户未启用双因素验证')
  if (!totp.totpVerify(secret, code)) {
    throw new Error('验证码错误或已过期')
  }
  store.clearTotpSecret(user.username)
  return { ok: true }
}

/** 按会话 token 解析用户（未登录返回 null）。 */
function authUser(token) {
  const username = store.getSessionUser(token)
  if (!username) return null
  const user = store.getUser(username)
  if (!user) return null
  return { username: user.username, email: user.email, role: user.role ?? 'guest', createdAt: user.createdAt }
}

/** 要求管理员角色，否则抛错。 */
function requireAdmin(user) {
  if (!user) throw new Error('未登录')
  if (user.role !== 'admin') throw new Error('需要管理员权限')
}

module.exports = {
  sendCode, register, login, verify2fa, setup2fa, enable2fa, disable2fa,
  authUser, requireAdmin, validateCredentials,
}
