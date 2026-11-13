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

  // ===== R4：成员与权限 / 定时任务 / 通知规则 / 玩家历史 =====
  // 24) 造 owner2 / member1（store 直建模拟已有账号；注册后续需验证码，见 9)
  store.upsertUser('owner2', { username: 'owner2', email: 'owner2@qq.com', role: 'user', passwordHash: crypto.hashPassword('pass1234'), createdAt: Date.now() })
  store.upsertUser('member1', { username: 'member1', email: 'member1@qq.com', role: 'user', passwordHash: crypto.hashPassword('pass1234'), createdAt: Date.now() })
  r = await req('POST', '/api/auth/login', { identifier: 'owner2', password: 'pass1234' })
  assert('R4 owner2 登录', r.status === 200 && r.body.token, JSON.stringify(r.body))
  const owner2Token = r.body.token
  r = await req('POST', '/api/auth/login', { identifier: 'member1', password: 'pass1234' })
  assert('R4 member1 登录', r.status === 200 && r.body.token, JSON.stringify(r.body))
  const memberToken = r.body.token

  // 25) owner2 建服务器
  // 用 TEST-NET-3 IP 字面量：不依赖 DNS（CI 无法解析 .test 域名），控制调用会在上游超时后返回非 403
  r = await req('POST', '/api/servers', { host: '203.0.113.10', port: 8081, token: 'vt', apiKey: 'ak', label: 'R4Srv' }, owner2Token)
  assert('R4 owner2 建服务器', r.status === 200 && r.body.server?.id && r.body.server.role === 'owner', JSON.stringify(r.body))
  const srvId = r.body.server.id

  // 26) 平台管理员（非该服务器成员）不能管理他人服务器成员
  r = await req('POST', `/api/servers/${srvId}/members`, { username: 'member1', role: 'viewer' }, adminToken)
  assert('R4 非成员管理员不能管理他人服务器成员', r.status === 400 && !r.body.success, JSON.stringify(r.body))

  // 27) owner2 分享 viewer 给 member1
  r = await req('POST', `/api/servers/${srvId}/members`, { username: 'member1', role: 'viewer' }, owner2Token)
  assert('R4 owner 分享 viewer 成员', r.status === 200 && r.body.members?.some((m) => m.username === 'member1'), JSON.stringify(r.body))

  // 28) member1 列表可见共享服务器且角色 viewer
  r = await req('GET', '/api/servers', null, memberToken)
  const shared = (r.body.servers || []).find((s) => s.id === srvId)
  assert('R4 共享服务器出现在成员列表且角色 viewer', r.status === 200 && shared && shared.role === 'viewer' && shared.sharedBy === 'owner2', JSON.stringify(r.body))

  // 29) viewer 的控制调用被拒（角色强制先于上游）
  r = await req('POST', '/api/sl/call', { serverId: srvId, path: '/control/broadcast', body: { message: 'x' } }, memberToken)
  assert('R4 viewer 控制调用 403', r.status === 403 && /只看数据/.test(r.body.message), JSON.stringify(r.body))

  // 30) viewer 也不能查看成员列表
  r = await req('GET', `/api/servers/members?serverId=${srvId}`, null, memberToken)
  assert('R4 viewer 不能查看成员列表', r.status === 403 && !r.body.success, JSON.stringify(r.body))

  // 31) 升级为 operator 后角色放行到上游（无真实游戏服 → 非 403）
  r = await req('PUT', `/api/servers/${srvId}/members/member1`, { role: 'operator' }, owner2Token)
  assert('R4 owner 改成员角色为 operator', r.status === 200 && r.body.success, JSON.stringify(r.body))
  r = await req('POST', '/api/sl/call', { serverId: srvId, path: '/control/broadcast', body: { message: 'x' } }, memberToken)
  assert('R4 operator 控制调用透传上游（无上游 → 非 403）', r.status !== 403, JSON.stringify(r.body))

  // 32) 非所有者不能删除服务器
  r = await req('DELETE', `/api/servers/${srvId}`, null, memberToken)
  assert('R4 operator 不能删除服务器', r.status === 403 && /所有者/.test(r.body.message), JSON.stringify(r.body))

  // 33) 定时任务：operator 不能创建；owner 创建成功；禁 sldataapi 命令；暂停仅 owner/manager
  r = await req('POST', '/api/schedules', { serverId: srvId, kind: 'broadcast', payload: { message: 'hi' }, intervalSeconds: 300 }, memberToken)
  assert('R4 operator 不能创建定时任务', r.status === 400 && /仅所有者或管理者/.test(r.body.message), JSON.stringify(r.body))
  r = await req('POST', '/api/schedules', { serverId: srvId, kind: 'broadcast', payload: { message: '重启提醒' }, intervalSeconds: 300 }, owner2Token)
  assert('R4 owner 创建定时任务', r.status === 200 && r.body.schedule?.id, JSON.stringify(r.body))
  const schId = r.body.schedule?.id
  r = await req('POST', '/api/schedules', { serverId: srvId, kind: 'console', payload: { command: 'sldataapi apikey create x admin' }, intervalSeconds: 300 }, owner2Token)
  assert('R4 定时任务禁止 sldataapi 命令', r.status === 400 && /sldataapi/.test(r.body.message), JSON.stringify(r.body))
  r = await req('GET', '/api/schedules', null, memberToken)
  assert('R4 operator 可见定时任务列表', r.status === 200 && r.body.schedules?.some((x) => x.id === schId), JSON.stringify(r.body))
  r = await req('PUT', `/api/schedules/${schId}`, { enabled: false }, memberToken)
  assert('R4 operator 不能暂停定时任务', r.status === 400 && /仅所有者或管理者/.test(r.body.message), JSON.stringify(r.body))
  r = await req('PUT', `/api/schedules/${schId}`, { enabled: false }, owner2Token)
  assert('R4 owner 暂停定时任务', r.status === 200 && r.body.schedule?.enabled === false, JSON.stringify(r.body))

  // 34) 通知规则：member1（非管理员）建规则时 email 标志被忽略；增删改查可用
  r = await req('POST', '/api/notifications/rules', { serverId: '*', events: ['warhead_started'], inapp: true, email: true, minIntervalSeconds: 60 }, memberToken)
  assert('R4 member1 建通知规则（email 标志被忽略）', r.status === 200 && r.body.rule?.email === false, JSON.stringify(r.body))
  const ruleId = r.body.rule?.id
  r = await req('GET', '/api/notifications', null, memberToken)
  assert('R4 通知收件箱可读', r.status === 200 && Array.isArray(r.body.items), JSON.stringify(r.body))
  r = await req('PUT', `/api/notifications/rules/${ruleId}`, { enabled: false }, memberToken)
  assert('R4 规则停用', r.status === 200 && r.body.rule?.enabled === false, JSON.stringify(r.body))
  r = await req('DELETE', `/api/notifications/rules/${ruleId}`, null, memberToken)
  assert('R4 规则删除', r.status === 200 && r.body.success, JSON.stringify(r.body))

  // 35) 玩家历史：viewer 可读（空数据）；保留天数仅管理员
  r = await req('GET', `/api/servers/history?serverId=${srvId}&days=7`, null, memberToken)
  assert('R4 viewer 可读玩家历史', r.status === 200 && r.body.history && Array.isArray(r.body.history.users) && Array.isArray(r.body.history.trend), JSON.stringify(r.body))
  r = await req('PUT', '/api/admin/history', { days: 7 }, owner2Token)
  assert('R4 非管理员不能改历史保留天数', r.status === 403, JSON.stringify(r.body))
  r = await req('PUT', '/api/admin/history', { days: 7 }, adminToken)
  assert('R4 管理员改保留天数', r.status === 200 && r.body.days === 7, JSON.stringify(r.body))
  r = await req('POST', '/api/admin/history/clear', { serverId: srvId }, adminToken)
  assert('R4 管理员清除历史', r.status === 200 && r.body.success, JSON.stringify(r.body))

  // 36) 移除成员后访问权撤销
  r = await req('DELETE', `/api/servers/${srvId}/members/member1`, null, owner2Token)
  assert('R4 owner 移除成员', r.status === 200 && r.body.success, JSON.stringify(r.body))
  r = await req('GET', '/api/servers', null, memberToken)
  assert('R4 移除后共享服务器不再出现在成员列表', r.status === 200 && !(r.body.servers || []).some((s) => s.id === srvId), JSON.stringify(r.body))

  // ===== R4 定位补充：注册模式（内部部署）=====
  // 37) closed：自助注册被拒（模式检查先于验证码，无需真码）
  r = await req('PUT', '/api/admin/registration', { mode: 'closed' }, adminToken)
  assert('R4a 管理员关闭自助注册', r.status === 200 && r.body.mode === 'closed', JSON.stringify(r.body))
  r = await req('GET', '/api/auth/status')
  assert('R4a status 暴露 registrationMode', r.body.registrationMode === 'closed', JSON.stringify(r.body))
  r = await req('POST', '/api/auth/register', { email: 'tryclose@qq.com', username: 'tryclose', password: 'pass1234', code: '' })
  assert('R4a closed 模式拒绝自助注册', r.status === 400 && /自助注册已关闭/.test(r.body.message), JSON.stringify(r.body))

  // 38) invite：坏邀请码先于验证码被拒；好邀请码进入验证码校验（坏码不烧邀请码）
  r = await req('PUT', '/api/admin/registration', { mode: 'invite' }, adminToken)
  assert('R4a 切换邀请制', r.status === 200 && r.body.mode === 'invite', JSON.stringify(r.body))
  r = await req('POST', '/api/auth/register', { email: 'iv1@qq.com', username: 'iv1', password: 'pass1234', code: '', inviteCode: 'inv_bad' })
  assert('R4a 坏邀请码被拒', r.status === 400 && /邀请码无效/.test(r.body.message), JSON.stringify(r.body))
  r = await req('POST', '/api/admin/registration/invites', {}, adminToken)
  assert('R4a 管理员生成邀请码', r.status === 200 && r.body.invite?.code?.startsWith('inv_'), JSON.stringify(r.body))
  const inviteCode = r.body.invite.code
  r = await req('GET', '/api/admin/registration', null, adminToken)
  assert('R4a 邀请码列表脱敏', r.status === 200 && !(JSON.stringify(r.body.invites || []).includes(inviteCode)), JSON.stringify(r.body))
  r = await req('POST', '/api/auth/register', { email: 'iv1@qq.com', username: 'iv1', password: 'pass1234', code: '000000', inviteCode })
  assert('R4a 好邀请码进入验证码校验', r.status === 400 && /验证码错误或已过期/.test(r.body.message), JSON.stringify(r.body))
  r = await req('GET', '/api/admin/registration', null, adminToken)
  const pendingInvite = (r.body.invites || []).find((iv) => !iv.used)
  if (pendingInvite) {
    r = await req('DELETE', `/api/admin/registration/invites/${pendingInvite.id}`, null, adminToken)
    assert('R4a 吊销未用邀请码', r.status === 200 && r.body.success, JSON.stringify(r.body))
  }

  // 39) 恢复 open（QQ 邮箱自助注册默认不变）
  r = await req('PUT', '/api/admin/registration', { mode: 'open' }, adminToken)
  assert('R4a 恢复开放注册', r.status === 200 && r.body.mode === 'open', JSON.stringify(r.body))
  r = await req('POST', '/api/auth/register', { email: 'x@yahoo.com', username: 'nope', password: 'pass1234', code: '' })
  assert('R4a 开放模式下仍仅限 QQ 邮箱', r.status === 400 && /QQ 邮箱/.test(r.body.message), JSON.stringify(r.body))

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
