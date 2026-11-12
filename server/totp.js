/**
 * TOTP 双因素验证（RFC 6238，兼容 Google Authenticator / Microsoft Authenticator）。
 * 零第三方依赖：HMAC-SHA1 + base32。
 */
const crypto = require('node:crypto')

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** 生成 160-bit 随机 secret（base32，32 字符）。 */
function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20))
}

/** Buffer → base32（无填充）。 */
function base32Encode(buf) {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/** base32 → Buffer（忽略空格/小写/填充）。 */
function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=]/g, '')
  const bytes = []
  let bits = 0
  let value = 0
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** HOTP（RFC 4226）：HMAC-SHA1 动态截断。 */
function hotp(secretB32, counter) {
  const key = base32Decode(secretB32)
  const counterBuf = Buffer.alloc(8)
  counterBuf.writeBigUInt64BE(BigInt(counter))
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code = ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3]
  return String(code % 1000000).padStart(6, '0')
}

/** TOTP：当前时间步的 6 位码。window 为时间步偏移（0=当前，1=下一步…）。 */
function totp(secretB32, timeStep = 30, window = 0) {
  const counter = Math.floor(Date.now() / 1000 / timeStep) + window
  return hotp(secretB32, counter)
}

/** 校验 6 位码：允许前后 ±windows 个时间步（默认 ±1，容忍时钟漂移）。 */
function totpVerify(secretB32, code, timeStep = 30, windows = 1) {
  return totpMatchStep(secretB32, code, timeStep, windows) !== null
}

/** Return the actual accepted time step, so a tolerated previous code cannot be replayed. */
function totpMatchStep(secretB32, code, timeStep = 30, windows = 1) {
  const input = String(code || '').trim()
  if (!/^\d{6}$/.test(input)) return null
  const current = Math.floor(Date.now() / 1000 / timeStep)
  for (let w = -windows; w <= windows; w++) {
    if (hotp(secretB32, current + w) === input) return current + w
  }
  return null
}

/** otpauth:// URI（前端生成二维码或手动录入）。 */
function totpUri(secretB32, account, issuer = 'Foundation Console') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}` +
    `?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&period=30&digits=6`
}

module.exports = { generateTotpSecret, totp, totpVerify, totpMatchStep, totpUri, base32Encode, base32Decode }
