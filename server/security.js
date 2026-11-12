const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const { Resolver } = require('node:dns').promises
const resolver = new Resolver({ timeout: 3000, tries: 2 })

function canonicalIp(value) {
  const raw = String(value || '').replace(/^\[|\]$/g, '').toLowerCase()
  if (!net.isIP(raw)) return null
  if (!raw.includes(':')) return raw
  const host = new URL(`http://[${raw}]`).hostname.slice(1, -1)
  const mapped = host.match(/^::ffff:([\da-f]+):([\da-f]+)$/)
  if (!mapped) return host
  const hi = parseInt(mapped[1], 16), lo = parseInt(mapped[2], 16)
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.')
}

function isForbiddenIp(value) {
  const ip = canonicalIp(value)
  if (!ip) return true
  if (ip.includes(':')) return ip === '::' || ip === '::1' || /^fe[89ab]/.test(ip) || ip.startsWith('ff')
  const [a, b] = ip.split('.').map(Number)
  return a === 0 || a === 127 || a >= 224 || (a === 169 && b === 254)
}

function isPrivateIp(value) {
  const ip = canonicalIp(value)
  if (!ip) return false
  if (isForbiddenIp(ip)) return true
  if (ip.includes(':')) return /^f[cd]/.test(ip)
  const [a, b] = ip.split('.').map(Number)
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

function isForbiddenTarget(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '')
  return !h || h === 'localhost' || h.endsWith('.localhost') || (canonicalIp(h) !== null && isForbiddenIp(h))
}
function isPrivateHost(host) { return isPrivateIp(host) }

async function resolveHostChecked(host, isAdmin) {
  const h = String(host || '').trim().toLowerCase()
  if (isForbiddenTarget(h)) return { ok: false, error: '目标地址被禁止' }
  const literal = canonicalIp(h)
  let ips
  if (literal) ips = [literal]
  else {
    const results = await Promise.allSettled([resolver.resolve4(h), resolver.resolve6(h)])
    ips = results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
  }
  if (!ips.length) return { ok: false, error: '域名解析失败或无解析记录' }
  if (ips.some(isForbiddenIp)) return { ok: false, error: '域名解析到被禁止地址' }
  if (!isAdmin && ips.some(isPrivateIp)) return { ok: false, error: '私网地址仅管理员可用' }
  return { ok: true, ips }
}

// [内测] beta_adapted_plugin_actions：POST /control/adapted/<plugin_id>/<action>。
// 与上游 SLDataAPI 一致：恰好两段，段内允许字母/数字/._-，禁止 ".."，段首必须为字母或数字。
const ADAPTED_SEGMENT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

function isAllowedAdaptedActionPath(value) {
  if (typeof value !== 'string' || value.length > 200 || !value.startsWith('/control/adapted/')) return false
  const segs = value.slice('/control/adapted/'.length).split('/')
  return segs.length === 2 && segs.every((s) => ADAPTED_SEGMENT_RE.test(s) && !s.includes('..'))
}

function isAllowedControlPath(value) {
  if (typeof value !== 'string' || value.length > 200) return false
  // 适配插件动作路由（[内测]）：段规则单独校验（插件 id 含点/横线，固定小写规则不适用）
  if (value.startsWith('/control/adapted/')) return isAllowedAdaptedActionPath(value)
  return /^\/control\/[a-z][a-z0-9_]*(?:\/[a-z][a-z0-9_]*)*$/.test(value)
}
function isAllowedReadOnlyPath(value) {
  return typeof value === 'string' && value.length <= 200 && !value.includes('..') && (
    value === '/get_sl_data' || value === '/plugins/adapted' ||
    /^\/plugins\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)
  )
}

function normalizePublicOrigin(value) {
  const url = new URL(value)
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PFC_PUBLIC_URL must be an HTTP(S) origin without credentials, path, query or fragment')
  }
  return url.origin
}

function loadPublicOrigin() {
  if (process.env.PFC_PUBLIC_URL) return normalizePublicOrigin(process.env.PFC_PUBLIC_URL)
  let config
  try { config = fs.readFileSync(path.join(__dirname, 'public-origin.json'), 'utf8') }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
  return normalizePublicOrigin(JSON.parse(config).origin)
}
const configuredPublicOrigin = loadPublicOrigin()

// A tunnel can replace Host with the internal service address. Trust an explicit
// deployment origin, never arbitrary X-Forwarded-Host/Forwarded request headers.
// Non-browser clients may omit Origin; cross-site Fetch Metadata is still denied.
function isSameOrigin(req, publicOrigin = configuredPublicOrigin) {
  if (!req.headers.origin) return req.headers['sec-fetch-site'] !== 'cross-site'
  try {
    const origin = new URL(req.headers.origin)
    if (!/^https?:$/.test(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return false
    if (publicOrigin) return origin.origin === publicOrigin
    return origin.origin === normalizePublicOrigin(`${origin.protocol}//${req.headers.host}`)
  } catch { return false }
}

module.exports = { canonicalIp, isForbiddenIp, isPrivateIp, isForbiddenTarget, isPrivateHost, resolveHostChecked, isAllowedControlPath, isAllowedReadOnlyPath, isSameOrigin, normalizePublicOrigin }
