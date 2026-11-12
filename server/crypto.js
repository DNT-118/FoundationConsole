/**
 * 安全加密模块：
 *  - scrypt 密码哈希（防彩虹表/暴力破解）
 *  - AES-256-GCM 对称加密（SLDataAPI API Key / SMTP 授权码等敏感数据）
 * 全部基于 Node 内置 crypto，零第三方依赖。
 */
const crypto = require('node:crypto')

const SCRYPT_KEYLEN = 64
const AES_IV_LEN = 12 // GCM 推荐 96-bit IV

/**
 * 密码哈希：scrypt + 随机盐。返回 "salt:hash"（hex）。
 * N=2^17 内存困难参数，防 GPU 爆破（内存约 128MB，需显式 maxmem）。
 */
function scryptParams() {
  return { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, scryptParams())
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

/** 校验密码：恒定时间比较，防时序攻击。 */
function verifyPassword(password, stored) {
  try {
    const [saltHex, hashHex] = String(stored).split(':')
    if (!saltHex || !hashHex) return false
    const salt = Buffer.from(saltHex, 'hex')
    const expected = Buffer.from(hashHex, 'hex')
    const actual = crypto.scryptSync(String(password), salt, expected.length, scryptParams())
    return crypto.timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/** 生成随机会话 token（32 字节 hex）。 */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex')
}

/** 生成 6 位数字验证码。 */
function randomCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0')
}

/**
 * AES-256-GCM 加密。返回 "iv:tag:data"（base64）。
 * key 由 masterKey 派生（sha256，32 字节）。
 */
function encrypt(plaintext, masterKey) {
  const key = crypto.createHash('sha256').update(String(masterKey)).digest()
  const iv = crypto.randomBytes(AES_IV_LEN)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

/** AES-256-GCM 解密；数据被篡改/密钥错误时返回 null。 */
function decrypt(payload, masterKey) {
  try {
    const [ivB64, tagB64, dataB64] = String(payload).split(':')
    if (!ivB64 || !tagB64 || !dataB64) return null
    const key = crypto.createHash('sha256').update(String(masterKey)).digest()
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ])
    return dec.toString('utf8')
  } catch {
    return null
  }
}

module.exports = { hashPassword, verifyPassword, randomToken, randomCode, encrypt, decrypt }
