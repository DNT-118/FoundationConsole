/**
 * 客户端加密：WebCrypto AES-256-GCM + PBKDF2 密钥派生。
 * 用于本地账户库加密存储，实现账户隔离。
 * 注意：纯前端无法防止有本地写入权限的攻击者篡改，但可保证
 * 无主密码者无法读取账户数据。
 */

const enc = new TextEncoder()
const dec = new TextDecoder()
const SALT_LEN = 16
const IV_LEN = 12
const PBKDF2_ITERS = 150_000

/** 强制得到 ArrayBuffer-backed 视图，规避 lib.dom 对 SharedArrayBuffer 的过严判定。 */
function ab(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
}

function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function b64ToBuf(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

async function deriveKey(
  password: string, salt: Uint8Array,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw', ab(enc.encode(password)), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: ab(salt), iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** 加密任意字符串，返回 base64(salt + iv + ciphertext)。 */
export async function encryptString(
  plaintext: string, password: string,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN))
  const key = await deriveKey(password, salt)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ab(iv) },
    key,
    ab(enc.encode(plaintext)),
  )
  const combined = new Uint8Array(SALT_LEN + IV_LEN + ct.byteLength)
  combined.set(salt, 0)
  combined.set(iv, SALT_LEN)
  combined.set(new Uint8Array(ct), SALT_LEN + IV_LEN)
  return bufToB64(combined)
}

/** 解密 encryptString 产物。失败抛错（密码错/数据损坏）。 */
export async function decryptString(
  payload: string, password: string,
): Promise<string> {
  const combined = b64ToBuf(payload)
  const salt = combined.slice(0, SALT_LEN)
  const iv = combined.slice(SALT_LEN, SALT_LEN + IV_LEN)
  const ct = combined.slice(SALT_LEN + IV_LEN)
  const key = await deriveKey(password, salt)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ab(iv) }, key, ab(ct))
  return dec.decode(pt)
}

/** 派生稳定账户 id（不含敏感信息），用于数据命名空间隔离。 */
export async function deriveUserId(username: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(username.toLowerCase()))
  return bufToB64(h).slice(0, 16)
}
