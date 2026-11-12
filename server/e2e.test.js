// 端到端验证脚本（造测试数据 → 启动后端 → 验证 API/越权/加密）
const { execSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const BASE = 'http://127.0.0.1:3100'
const serverDir = path.join(__dirname, '..', 'server')
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfc-e2e-'))
process.env.PFC_DATA_DIR = testDataDir

const store = require(path.join(serverDir, 'store.js'))
const crypto = require(path.join(serverDir, 'crypto.js'))
console.log(`[test] 使用隔离数据目录：${testDataDir}`)

// 2) 启动后端（独立端口）
const server = spawn('node', [path.join(serverDir, 'server.js')], {
  env: {
    ...process.env,
    PORT: '3100',
    HOST: '127.0.0.1',
    PFC_PUBLIC_URL: 'https://console.example',
    PFC_MASTER_KEY: 'test-master-key-0123456789',
    PFC_DATA_DIR: testDataDir,
  },
  stdio: 'pipe',
})
server.stdout.on('data', (d) => process.stdout.write('[server] ' + d))
server.stderr.on('data', (d) => process.stderr.write('[server-err] ' + d))
let serverExit = null
server.on('exit', (code, signal) => { serverExit = { code, signal } })

const req = (method, p, body, token, extraHeaders = {}) =>
  fetch(BASE + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] }))

function assert(name, cond, extra = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (cond ? '' : '  ← ' + extra))
  if (!cond) process.exitCode = 1
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForServer(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (serverExit) {
      throw new Error(`测试后端提前退出：${JSON.stringify(serverExit)}`)
    }
    try {
      await fetch(BASE + '/api/me')
      return
    } catch {
      await sleep(250)
    }
  }
  throw new Error(`等待测试后端监听超时（${timeoutMs}ms）`)
}

;(async () => {
  await waitForServer()

  await new Promise((resolve, reject) => {
    const socket = require('node:net').connect(3100, '127.0.0.1', () => {
      socket.write('GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    })
    socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('Malformed upgrade did not close')) })
    socket.on('error', reject)
    socket.on('close', resolve)
  })
  const health = await req('GET', '/api/health')
  assert('畸形 WebSocket 握手被拒且平台保持健康', health.status === 200 && health.body.success && !serverExit)

  // 1) 空库：API 注册首个用户（免验证码）→ 自动 admin
  let r = await req('POST', '/api/auth/register', { email: 'admin1@qq.com', username: 'admin1', password: 'admin123', code: '' })
  assert('首用户免验证码注册且为 admin', r.status === 200 && r.body.token && r.body.user.role === 'admin', JSON.stringify(r.body))

  // 1.5) 造 guest 测试用户（store 直造，模拟管理员已建账号）
  store.upsertUser('guest1', {
    username: 'guest1', email: 'guest1@qq.com', role: 'guest',
    passwordHash: crypto.hashPassword('guest123'), createdAt: Date.now(),
  })
  console.log('[test] guest1 已创建')

  // 1.6) 非首次注册：无验证码 → 拒绝
  r = await req('POST', '/api/auth/register', { email: 'another@qq.com', username: 'another', password: 'pass123', code: '' })
  assert('非首次注册必须验证码', r.status === 400 && !r.body.success)
  r = await req('POST', '/api/auth/login', { identifier: 'admin1', password: 'admin123' })
  assert('admin 登录', r.status === 200 && r.body.success && r.body.token, JSON.stringify(r.body))
  const adminToken = r.body.token

  r = await req('POST', '/api/auth/login', { identifier: 'admin1', password: 'admin123' }, null, { Origin: 'https://console.example', 'Sec-Fetch-Site': 'same-origin' })
  assert('Tunnel 内网 Host 与公网 Origin 不同仍可登录', r.status === 200 && r.body.token)
  r = await req('POST', '/api/auth/login', { identifier: 'admin1', password: 'admin123' }, null, {
    Origin: 'https://attacker.example', 'X-Forwarded-Host': 'attacker.example', 'Sec-Fetch-Site': 'same-origin',
  })
  assert('伪造转发头无法绕过公网 Origin 校验', r.status === 403)

  const { WebSocket } = require('ws')
  const ws = new WebSocket(BASE.replace('http:', 'ws:') + '/api/sl/ws', {
    headers: { Origin: 'https://console.example', Cookie: `pfc_session=${adminToken}` },
    handshakeTimeout: 3000,
  })
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  assert('Tunnel 下携带公网 Origin 的控制 WebSocket 可以握手', ws.readyState === WebSocket.OPEN)
  ws.terminate()

  // 4) 错误密码
  r = await req('POST', '/api/auth/login', { identifier: 'admin1', password: 'wrong' })
  assert('错误密码拒绝', r.status === 400 && !r.body.success)

  // 5) 未登录访问服务器列表 → 401
  r = await req('GET', '/api/servers')
  assert('未登录 401', r.status === 401)

  // 6) admin 添加服务器（含 API Key）
  r = await req('POST', '/api/servers', {
    host: '1.1.1.1', port: 8081, token: 'verify-tok', apiKey: 'sld_live_MyKey123!', refetchInterval: 5000,
  }, adminToken)
  assert('admin 添加服务器', r.status === 200 && r.body.success, JSON.stringify(r.body))
  const serverId = r.body.server?.id
  assert(
    'API Key 出参打码且标记为可控制',
    r.body.server?.apiKey === '••••••' && r.body.server?.apiKeyConfigured === true,
    JSON.stringify(r.body.server),
  )

  // 7) 落盘检查：API Key 必须加密（不含明文），且不再写旧 controlToken 字段
  const serversFile = path.join(testDataDir, 'servers.json')
  const rawServers = fs.readFileSync(serversFile, 'utf8')
  assert('凭据加密落盘（无明文）', !rawServers.includes('sld_live_MyKey123!') && !rawServers.includes('verify-tok'))
  assert('新记录只写 apiKey 字段', rawServers.includes('"apiKey"') && !rawServers.includes('"controlToken"'))

  // 7.5) 旧 controlToken 落盘记录可读；任意更新后迁移为 apiKey，且未传 apiKey 时不清空。
  const legacyDoc = JSON.parse(rawServers)
  legacyDoc.servers[0].controlToken = legacyDoc.servers[0].apiKey
  delete legacyDoc.servers[0].apiKey
  fs.writeFileSync(serversFile, JSON.stringify(legacyDoc, null, 2), 'utf8')
  r = await req('GET', '/api/servers', null, adminToken)
  assert('兼容读取旧 controlToken 记录', r.body.servers?.[0]?.apiKeyConfigured === true)
  r = await req('PUT', '/api/servers/' + serverId, {
    host: '1.1.1.1', port: 8081, token: 'verify-tok', label: 'migrated', refetchInterval: 5000,
  }, adminToken)
  const migratedServers = fs.readFileSync(serversFile, 'utf8')
  assert('更新时迁移旧字段且保留 API Key', r.body.server?.apiKeyConfigured === true && migratedServers.includes('"apiKey"') && !migratedServers.includes('"controlToken"'))

  // 8) 登录 guest
  r = await req('POST', '/api/auth/login', { identifier: 'guest1', password: 'guest123' })
  const guestToken = r.body.token
  assert('guest 登录', !!guestToken)

  // 9) guest 服务器列表 → 空（看不到 admin 的）
  r = await req('GET', '/api/servers', null, guestToken)
  assert('越权防御：guest 看不到 admin 的服务器', r.status === 200 && r.body.servers.length === 0, JSON.stringify(r.body))

  // 10) guest 尝试添加带 API Key 的服务器 → 服务端强制清空
  r = await req('POST', '/api/servers', {
    host: '8.8.8.8', port: 8082, token: 'g-tok', apiKey: 'sld_live_HACKED123!', refetchInterval: 5000,
  }, guestToken)
  assert('guest 的 API Key 被服务端清空', r.body.server?.apiKey === '' && r.body.server?.apiKeyConfigured === false)

  // 11) guest 访问 admin API → 拒绝
  r = await req('GET', '/api/admin/users', null, guestToken)
  assert('guest 访问管理员 API 被拒', r.status === 400 && !r.body.success)

  // 12) admin 用户管理
  r = await req('GET', '/api/admin/users', null, adminToken)
  assert('admin 用户列表', r.status === 200 && r.body.users.length === 2)

  // 13) admin 改 guest 角色为 user
  r = await req('PUT', '/api/admin/users/guest1', { role: 'user' }, adminToken)
  assert('admin 改角色', r.status === 200 && r.body.success)

  // 14) admin 删服务器
  r = await req('DELETE', '/api/servers/' + serverId, null, adminToken)
  assert('admin 删除服务器', r.status === 200 && r.body.success)

  // 15) 非 QQ 邮箱注册拒绝
  r = await req('POST', '/api/auth/send-code', { email: 'x@gmail.com' })
  assert('非 QQ 邮箱拒绝', r.status === 400 && !r.body.success)

  // ===== 2FA 双因素流程 =====
  // 16) admin 开启 2FA
  r = await req('POST', '/api/auth/2fa/setup', null, adminToken)
  assert('2FA 生成密钥', r.status === 200 && r.body.secret && r.body.uri, JSON.stringify(r.body))
  const totp = require('./totp')
  const secret = r.body.secret
  const currentCode = totp.totp(secret)

  // 17) 错误码启用失败
  r = await req('POST', '/api/auth/2fa/enable', { secret, code: '000000' }, adminToken)
  assert('2FA 错误码拒绝', r.status === 400 && !r.body.success)

  // 18) 正确码启用
  r = await req('POST', '/api/auth/2fa/enable', { secret, code: currentCode }, adminToken)
  assert('2FA 启用成功', r.status === 200 && r.body.success)

  // 19) 启用后登录 → pending2fa（不发 token）
  r = await req('POST', '/api/auth/login', { identifier: 'admin1', password: 'admin123' })
  assert('登录进入 2FA 步骤', r.status === 200 && r.body.pending2fa && !r.body.token, JSON.stringify(r.body))
  const challengeCookie = r.cookie
  assert('第二因素凭据不暴露到响应 JSON', !!challengeCookie && !r.body.challenge)

  r = await req('POST', '/api/auth/2fa/verify', { username: 'admin1', code: totp.totp(secret) })
  assert('不能跳过密码步骤直接使用动态码登录', r.status === 400 && !r.body.token)

  // 20) 2FA 验证码登录
  r = await req('POST', '/api/auth/2fa/verify', { username: 'admin1', code: totp.totp(secret) }, null, { Cookie: challengeCookie })
  assert('2FA 验证登录成功', r.status === 200 && r.body.token)
  r = await req('POST', '/api/auth/2fa/verify', { username: 'admin1', code: totp.totp(secret) }, null, { Cookie: challengeCookie })
  assert('第二因素凭据只能成功使用一次', r.status === 400 && !r.body.token)

  // 21) 错误动态码拒绝
  r = await req('POST', '/api/auth/2fa/verify', { username: 'admin1', code: '000000' })
  assert('2FA 错误动态码拒绝', r.status === 400 && !r.body.success)

  // 22) 禁用 2FA
  r = await req('POST', '/api/auth/2fa/disable', { code: totp.totp(secret) }, adminToken)
  assert('2FA 禁用成功', r.status === 200 && r.body.success)

  // 23) 禁用后登录直接发 token
  r = await req('POST', '/api/auth/login', { identifier: 'admin1', password: 'admin123' })
  assert('禁用后登录恢复直接', r.status === 200 && r.body.token && !r.body.pending2fa)

  console.log('\n[test] 完成（失败项会标 FAIL）')
  server.kill()
  fs.rmSync(testDataDir, { recursive: true, force: true })
  process.exit(process.exitCode ?? 0)
})().catch((e) => {
  console.error('[test] 异常:', e)
  server.kill()
  fs.rmSync(testDataDir, { recursive: true, force: true })
  process.exit(1)
})
