// Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0
/**
 * 定时任务调度器（R4）：按 store 持久化的 schedules 每 TICK_MS 扫描到期任务并执行。
 *  - 只允许 SLDataAPI 已有控制端点：broadcast → /control/broadcast，cassie → /control/cassie，
 *    console → /control/console/command（console 禁止 sldataapi/slda 管理命令，见 store.validateSchedulePayload）；
 *  - 执行经注入的 executor（= wsHub.callForServer，传输协商 + API Key 注入），结果写入
 *    store.recordScheduleRun（lastRunAt 持久化 → 服务重启后按 lastRunAt + interval 恢复节奏，
 *    停机期间的欠账最多补跑一次）；
 *  - 同一 tick 内同一任务绝不重复执行；单次执行最长等 30s（与上游控制超时一致）。
 */
const store = require('./store')

const TICK_MS = 15_000
const EXEC_TIMEOUT_MS = 30_000

let timer = null
let running = false
let deps = { executor: async () => ({ ok: false, message: 'scheduler 未初始化' }) }

/** server.js 注入：executor(serverId, path, body) → Promise<{ok, message}>。 */
function init(d) { deps = { ...deps, ...d } }

const KIND_PATH = {
  broadcast: '/control/broadcast',
  cassie: '/control/cassie',
  console: '/control/console/command',
}

function withTimeout(p) {
  return Promise.race([
    p,
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, message: '执行超时' }), EXEC_TIMEOUT_MS)),
  ])
}

/** 到期判定：enabled 且 now >= lastRunAt + intervalSeconds（lastRunAt=0 表示从未跑过 → 立即执行一次）。 */
function isDue(schedule, now) {
  if (!schedule.enabled) return false
  return now >= (schedule.lastRunAt || 0) + schedule.intervalSeconds * 1000
}

/** 手动驱动一次扫描（测试用）；生产由 start() 的定时器驱动。 */
async function tick(now = Date.now()) {
  if (running) return 0
  running = true
  let executed = 0
  try {
    for (const s of store.listSchedulesForScheduler()) {
      if (!isDue(s, now)) continue
      executed += 1
      const path = KIND_PATH[s.kind]
      let result
      if (!path) {
        result = { ok: false, message: `未知任务类型: ${s.kind}` }
      } else {
        try {
          result = await withTimeout(deps.executor(s.serverId, path, s.payload))
        } catch (e) {
          result = { ok: false, message: e instanceof Error ? e.message : String(e) }
        }
      }
      store.recordScheduleRun(s.id, result.ok === true, result.message || (result.ok ? 'ok' : '执行失败'))
    }
  } finally {
    running = false
  }
  return executed
}

function start() {
  stop()
  timer = setInterval(() => { void tick().catch(() => { /* tick 内部已兜底 */ }) }, TICK_MS)
  if (timer.unref) timer.unref()
}

function stop() {
  if (timer) { clearInterval(timer); timer = null }
}

/** 测试钩子：清运行状态。 */
function resetState() { /* 无内部持久状态（running 由 finally 复位） */ }

module.exports = { init, start, stop, tick, KIND_PATH, isDue }
