/**
 * 账户库：用主密码加密存于 localStorage。
 * 存储 = base64( AES-256-GCM( JSON(users) ) )。
 * users = { [username]: { salt, verifier, role, createdAt } }
 * verifier = 加密一段固定明文得到的密文，用于校验密码正确性。
 *
 * 角色：
 *  - admin：首个账户（Setup 创建）；可管理账号（创建/删除/改角色）+ 全部功能
 *  - user：可绑定 SLDataAPI API Key（控制类功能）
 *  - guest：只能绑定基本 token（只读功能）
 */
import { encryptString, decryptString } from './crypto'

const STORE_KEY = 'pfc.vault'

export type UserRole = 'admin' | 'user' | 'guest'

export interface VaultUser {
  username: string
  verifier: string
  role: UserRole
  createdAt: number
}

interface VaultFile {
  v: number
  payload: string
}

const MAGIC = 'PFC-AES-256-GCM-OK'

async function loadRaw(): Promise<string | null> {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORE_KEY)
  } catch {
    // 浏览器跟踪防护/隐私模式阻止 localStorage 时优雅降级
    return null
  }
  if (!raw) return null
  try {
    const file = JSON.parse(raw) as VaultFile
    return file.payload ?? null
  } catch {
    return null
  }
}

async function readUsers(
  masterPassword: string,
): Promise<Record<string, VaultUser>> {
  const payload = await loadRaw()
  if (!payload) return {}
  const json = await decryptString(payload, masterPassword)
  return JSON.parse(json) as Record<string, VaultUser>
}

async function writeUsers(
  users: Record<string, VaultUser>,
  masterPassword: string,
): Promise<void> {
  const payload = await encryptString(JSON.stringify(users), masterPassword)
  const file: VaultFile = { v: 1, payload }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(file))
  } catch {
    throw new Error('localStorage unavailable — 浏览器阻止了本地存储，请调整跟踪防护设置后重试')
  }
}

export async function registerUser(
  username: string, password: string, role: UserRole = 'user',
): Promise<void> {
  const key = username.toLowerCase()
  if (key.length < 2) throw new Error('username too short')
  if (password.length < 8) throw new Error('password too short (min 8)')

  // 首次注册：库不存在，先用主密码建空库（首个账户 = 管理员）。
  let users: Record<string, VaultUser>
  const existingPayload = await loadRaw()
  if (!existingPayload) {
    users = {}
  } else {
    // 库已存在：必须用同一主密码解锁。首次注册即设定主密码。
    try {
      users = await readUsers(password)
    } catch {
      throw new Error('master password mismatch (vault already exists)')
    }
  }
  if (users[key]) throw new Error('user already exists')

  // 首个账户强制 admin；后续由管理员创建（传角色）
  const finalRole: UserRole = Object.keys(users).length === 0 ? 'admin' : role

  const verifier = await encryptString(`${MAGIC}:${key}`, password)
  users[key] = { username, verifier, role: finalRole, createdAt: Date.now() }
  await writeUsers(users, password)
}

/** 登录验证：成功返回 { ok: true, role }，失败返回 { ok: false }。 */
export async function verifyUser(
  username: string, password: string,
): Promise<{ ok: boolean; role: UserRole | null }> {
  const payload = await loadRaw()
  if (!payload) return { ok: false, role: null }
  let users: Record<string, VaultUser>
  try {
    users = await readUsers(password)
  } catch {
    return { ok: false, role: null }
  }
  const u = users[username.toLowerCase()]
  if (!u) return { ok: false, role: null }
  try {
    const plain = await decryptString(u.verifier, password)
    if (plain !== `${MAGIC}:${username.toLowerCase()}`) return { ok: false, role: null }
    // 兼容旧数据（无 role 字段）：默认 admin（旧版唯一账户是管理员）
    return { ok: true, role: u.role ?? 'admin' }
  } catch {
    return { ok: false, role: null }
  }
}

/** 管理员：用主密码解锁并列出所有用户（不含 verifier）。 */
export async function listUsers(
  masterPassword: string,
): Promise<{ username: string; role: UserRole; createdAt: number }[]> {
  const users = await readUsers(masterPassword).catch(() => ({}))
  return Object.values(users)
    .map((u) => ({ username: u.username, role: u.role ?? 'admin', createdAt: u.createdAt }))
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** 管理员：删除用户（禁止删除最后一个 admin）。 */
export async function deleteUser(
  username: string, masterPassword: string,
): Promise<void> {
  const users = await readUsers(masterPassword).catch(() => {
    throw new Error('master password mismatch')
  })
  const key = username.toLowerCase()
  if (!users[key]) throw new Error('user not found')
  if ((users[key].role ?? 'admin') === 'admin') {
    const admins = Object.values(users).filter((u) => (u.role ?? 'admin') === 'admin')
    if (admins.length <= 1) throw new Error('cannot delete the last admin')
  }
  delete users[key]
  await writeUsers(users, masterPassword)
}

/** 管理员：修改用户角色。 */
export async function updateUserRole(
  username: string, role: UserRole, masterPassword: string,
): Promise<void> {
  const users = await readUsers(masterPassword).catch(() => {
    throw new Error('master password mismatch')
  })
  const key = username.toLowerCase()
  if (!users[key]) throw new Error('user not found')
  // 保护：不能把最后一个 admin 降级
  if ((users[key].role ?? 'admin') === 'admin' && role !== 'admin') {
    const admins = Object.values(users).filter((u) => (u.role ?? 'admin') === 'admin')
    if (admins.length <= 1) throw new Error('cannot demote the last admin')
  }
  users[key].role = role
  await writeUsers(users, masterPassword)
}

export async function hasVault(): Promise<boolean> {
  return !!(await loadRaw())
}

export async function listUsernames(
  masterPassword: string,
): Promise<string[]> {
  const users = await readUsers(masterPassword).catch(() => ({}))
  return Object.values(users).map((u) => u.username)
}

/** 清空整个账户库（危险，仅用于重置）。 */
export function wipeVault(): void {
  localStorage.removeItem(STORE_KEY)
}
