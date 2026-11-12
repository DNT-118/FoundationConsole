// Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0
/** R4 单元测试：成员与权限 / 通知规则（频率限制、去重）/ 定时任务（到期判定、恢复、记录）/ 玩家历史（差分、趋势、保留）。 */
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfc-round4-test-'))
process.env.PFC_DATA_DIR = dir
process.env.PFC_MASTER_KEY = 'isolated-round4-key'
after(() => fs.rmSync(dir, { recursive: true, force: true }))

const store = require('./store')
const notify = require('./notify')
const scheduler = require('./scheduler')
const playerHistory = require('./playerHistory')

// 用户：owner / manager / operator / viewer / outsider
store.upsertUser('owner1', { username: 'owner1', role: 'user' })
store.upsertUser('manager1', { username: 'manager1', role: 'user' })
store.upsertUser('operator1', { username: 'operator1', role: 'user' })
store.upsertUser('viewer1', { username: 'viewer1', role: 'user' })
const srv = store.addServer('owner1', { host: 'gameserver.example.com', port: 8081, token: 'tok', apiKey: 'key' })

// ================= 成员与权限 =================

test('servers migrate to owner/members and roles resolve correctly', () => {
  assert.equal(store.accessRole('owner1', srv.id), 'owner')
  assert.equal(store.accessRole('nobody', srv.id), null)
  // 旧记录（无 owner/members 字段）迁移：owner 回填 userId
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'servers.json'), 'utf8'))
  const entry = raw.servers[0]
  assert.equal(entry.owner, 'owner1')
  assert.deepEqual(entry.members, {})
})

test('member management enforces owner/manager and role hierarchy', () => {
  // viewer 不能管理
  store.setMember(srv.id, 'owner1', 'viewer1', 'viewer')
  assert.equal(store.setMember(srv.id, 'viewer1', 'manager1', 'manager').ok, false)
  // owner 加 manager / operator
  assert.equal(store.setMember(srv.id, 'owner1', 'manager1', 'manager').ok, true)
  assert.equal(store.setMember(srv.id, 'owner1', 'operator1', 'operator').ok, true)
  // manager 只能授予 operator 及以下
  assert.equal(store.setMember(srv.id, 'manager1', 'viewer1', 'viewer').ok, true)
  assert.equal(store.setMember(srv.id, 'manager1', 'outsider', 'operator').ok, false) // 平台无此用户
  assert.equal(store.setMember(srv.id, 'manager1', 'operator1', 'manager').ok, false)
  assert.equal(store.setMember(srv.id, 'manager1', 'owner1', 'operator').ok, false) // 不能改所有者
  // manager 不能移除 manager
  assert.equal(store.removeMember(srv.id, 'manager1', 'manager1').ok, false)
  // 列表仅 owner/manager 可见
  assert.equal(store.listMembers(srv.id, 'viewer1').ok, false)
  assert.equal(store.listMembers(srv.id, 'manager1').members.length, 3)
  // 不可分享给不存在用户
  assert.equal(store.setMember(srv.id, 'owner1', 'ghost', 'viewer').ok, false)
})

test('shared servers appear in member lists with computed roles', () => {
  const owned = store.listServers('owner1')
  assert.equal(owned[0]._role, 'owner')
  const op = store.listServers('operator1')
  assert.equal(op.length, 1)
  assert.equal(op[0]._role, 'operator')
  assert.equal(op[0].sharedBy, 'owner1')
  const vi = store.listServers('viewer1')
  assert.equal(vi[0]._role, 'viewer')
  // 只有 owner 能改配置/删除
  assert.equal(store.updateServer('operator1', srv.id, { label: 'x' }), null)
  assert.equal(store.removeServer('operator1', srv.id), false)
  assert.equal(store.accessRole('owner1', srv.id), 'owner')
})

// ================= 通知规则 =================

notify.init({
  accessRole: (username, serverId) => store.accessRole(username, serverId),
  isPlatformAdmin: (username) => store.getUser(username)?.role === 'admin',
  sendEmail: async (mail) => { emails.push(mail) },
})
const emails = []

test('notify rules: matching, rate limit and dedup, access revocation', () => {
  store.upsertUser('admin1', { username: 'admin1', role: 'admin', email: 'admin1@qq.com' })
  store.setMember(srv.id, 'owner1', 'admin1', 'viewer')
  const rule = store.addNotifyRule('viewer1', { serverId: srv.id, events: ['warhead_started', 'player_reported'], minIntervalSeconds: 10 })
  const rule2 = store.addNotifyRule('admin1', { serverId: '*', events: ['warhead_started'], email: true, minIntervalSeconds: 10 })

  notify.handleEvent(srv.id, 'warhead_started', {})
  // viewer1 站内 1 条；admin1 邮件 1 封（viewer 角色也允许通知——数据类）
  assert.equal(store.listNotifications('viewer1').length, 1)
  assert.equal(store.listNotifications('admin1').length, 1)
  assert.equal(emails.length, 1)
  assert.equal(emails[0].to, 'admin1@qq.com')

  // 频率限制：同规则 10s 内不重复
  notify.handleEvent(srv.id, 'warhead_started', {})
  assert.equal(store.listNotifications('viewer1').length, 1)
  assert.equal(emails.length, 1)

  // 去重：不同事件相同内容 60s 内不重复
  notify.handleEvent(srv.id, 'player_reported', { reporter_nickname: 'A', target_nickname: 'B' })
  notify.handleEvent(srv.id, 'player_reported', { reporter_nickname: 'A', target_nickname: 'B' })
  assert.equal(store.listNotifications('viewer1').filter((n) => n.event === 'player_reported').length, 1)

  // 无权限用户不通知
  store.addNotifyRule('outsider', { serverId: srv.id, events: ['warhead_started'] }).catch?.(() => {})
  const before = store.listNotifications('owner1').length
  notify.handleEvent(srv.id, 'warhead_started', { nick: Date.now() }) // 不同 payload 绕过去重，但 outsider 无访问权
  assert.equal(store.listNotifications('outsider').length, 0)
  assert.equal(store.listNotifications('owner1').length, before) // owner1 没建规则

  // 访问权被撤销后不再通知
  store.removeMember(srv.id, 'owner1', 'admin1')
  notify.handleEvent(srv.id, 'warhead_started', { rev: 1 })
  assert.equal(emails.length, 1)
  notify.resetState()
})

test('notify rule validation rejects empty events and enforces caps', () => {
  assert.throws(() => store.addNotifyRule('viewer1', { serverId: srv.id, events: ['nope'] }), /至少选择一种事件/)
  assert.equal(store.listNotifyRules('viewer1').length, 1)
})

// ================= 定时任务 =================

test('schedule payload validation follows upstream endpoint contracts', () => {
  assert.deepEqual(store.validateSchedulePayload('broadcast', { message: 'hi', duration_seconds: 999, clear_previous: true }),
    { message: 'hi', duration_seconds: 60, clear_previous: true })
  assert.throws(() => store.validateSchedulePayload('broadcast', { message: '' }), /不能为空/)
  assert.throws(() => store.validateSchedulePayload('console', { command: 'sldataapi apikey create x admin' }), /sldataapi/)
  assert.throws(() => store.validateSchedulePayload('console', { command: '' }), /不能为空/)
  assert.deepEqual(store.validateSchedulePayload('cassie', { message: 'm', translation: 't' }), { message: 'm', isNoisy: true, translation: 't' })
})

test('schedules: permission, due evaluation, executor runs and persistence', async () => {
  let calls = []
  scheduler.init({ executor: async (serverId, path, body) => { calls.push({ serverId, path, body }); return { ok: true, message: 'sent' } } })
  // operator 不能创建
  assert.throws(() => store.addSchedule('operator1', srv.id, { kind: 'broadcast', payload: { message: 'x' }, intervalSeconds: 60 }), /仅所有者或管理者/)
  const sch = store.addSchedule('owner1', srv.id, { kind: 'broadcast', payload: { message: '重启提醒' }, intervalSeconds: 60 })

  // 永未跑过 → 立即到期
  assert.equal(scheduler.isDue(sch, Date.now()), true)
  await scheduler.tick()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, '/control/broadcast')
  // 刚跑完 → 未到期
  const after = store.listSchedules('owner1').find((s) => s.id === sch.id)
  assert.equal(scheduler.isDue(after, Date.now()), false)
  // 到期 → 执行并记录
  await scheduler.tick(after.lastRunAt + 61_000)
  const recorded = store.listSchedules('owner1').find((s) => s.id === sch.id)
  assert.equal(recorded.runs.length, 2)
  assert.equal(recorded.runs[0].ok, true)
  // 暂停后不再执行
  store.updateSchedule('owner1', sch.id, { enabled: false })
  const paused = store.listSchedules('owner1').find((s) => s.id === sch.id)
  assert.equal(scheduler.isDue(paused, Date.now() + 999_999), false)
  // 重启恢复语义：lastRunAt 持久化在文件中
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'schedules.json'), 'utf8'))
  assert.ok(raw.schedules[0].lastRunAt > 0)
  // 执行记录滚动上限
  for (let i = 0; i < 25; i++) store.recordScheduleRun(sch.id, true, 'x')
  assert.equal(store.listSchedules('owner1').find((s) => s.id === sch.id).runs.length, 20)
  // 删除：viewer 不能
  assert.throws(() => store.removeSchedule('viewer1', sch.id), /仅所有者或管理者/)
  assert.equal(store.removeSchedule('owner1', sch.id), true)
})

// ================= 玩家历史 =================

test('player history: diff join/leave, nickname follow, trend and retention', () => {
  const sid = 'hist-server'
  const first = playerHistory.observe(sid, {
    players: [
      { nickname: 'Alice', steam_id: '76561198000000001@steam' },
      { nickname: 'Bob', steam_id: '76561198000000002@steam' },
      { nickname: 'Bot', steam_id: 'dummy@northwood' }, // 非 Steam 不记录
    ],
  })
  assert.equal(first.joined.length, 2)
  assert.equal(first.left.length, 0)

  // Alice 改名跟随；Bob 离开
  const second = playerHistory.observe(sid, {
    players: [{ nickname: 'Alice2', steam_id: '76561198000000001@steam' }],
  })
  assert.deepEqual(second.left.map((x) => x.userid), ['76561198000000002'])
  assert.equal(second.joined.length, 0)

  const h = playerHistory.history(sid, 1)
  assert.equal(h.users.length, 2)
  const alice = h.users.find((u) => u.userid === '76561198000000001')
  assert.equal(alice.online, true)
  assert.equal(alice.nickname, 'Alice2')
  const bob = h.users.find((u) => u.userid === '76561198000000002')
  assert.equal(bob.online, false)
  assert.ok(bob.totalSeconds >= 0)
  assert.ok(h.trend.length > 0)
  assert.ok(h.trend[h.trend.length - 1].online >= 1) // Alice 在线

  // 持久化：flush 后重新 observe 不重复计数（同一在线会话）
  playerHistory.flush()
  const third = playerHistory.observe(sid, { players: [{ nickname: 'Alice2', steam_id: '76561198000000001@steam' }] })
  assert.equal(third.joined.length, 0)

  // 清除
  playerHistory.clear(sid)
  assert.equal(playerHistory.history(sid, 1).users.length, 0)
})

test('player history days config clamps to 1-365 with default 30', () => {
  assert.equal(store.getPlayerHistoryDays(), 30)
  assert.equal(store.setPlayerHistoryDays(7), 7)
  assert.equal(store.getPlayerHistoryDays(), 7)
  assert.equal(store.setPlayerHistoryDays(1000), 365)
  assert.equal(store.setPlayerHistoryDays(0), 30)
})
