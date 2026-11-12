// Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0
/**
 * 玩家历史（R4）：基于 /get_sl_data 轮询差分记录每台服务器的玩家进出与时长。
 *  - observe(serverId, raw)：对一次成功轮询做差分（steam_id 形如 "7656…@steam"，
 *    非 Steam ID（@northwood/@discord/假人）不记录），返回 {joined, left}。
 *  - 持久化 playerHistory.json：{ servers: { [id]: { sessions: [{userid, nickname, joinAt, leaveAt}] } } }，
 *    内存缓冲 + 10s 落盘节流；保留天数可配（默认 30），过期会话在观察与查询时惰性清理。
 *  - history(serverId, days)：按 userid 聚合会话（次数/总时长/最近在线）+ 在线趋势（分桶计数）。
 */
const fs = require('node:fs')
const path = require('node:path')
const store = require('./store')

const STEAM_ID_RE = /^(\d{17})(?:@steam)?$/i
const FLUSH_INTERVAL_MS = 10_000

const DATA_DIR = process.env.PFC_DATA_DIR
  ? path.resolve(process.env.PFC_DATA_DIR)
  : path.join(__dirname, 'data')

/** 内存态：serverId -> Map(userid -> {nickname, joinAt, leaveAt|null})（leaveAt null = 在线）。 */
const live = new Map()
let loaded = false

function loadState() {
  if (loaded) return
  loaded = true
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'playerHistory.json'), 'utf8'))
    const servers = raw && typeof raw.servers === 'object' ? raw.servers : {}
    for (const [serverId, entry] of Object.entries(servers)) {
      const m = new Map()
      for (const s of Array.isArray(entry.sessions) ? entry.sessions : []) {
        if (!s || typeof s.userid !== 'string' || !Number.isFinite(s.joinAt)) continue
        m.set(s.userid, { userid: s.userid, nickname: String(s.nickname || ''), joinAt: s.joinAt, leaveAt: Number.isFinite(s.leaveAt) ? s.leaveAt : null })
      }
      live.set(serverId, m)
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[PFC] playerHistory 读取失败:', e.message)
  }
}

let flushTimer = null
function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flush()
  }, FLUSH_INTERVAL_MS)
  if (flushTimer.unref) flushTimer.unref()
}

function sweepMap(map, cutoff) {
  for (const [userid, s] of map) {
    if (s.leaveAt !== null && s.leaveAt < cutoff) map.delete(userid)
    else if (s.leaveAt === null && s.joinAt < cutoff) {
      // 在线会话不可能早于保留窗口（进程内 live 会持续更新）；旧文件恢复时兜底清理
      map.delete(userid)
    }
  }
}

function flush() {
  loadState()
  const cutoff = Date.now() - store.getPlayerHistoryDays() * 86400_000
  const servers = {}
  for (const [serverId, map] of live) {
    sweepMap(map, cutoff)
    if (map.size === 0) continue
    servers[serverId] = { sessions: [...map.values()] }
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(path.join(DATA_DIR, 'playerHistory.json'), JSON.stringify({ servers }))
  } catch (e) {
    console.error('[PFC] playerHistory 写盘失败:', e.message)
  }
}

function parseSteamId(raw) {
  const m = String(raw || '').trim().match(STEAM_ID_RE)
  return m ? m[1] : ''
}

/**
 * 对一次成功轮询做差分。raw 为 /get_sl_data 原始响应（players[].steam_id / nickname）。
 * 返回 { joined: [{userid, nickname}], left: [{userid, nickname}] }。
 */
function observe(serverId, raw) {
  loadState()
  const days = store.getPlayerHistoryDays()
  const cutoff = Date.now() - days * 86400_000
  if (!live.has(serverId)) live.set(serverId, new Map())
  const map = live.get(serverId)
  sweepMap(map, cutoff)

  const seen = new Map() // userid -> nickname（本次快照）
  for (const p of Array.isArray(raw?.players) ? raw.players : []) {
    const userid = parseSteamId(p?.steam_id)
    if (!userid) continue // 非 Steam ID（northwood/discord/假人）不入历史
    seen.set(userid, String(p.nickname || '').slice(0, 64))
  }

  const joined = []
  const left = []
  const now = Date.now()
  // 进：快照有而历史无（或上次已离开）
  for (const [userid, nickname] of seen) {
    const prev = map.get(userid)
    if (!prev || prev.leaveAt !== null) {
      map.set(userid, { userid, nickname, joinAt: now, leaveAt: null })
      joined.push({ userid, nickname })
    } else if (prev.nickname !== nickname && nickname) {
      prev.nickname = nickname // 改名跟随
    }
  }
  // 出：历史在线而快照无
  for (const [userid, s] of map) {
    if (s.leaveAt === null && !seen.has(userid)) {
      s.leaveAt = now
      left.push({ userid, nickname: s.nickname })
    }
  }
  if (joined.length || left.length) scheduleFlush()
  return { joined, left }
}

/** 查询：按 userid 聚合 + 在线趋势（分桶：≤2 天→30 分钟，≤7 天→2 小时，更长→1 天）。 */
function history(serverId, days) {
  loadState()
  const queryDays = Math.min(90, Math.max(1, Number(days) || store.getPlayerHistoryDays()))
  const cutoff = Date.now() - queryDays * 86400_000
  const map = live.get(serverId)
  const sessions = map ? [...map.values()].filter((s) => s.leaveAt === null || s.leaveAt >= cutoff) : []

  const byUser = new Map()
  for (const s of sessions) {
    const end = s.leaveAt === null ? Date.now() : s.leaveAt
    if (end < cutoff) continue
    const agg = byUser.get(s.userid) || { userid: s.userid, nickname: s.nickname, sessions: 0, totalSeconds: 0, firstSeen: s.joinAt, lastSeen: 0, online: s.leaveAt === null }
    agg.sessions += 1
    agg.totalSeconds += Math.max(0, Math.round((end - s.joinAt) / 1000))
    agg.firstSeen = Math.min(agg.firstSeen, s.joinAt)
    agg.lastSeen = Math.max(agg.lastSeen, end)
    if (s.nickname) agg.nickname = s.nickname
    byUser.set(s.userid, agg)
  }

  // 趋势桶：桶内在线 = 在桶终点（末桶为当前时刻）时在线的玩家数
  const bucketMs = queryDays <= 2 ? 30 * 60_000 : queryDays <= 7 ? 2 * 3600_000 : 86400_000
  const now = Date.now()
  const startBucket = Math.floor((now - queryDays * 86400_000) / bucketMs) * bucketMs
  const trend = []
  for (let t = startBucket; t <= now; t += bucketMs) {
    const point = Math.min(t + bucketMs, now)
    let online = 0
    for (const s of sessions) {
      const end = s.leaveAt === null ? now : s.leaveAt
      if (s.joinAt <= point && end >= point) online += 1
    }
    trend.push({ t, online })
  }

  const users = [...byUser.values()].sort((a, b) => b.lastSeen - a.lastSeen)
  return { days: queryDays, users, trend }
}

/** 管理员清除：serverId 为空 = 全部。 */
function clear(serverId) {
  loadState()
  if (serverId) live.delete(serverId)
  else live.clear()
  flush()
}

module.exports = { observe, history, clear, flush, parseSteamId }
