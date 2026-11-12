import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ControlError, controlErrorFrom, holidayInactiveInfo, ControlErrorCode } from '../src/api/controlError.ts'
import { normalizeServerData } from '../src/api/normalize.ts'
import { describeControlError, fill, holidayLabel } from '../src/utils/controlHint.ts'

const zhDict = {
  'err.holidayInactive': '节日功能未开启：该功能需要 {required}，当前节日为 {active}。',
  'err.featureUnavailable': '当前游戏版本不提供该功能（上游 501）。',
  'err.tlsRequired': 'TLS required.',
  'holiday.None': '无',
  'holiday.Christmas': '圣诞节',
  'holiday.Halloween': '万圣节',
  'holiday.AprilFools': '愚人节',
}

test('holiday_inactive results carry the structured code through ControlError', () => {
  const result = {
    success: false,
    message: '节日功能未开启：candy:Red 需要 Halloween，当前节日 None',
    status: 409,
    data: { code: 'holiday_inactive', feature: 'candy:Red', active_holiday: 'None', required: ['Halloween'] },
  }
  const err = controlErrorFrom(result)
  assert.ok(err instanceof ControlError)
  assert.equal(err.status, 409)
  assert.equal(err.code, ControlErrorCode.HolidayInactive)
  const info = holidayInactiveInfo(err)
  assert.ok(info)
  assert.equal(info.activeHoliday, 'None')
  assert.deepEqual(info.required, ['Halloween'])
})

test('non-holiday failures keep upstream message and are not holiday results', () => {
  const err = controlErrorFrom({ success: false, message: 'API Key 有效但未授权该端点', status: 403 })
  assert.equal(err.code, '')
  assert.equal(holidayInactiveInfo(err), null)
})

test('describeControlError renders a localized holiday hint and known codes', () => {
  const t = (k) => zhDict[k] ?? k
  const holiday = controlErrorFrom({
    success: false, message: 'raw upstream text', status: 409,
    data: { code: 'holiday_inactive', feature: 'candy:Red', active_holiday: 'None', required: ['Halloween'] },
  })
  assert.equal(describeControlError(holiday, t), '节日功能未开启：该功能需要 万圣节，当前节日为 无。')

  const unavailable = controlErrorFrom({ success: false, message: 'x', status: 501, data: { code: 'feature_unavailable', feature: 'dummies' } })
  assert.equal(describeControlError(unavailable, t), zhDict['err.featureUnavailable'])

  const plain = new Error('plain message')
  assert.equal(describeControlError(plain, t), 'plain message')
})

test('normalize maps the 2.6.x snapshot fields and CN team names', () => {
  const state = normalizeServerData({
    success: true,
    server_name: '  <color=#fff>Area-14</color>  ',
    online: true,
    players_count: 2,
    max_players: 20,
    round_started: true,
    round_duration: 120,
    current_phase: '进行中',
    nuke_status: '倒计时:42秒',
    nuke_countdown: 42,
    d_count: 2,
    foundation_count: 0,
    scp_count: 0,
    spectator_count: 0,
    ping: 30,
    players: [
      { nickname: 'A', steam_id: '76561198@example@steam', role: '混沌-步枪手', team: '混沌', x: 1, y: 2, z: 3 },
      { nickname: 'B', steam_id: '', role: '教程', team: '其他' },
    ],
    voice_port: 8082,
    game_version: '14.2.8',
    active_holiday: 'Halloween',
  }, 'srv')
  assert.equal(state.name, 'Area-14')
  assert.equal(state.gameVersion, '14.2.8')
  assert.equal(state.activeHoliday, 'Halloween')
  assert.equal(state.voicePort, 8082)
  assert.equal(state.nukeCode, 'countdown')
  assert.equal(state.players[0].team, 'D-Class') // 混沌与 D 级同桶（d_count 口径一致）
  assert.equal(state.players[1].team, 'Unknown') // OtherAlive → Unknown
})

test('older servers without the 2.6.x fields normalize to empty defaults', () => {
  const state = normalizeServerData({
    success: true,
    server_name: 'legacy', online: true, players_count: 0, max_players: 0,
    round_started: false, round_duration: 0, current_phase: '等待开始',
    nuke_status: '未激活', nuke_countdown: 0,
    d_count: 0, foundation_count: 0, scp_count: 0, spectator_count: 0, ping: 0, players: [],
  })
  assert.equal(state.gameVersion, '')
  assert.equal(state.activeHoliday, '')
  assert.equal(state.voicePort, 0)
})

test('fill substitutes named placeholders and holidayLabel localizes known codes', () => {
  assert.equal(fill('{a} → {b} ({missing})', { a: '1', b: '2' }), '1 → 2 ({missing})')
  const t = (k) => zhDict[k] ?? k
  assert.equal(holidayLabel('Halloween', t), '万圣节')
  assert.equal(holidayLabel('None', t), '无')
  assert.equal(holidayLabel('SomeCustom', t), 'SomeCustom')
})
