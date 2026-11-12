const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfc-store-test-'))
process.env.PFC_DATA_DIR = dir
process.env.PFC_MASTER_KEY = 'isolated-unit-test-master-key'
const store = require('./store')
after(() => fs.rmSync(dir, { recursive: true, force: true }))

test('verification codes are invalidated after 5 wrong attempts (brute-force guard)', () => {
  store.setCode('bf@qq.com', '123456')
  // 前 4 次错误仍可继续尝试
  for (let i = 0; i < 4; i++) assert.equal(store.consumeCode('bf@qq.com', '000000'), false)
  assert.equal(store.consumeCode('bf@qq.com', '123456'), true) // 正确码仍可用
  // 连续 5 次错误后码被作废，正确码也失效
  store.setCode('bf@qq.com', '654321')
  for (let i = 0; i < 5; i++) assert.equal(store.consumeCode('bf@qq.com', '111111'), false)
  assert.equal(store.consumeCode('bf@qq.com', '654321'), false)
})

test('SMTP save preserves bootstrap flag, Steam key and unrelated config', () => {
  store.markAdminBootstrapped()
  store.setSteamKey('test-steam-key')
  store.setSmtpConfig({ host: 'smtp.example.com', user: 'test', pass: 'test-password' })
  assert.ok(store.isAdminBootstrapped())
  assert.equal(store.getSteamKey(), 'test-steam-key')
  assert.equal(store.getSmtpConfig().pass, 'test-password')
  const raw = fs.readFileSync(path.join(dir, 'config.json'), 'utf8')
  assert.ok(!raw.includes('test-password'))
})

test('SMTP secrets are preserved on empty save and cleared only explicitly', () => {
  store.setSmtpConfig({ user: 'a@qq.com', pass: 'first-secret' })
  // 空字符串 = 保留原值（修复"保存时清空输入框抹掉密码"）
  store.setSmtpConfig({ user: 'a@qq.com', host: 'smtp.qq.com', pass: '' })
  assert.equal(store.getSmtpConfig().pass, 'first-secret')
  // undefined 同样保留
  store.setSmtpConfig({ user: 'a@qq.com', from: 'Foundation Console' })
  assert.equal(store.getSmtpConfig().pass, 'first-secret')
  assert.equal(store.getSmtpConfig().from, 'Foundation Console')
  // null = 显式清除
  store.setSmtpConfig({ user: 'a@qq.com', pass: null })
  assert.equal(store.getSmtpConfig().pass, '')
  // 视图布尔：未配置 secret 时 secretConfigured=false
  assert.equal(store.getSmtpView().secretConfigured, false)
  store.setSmtpConfig({ user: 'a@qq.com', pass: 'again-secret' })
  assert.equal(store.getSmtpView().secretConfigured, true)
})

test('Microsoft OAuth tokens are stored encrypted and survive form saves; view never leaks them', () => {
  store.setSmtpConfig({ authMode: 'oauth2', user: 'admin@qq.com' })
  store.saveMicrosoftAuth({ refreshToken: 'ms-rt-original', accountEmail: 'me@outlook.com', tid: 'org-tid' })
  // 加密落盘：refresh_token 明文绝不出现在文件里
  const raw = fs.readFileSync(path.join(dir, 'config.json'), 'utf8')
  assert.ok(!raw.includes('ms-rt-original'))
  assert.equal(store.getSmtpConfig().msRefreshToken, 'ms-rt-original')
  // 表单保存（空密码）不影响 MS 字段
  store.setSmtpConfig({ user: 'admin@qq.com', host: 'smtp.qq.com' })
  const afterForm = store.getSmtpConfig()
  assert.equal(afterForm.msRefreshToken, 'ms-rt-original')
  assert.equal(afterForm.authMode, 'oauth2')
  // 轮换写回
  store.saveMicrosoftAuth({ refreshToken: 'ms-rt-rotated', needsReauth: false })
  assert.equal(store.getSmtpConfig().msRefreshToken, 'ms-rt-rotated')
  // 失效标记
  store.saveMicrosoftAuth({ needsReauth: true })
  assert.equal(store.getSmtpConfig().msNeedsReauth, true)
  // 视图：只有布尔与邮箱，绝无令牌
  const view = store.getSmtpView()
  assert.equal(view.ms.refreshTokenConfigured, true)
  assert.equal(view.ms.accountEmail, 'me@outlook.com')
  assert.equal(view.ms.needsReauth, true)
  assert.ok(!JSON.stringify(view).includes('ms-rt'))
  // 断开：全部 MS 字段删除，其余配置保留
  store.clearMicrosoftAuth()
  const cleared = store.getSmtpConfig()
  assert.equal(cleared.msRefreshToken, '')
  assert.equal(cleared.authMode, 'oauth2')
  assert.equal(cleared.user, 'admin@qq.com')
  assert.equal(store.getSmtpView().ms.refreshTokenConfigured, false)
})

test('registration mode defaults to open, clamps invalid values and gates invites', () => {
  assert.equal(store.getRegistrationMode(), 'open')
  assert.equal(store.setRegistrationMode('invite'), 'invite')
  assert.throws(() => store.setRegistrationMode('everything-goes'), /无效注册模式/)
  assert.equal(store.setRegistrationMode('open'), 'open')

  // 邀请码：生成（inv_ 前缀）→ 列表脱敏 → 校验不消费 → 消费一次性 → 吊销仅限未用
  const invite = store.createInvite('admin1')
  assert.ok(invite.code.startsWith('inv_'))
  const listed = store.listInvites()[0]
  assert.ok(listed.code.includes('…') && !listed.code.includes(invite.code.slice(8)), '列表不得回明文')
  assert.equal(store.validateInvite(invite.code), true)
  assert.equal(store.validateInvite('inv_wrong'), false)
  assert.equal(store.consumeInvite(invite.code, 'newuser'), true)
  assert.equal(store.consumeInvite(invite.code, 'newuser'), false)
  assert.equal(store.validateInvite(invite.code), false)
  const iv2 = store.createInvite('admin1')
  assert.equal(store.revokeInvite(iv2.id), true)
  assert.equal(store.revokeInvite(invite.id), false) // 已用的不能吊销
})

test('corrupt files fail closed and are never replaced by an empty database', () => {
  const file = path.join(dir, 'users.json')
  fs.writeFileSync(file, '{broken')
  assert.throws(() => store.upsertUser('test', { role: 'admin' }), /无法读取 users.json/)
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken')
  fs.unlinkSync(file)
})

test('prototype names do not read or mutate inherited users', () => {
  assert.equal(store.getUser('constructor'), null)
  assert.equal(store.getUser('__proto__'), null)
  store.upsertUser('__proto__', { username: '__proto__', role: 'guest' })
  assert.equal(store.getUser('__proto__').role, 'guest')
  assert.equal({}.role, undefined)
})
