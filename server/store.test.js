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
