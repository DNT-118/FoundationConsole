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
