// Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0
/**
 * /api/sl/ws —— 浏览器控制通道 WebSocket 聚合枢纽。
 * 设计文档：docs/ws-control-design.md；上游协议：SLDataAPI v2.6 /ws/control。
 *
 * 职责：
 *  1) 数据通道：每台服务器一个 HTTP 轮询器（平台聚合、订阅驱动），
 *     /get_sl_data 结果以 state 帧推送给订阅的浏览器连接；
 *  2) 控制通道：按服务器记录的 controlTransport 分流——
 *     'ws' 走上游 /ws/control 长连接中继（call/result），
 *     'http'（或 WS 探测 404 后记忆降级）走 HTTP 转发；
 *  3) 硬互斥探测：上游 WS 握手 404 → 进程内记忆为 HTTP 模式；
 *     401 → 停止重试（游戏服按 IP 锁定，平台是单一出口 IP），错误透传。
 *
 * 使用 ws 处理握手、分片、掩码与消息长度限制。
 */
const { WebSocket, WebSocketServer } = require('ws')
const { isAllowedControlPath, isSameOrigin } = require('./security')
const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024, perMessageDeflate: false })
const crypto = require('node:crypto')

const MAX_CONNECTIONS = 2000
const POLL_MIN_MS = 1000
const POLL_MAX_MS = 30000
const CALL_TIMEOUT_MS = 30000
const UPSTREAM_RECONNECT_MIN_MS = 30000
const FORBIDDEN_COOLDOWN_MS = 10 * 60 * 1000
const MAX_MESSAGE_BYTES = 512 * 1024
const UPSTREAM_HEARTBEAT_MS = 25000

let deps = null // { resolveUser, listServers, findServer, isOwned, resolveServerHost, fetchHttp }，由 server.js 注入

function init(d) {
  deps = d
}

// ================= 浏览器侧连接 =================

const clients = new Map() // socket -> { user, subs:Set<serverId>, eventSubs:Set<serverId>, buf:Buffer }
const subs = new Map() // serverId -> Set<socket>
const eventSubs = new Map() // serverId -> Set<socket>（仅 WS 事件流）

function attach(req, socket, head) {
  socket.on('error', () => {})
  if (clients.size >= MAX_CONNECTIONS || !isSameOrigin(req)) { socket.destroy(); return }
  let user
  try { user = deps.resolveUser(req.headers.cookie || '') } catch { socket.destroy(); return }
  if (!user) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return }
  wss.handleUpgrade(req, socket, head || Buffer.alloc(0), (ws) => {
    const entry = { user, cookie: req.headers.cookie || '', subs: new Set(), eventSubs: new Set(), lastActivity: Date.now(), inFlight: 0 }
    clients.set(ws, entry)
    ws.on('error', () => closeClient(ws))
    ws.on('close', () => closeClient(ws))
    ws.on('pong', () => { entry.lastActivity = Date.now() })
    ws.on('message', (payload, binary) => {
      entry.lastActivity = Date.now()
      if (binary || !refreshClient(ws, entry)) return
      try { onClientMessage(ws, entry, payload) } catch { closeClient(ws) }
    })
    sendText(ws, JSON.stringify({ type: 'hello', version: '1.0', endpoint: '/api/sl/ws' }))
  })
}

function refreshClient(socket, entry) {
  let user
  try { user = deps.resolveUser(entry.cookie) } catch { closeClient(socket); return false }
  if (!user || user.username !== entry.user.username) { closeClient(socket); return false }
  entry.user = user
  return true
}

// Expired/revoked sessions and stalled consumers cannot keep subscriptions alive indefinitely.
const clientSweep = setInterval(() => {
  for (const [socket, entry] of clients) {
    if (Date.now() - entry.lastActivity > 90000 || !refreshClient(socket, entry)) { closeClient(socket); continue }
    const owned = new Set(deps.listServers(entry.user.username).map(s => s.id))
    if ([...entry.subs, ...entry.eventSubs].some(id => !owned.has(id)) || (entry.user.role === 'guest' && entry.eventSubs.size)) {
      closeClient(socket); continue
    }
    // R4：viewer（只看数据）不可持续占用事件流订阅
    if (typeof deps.accessRole === 'function' && entry.eventSubs.size &&
        [...entry.eventSubs].some(id => { const r = deps.accessRole(entry.user.username, id); return !r || r === 'viewer' })) {
      closeClient(socket); continue
    }
    socket.ping()
  }
}, 30000)
clientSweep.unref()

function closeClient(socket) {
  const entry = clients.get(socket)
  if (entry) {
    for (const sid of entry.subs) {
      const set = subs.get(sid)
      if (set) {
        set.delete(socket)
        if (set.size === 0) {
          subs.delete(sid)
          stopPoller(sid)
        }
      }
    }
    const affectedEventServers = [...entry.eventSubs]
    for (const sid of affectedEventServers) {
      const set = eventSubs.get(sid)
      if (set) {
        set.delete(socket)
        if (set.size === 0) eventSubs.delete(sid)
      }
    }
    entry.eventSubs.clear()
    for (const sid of affectedEventServers) syncUpstreamEventSubscription(sid)
    clients.delete(socket)
  }
  try { socket.terminate() } catch { /* ignore */ }
}

function onClientMessage(socket, entry, payloadBuf) {
  if (payloadBuf.length > MAX_MESSAGE_BYTES) {
    sendText(socket, JSON.stringify({ type: 'error', message: '消息过大' }))
    return
  }
  let msg
  try { msg = JSON.parse(payloadBuf.toString('utf8')) } catch {
    sendText(socket, JSON.stringify({ type: 'error', message: '非法 JSON' }))
    return
  }

  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'ping') {
    sendText(socket, JSON.stringify({ type: 'pong' }))
    return
  }
  if (msg.type === 'subscribe') {
    const wanted = Array.isArray(msg.serverIds)
      ? msg.serverIds.filter((x) => typeof x === 'string').slice(0, 64)
      : []
    const owned = new Set(deps.listServers(entry.user.username).map((s) => s.id))
    const next = new Set(wanted.filter(sid => owned.has(sid)))
    // 保留未变化的订阅，避免重置缓存并产生重叠轮询。
    for (const sid of entry.subs) {
      if (next.has(sid)) continue
      const set = subs.get(sid)
      if (set) {
        set.delete(socket)
        if (set.size === 0) { subs.delete(sid); stopPoller(sid) }
      }
    }
    entry.subs = next
    for (const sid of next) {
      let set = subs.get(sid)
      if (!set) { set = new Set(); subs.set(sid, set) }
      set.add(socket)
      ensurePoller(sid)
      pushCached(sid, socket)
      pushUpstreamInfo(sid, socket)
    }
    return
  }
  if (msg.type === 'subscribe_events') {
    if (entry.user.role === 'guest') { sendText(socket, JSON.stringify({ type: 'error', message: '访客不可订阅控制事件' })); return }
    const wanted = Array.isArray(msg.serverIds)
      ? msg.serverIds.filter((x) => typeof x === 'string').slice(0, 64)
      : []
    const owned = new Set(deps.listServers(entry.user.username).map((s) => s.id))
    const affected = new Set(entry.eventSubs)
    // R4 成员角色强制：viewer（只看数据）不可订阅控制事件流
    if (typeof deps.accessRole === 'function' && wanted.some((sid) => {
      const role = deps.accessRole(entry.user.username, sid)
      return !role || role === 'viewer'
    })) {
      sendText(socket, JSON.stringify({ type: 'error', message: '当前成员角色为「只看数据」，无事件流权限' }))
      return
    }

    // 全量覆盖式事件订阅，与数据订阅独立；未拥有的服务器静默忽略。
    for (const sid of entry.eventSubs) {
      const set = eventSubs.get(sid)
      if (set) {
        set.delete(socket)
        if (set.size === 0) eventSubs.delete(sid)
      }
    }
    entry.eventSubs.clear()

    for (const sid of wanted) {
      if (!owned.has(sid)) continue
      entry.eventSubs.add(sid)
      affected.add(sid)
      let set = eventSubs.get(sid)
      if (!set) { set = new Set(); eventSubs.set(sid, set) }
      set.add(socket)
    }

    for (const sid of affected) {
      const server = deps.findServer(sid)
      if (eventSubs.has(sid) && server) void ensureEventUpstream(server)
      else syncUpstreamEventSubscription(sid)
    }
    return
  }
  if (msg.type === 'call') {
    void handleCall(entry, socket, msg).catch(() => sendResult(socket, String(msg.reqId || ''), String(msg.serverId || ''), false, 502, '控制中继失败，请核实操作结果'))
    return
  }
  sendText(socket, JSON.stringify({ type: 'error', message: `未知消息类型: ${msg.type}` }))
}

// ================= 数据轮询器（HTTP 聚合） =================

const pollers = new Map() // serverId -> { timer, inFlight, lastRaw, lastAt, errAt }

function ensurePoller(serverId) {
  const server = deps.findServer(serverId)
  if (!server || pollers.has(serverId)) return
  const interval = Math.min(POLL_MAX_MS, Math.max(POLL_MIN_MS, Number(server.refetchInterval) || 5000))
  const tick = () => {
    void pollOnce(serverId)
  }
  const timer = setInterval(tick, interval)
  pollers.set(serverId, { timer, inFlight: false, lastRaw: null, lastAt: 0, errAt: 0 })
  tick()
}

function stopPoller(serverId) {
  const p = pollers.get(serverId)
  if (!p) return
  clearInterval(p.timer)
  pollers.delete(serverId)
}

async function pollOnce(serverId) {
  const p = pollers.get(serverId)
  if (!p || p.inFlight) return
  p.inFlight = true
  try {
    const r = await deps.fetchHttp(serverId, 'GET', '/get_sl_data', undefined)
    if (pollers.get(serverId) !== p) return
    if (r.ok && r.data?.success === true) {
      p.lastRaw = r.data
      p.lastAt = Date.now()
      p.errAt = 0
      // R4：玩家历史差分（玩家进出记录，fire-and-forget）
      if (typeof deps.onPollData === 'function') {
        try { deps.onPollData(serverId, r.data) } catch { /* 历史记录失败不影响推送 */ }
      }
      broadcast(serverId, { type: 'state', serverId, fetchedAt: p.lastAt, raw: p.lastRaw })
    } else {
      failPoll(serverId, p, r.message || '目标不可达')
    }
  } catch {
    if (pollers.get(serverId) === p) failPoll(serverId, p, '目标不可达')
  } finally {
    p.inFlight = false
  }
}

function failPoll(serverId, p, message) {
  const now = Date.now()
  // 连续失败时错误帧节流：30s 一次，避免刷屏
  if (now - p.errAt > 30000) {
    p.errAt = now
    broadcast(serverId, { type: 'error', serverId, message })
  }
}

function pushCached(serverId, socket) {
  const p = pollers.get(serverId)
  if (p && p.lastRaw) {
    sendText(socket, JSON.stringify({ type: 'state', serverId, fetchedAt: p.lastAt, raw: p.lastRaw }))
  }
}

function broadcast(serverId, msg) {
  const set = subs.get(serverId)
  if (!set) return
  const text = JSON.stringify(msg)
  for (const s of set) sendText(s, text)
}

function broadcastEvent(serverId, msg) {
  const set = eventSubs.get(serverId)
  if (!set) return
  const text = JSON.stringify(msg)
  for (const s of set) sendText(s, text)
}

function broadcastEventStatus(serverId, connected, message) {
  broadcastEvent(serverId, { type: 'event_status', serverId, connected, message })
}

/** 上游 hello 能力信息推送给订阅该服务器的浏览器；离线时推空（前端显示未知）。 */
function broadcastUpstreamInfo(serverId, hello) {
  broadcast(serverId, {
    type: 'upstream_info',
    serverId,
    version: hello?.version ?? '',
    beta: hello?.beta ?? [],
    tls: hello ? hello.tls === true : null,
    certFingerprint: hello?.certFingerprint ?? null,
  })
}

/** 浏览器订阅时补发缓存的 upstream_info（在首帧 state 之后）。 */
function pushUpstreamInfo(serverId, socket) {
  const up = upstreams.get(serverId)
  if (up && up.ready && up.hello) {
    sendText(socket, JSON.stringify({ type: 'upstream_info', serverId, ...up.hello }))
  }
}

// ================= 控制调用（call/result） =================

async function handleCall(entry, socket, msg) {
  const serverId = String(msg.serverId || '')
  const reqId = String(msg.reqId || '')
  const path = String(msg.path || '')
  const server = deps.findServer(serverId)
  if (!server) {
    sendResult(socket, reqId, serverId, false, 404, '服务器不存在')
    return
  }
  if (!deps.isOwned(entry.user.username, serverId)) {
    sendResult(socket, reqId, serverId, false, 403, '无权操作该服务器')
    return
  }
  // R4 成员角色强制：viewer（只看数据）不可执行控制调用
  if (typeof deps.accessRole === 'function') {
    const role = deps.accessRole(entry.user.username, serverId)
    if (!role || role === 'viewer') {
      sendResult(socket, reqId, serverId, false, 403, '当前成员角色为「只看数据」，无控制权限')
      return
    }
  }
  if (!isAllowedControlPath(path)) {
    sendResult(socket, reqId, serverId, false, 400, '仅支持 /control/* 路径')
    return
  }
  if (!server.apiKey) {
    sendResult(socket, reqId, serverId, false, 403, '该服务器未配置 API Key')
    return
  }

  if (entry.user.role === 'guest' || entry.inFlight >= 16) {
    sendResult(socket, reqId, serverId, false, entry.user.role === 'guest' ? 403 : 429, '无控制权限或并发请求过多'); return
  }
  entry.inFlight++
  try {
    const r = await callForServer(server, path, msg.body)
    sendResult(socket, reqId, serverId, r.ok, r.status, r.message, r.data)
  } finally { entry.inFlight-- }
}

async function httpCall(serverId, path, body) {
  const r = await deps.fetchHttp(serverId, 'POST', path, body !== undefined ? JSON.stringify(body) : undefined)
  if (r.ok) return { ok: true, status: r.status, data: r.data, message: r.data?.message }
  // 传输协商：游戏服返回 404 + data.code=transport_mismatch（鉴权前，不计锁定）
  const code = r.data && r.data.data && r.data.data.code
  const use = r.data && r.data.data && r.data.data.use
  if (r.status === 404 && code === 'transport_mismatch' && use === 'ws') {
    return { ok: false, status: 404, mismatch: 'ws', message: '传输方式不符，已切换 WebSocket' }
  }
  return { ok: false, status: r.status, message: r.message, data: r.data }
}

// ---- 上游 /control 中继 ----

const upstreams = new Map() // serverId -> { socket, ready, calls:Map, buf:Buffer, dead:bool, heartbeat, eventsSubscribed, eventsActive }
// 传输方式记忆（按服务器，进程内）：初始取记录 controlTransport；
// 收到 transport_mismatch 时翻转（该信号在鉴权前返回，不计入失败锁定，翻转重试安全）；
// 连接失败（非 mismatch）时清除记忆以重探测。
const transportMemory = new Map() // serverId -> 'ws' | 'http'
const forbiddenUntil = new Map() // serverId -> 403 冷却截止（不自动重试）
const eventReconnectTimers = new Map() // serverId -> Timeout

function currentMode(server) {
  return transportMemory.get(server.id) ?? (server.controlTransport === 'ws' ? 'ws' : 'http')
}

function syncUpstreamEventSubscription(serverId) {
  if (!eventSubs.has(serverId)) {
    clearTimeout(eventReconnectTimers.get(serverId))
    eventReconnectTimers.delete(serverId)
  }
  const up = upstreams.get(serverId)
  if (!up || up.dead || !up.ready) return
  const wanted = (eventSubs.get(serverId)?.size ?? 0) > 0
  if (up.eventsSubscribed === wanted) {
    if (wanted && up.eventsActive) broadcastEventStatus(serverId, true, '事件流已连接')
    return
  }
  sendUpstream(up, JSON.stringify({ type: wanted ? 'subscribe_events' : 'unsubscribe_events' }))
  up.eventsSubscribed = wanted
  if (!wanted) up.eventsActive = false
}

function scheduleEventReconnect(serverId, delay = UPSTREAM_RECONNECT_MIN_MS) {
  if (!eventSubs.has(serverId) || eventReconnectTimers.has(serverId)) return
  const timer = setTimeout(() => {
    eventReconnectTimers.delete(serverId)
    const server = deps.findServer(serverId)
    if (server && eventSubs.has(serverId)) void ensureEventUpstream(server)
  }, delay)
  eventReconnectTimers.set(serverId, timer)
}

async function ensureEventUpstream(server) {
  if (!eventSubs.has(server.id)) return
  if (!server.apiKey) {
    broadcastEventStatus(server.id, false, '该服务器未配置 API Key')
    return
  }
  if (currentMode(server) !== 'ws') {
    broadcastEventStatus(server.id, false, '事件流仅支持 control_transport: ws')
    return
  }

  const result = await connectUpstream(server.id, server)
  if (result.ok) {
    const timer = eventReconnectTimers.get(server.id)
    if (timer) clearTimeout(timer)
    eventReconnectTimers.delete(server.id)
    syncUpstreamEventSubscription(server.id)
    return
  }

  const message = result.status === 401
    ? '上游鉴权失败（API Key 无效）'
    : result.status === 403
      ? 'API Key 未授权控制 WebSocket 或事件订阅'
    : (result.message || '上游事件流连接失败')
  broadcastEventStatus(server.id, false, message)
  if (result.status === 401 || result.status === 403) scheduleEventReconnect(server.id, FORBIDDEN_COOLDOWN_MS)
  else if (!(result.status === 404 && result.mismatch === 'http')) scheduleEventReconnect(server.id)
}

/** 协商式控制调用：按记忆模式执行；transport_mismatch → 翻转记忆并立即用另一传输重试同一次调用。 */
async function callVia(server, path, body, reqId) {
  const mode = currentMode(server)
  if (mode === 'ws') {
    const r = await wsRelayCall(server, path, body, reqId)
    if (r && r.mismatch === 'http') {
      transportMemory.set(server.id, 'http')
      return httpCall(server.id, path, body)
    }
    return r
  }
  const r = await httpCall(server.id, path, body)
  if (r && r.mismatch === 'ws') {
    transportMemory.set(server.id, 'ws')
    return wsRelayCall(server, path, body, reqId)
  }
  return r
}

async function wsRelayCall(server, path, body, reqId) {
  if ((forbiddenUntil.get(server.id) || 0) > Date.now()) return { ok: false, status: 401, message: '上游鉴权失败，暂缓重试；更新 API Key 后立即生效' }
  const result = await connectUpstream(server.id, server)
  if (!result.ok) {
    if (result.status === 401 || result.status === 403) forbiddenUntil.set(server.id, Date.now() + FORBIDDEN_COOLDOWN_MS)
    return result
  }
  const up = result.up
  if (up.calls.size >= 64) return { ok: false, status: 429, message: '上游控制请求过多' }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      up.calls.delete(reqId)
      resolve({ ok: false, status: 504, message: '控制调用超时，请核实操作结果后再试' })
    }, CALL_TIMEOUT_MS)
    up.calls.set(reqId, { resolve, timer })
    sendUpstream(up, JSON.stringify({ type: 'call', reqId, path, body: body ?? {} }))
  })
}

const connecting = new Map()
async function connectUpstream(serverId, server) {
  const existing = upstreams.get(serverId)
  if (existing && !existing.dead && existing.ready) return { ok: true, up: existing }
  if (connecting.has(serverId)) return connecting.get(serverId).promise
  const attempt = { cancelled: false, promise: null }
  connecting.set(serverId, attempt)
  attempt.promise = openUpstream(serverId, server, attempt).catch(() => ({ ok: false, status: 502, message: '上游连接初始化失败' }))
  try { return await attempt.promise } finally { if (connecting.get(serverId) === attempt) connecting.delete(serverId) }
}

async function openUpstream(serverId, server, attempt) {
  const hostCheck = await deps.resolveServerHost(server)
  if (attempt.cancelled) return { ok: false, status: 409, message: '服务器配置已更新，请重新操作' }
  if (!hostCheck.ok) return { ok: false, status: 403, message: hostCheck.error }
  return new Promise((resolve) => {
    const ip = hostCheck.ips[0]
    const host = ip.includes(':') ? `[${ip}]` : ip
    const ws = new WebSocket(`ws://${host}:${server.port}/control`, {
      headers: { Host: `${server.host}:${server.port}`, Authorization: `Bearer ${server.apiKey}` },
      handshakeTimeout: 8000, maxPayload: 4 * 1024 * 1024, perMessageDeflate: false,
    })
    let settled = false
    const up = { serverId, socket: ws, ready: false, dead: false, calls: new Map(), heartbeat: null, eventsSubscribed: false, eventsActive: false, lastPong: Date.now(), hello: null }
    upstreams.set(serverId, up)
    const timer = setTimeout(() => fail(504, '上游 WebSocket 握手超时'), 10000)
    const finish = (result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result) } }
    const fail = (status, message, mismatch) => {
      finish({ ok: false, status, message, mismatch })
      markDead(serverId, message, up)
    }
    ws.on('error', () => fail(502, '上游 WebSocket 连接失败'))
    ws.on('close', () => fail(502, '上游 WebSocket 已断开，请核实操作结果'))
    ws.on('unexpected-response', (_req, res) => {
      let body = ''
      res.on('data', chunk => { body += chunk; if (body.length > 8192) { res.destroy(); fail(502, '上游握手响应过大') } })
      res.on('error', () => fail(502, '上游握手响应中断'))
      res.on('end', () => {
        let data
        try { data = JSON.parse(body) } catch { /* show status only; never expose an HTML response */ }
        const mismatch = res.statusCode === 404 && data?.data?.code === 'transport_mismatch' && data?.data?.use === 'http' ? 'http' : undefined
        fail(res.statusCode || 502, data?.message || `上游拒绝连接 (HTTP ${res.statusCode})`, mismatch)
      })
    })
    ws.on('message', (raw, binary) => {
      if (binary) return fail(502, '上游协议异常')
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return fail(502, '上游响应不是有效 JSON') }
      if (!msg || typeof msg !== 'object') return fail(502, '上游消息无效')
      if (msg.type === 'hello') {
        up.ready = true
        // 上游 hello 携带的能力信息（SLDataAPI 2.6）：version / beta / tls / cert_fingerprint。
        // 转发给订阅该服务器的浏览器（服务器健康卡展示 + 内测能力提示）。
        up.hello = {
          version: typeof msg.version === 'string' ? msg.version : '',
          beta: Array.isArray(msg.beta) ? msg.beta.filter((x) => typeof x === 'string') : [],
          tls: msg.tls === true,
          certFingerprint: typeof msg.cert_fingerprint === 'string' ? msg.cert_fingerprint : null,
        }
        broadcastUpstreamInfo(serverId, up.hello)
        startUpstreamHeartbeat(up)
        syncUpstreamEventSubscription(serverId)
        finish({ ok: true, up })
      } else if (msg.type === 'pong') up.lastPong = Date.now()
      else if (msg.type === 'events_subscribed') {
        up.eventsActive = true
        broadcastEventStatus(serverId, true, '事件流已连接')
      } else if (msg.type === 'events_unsubscribed') {
        up.eventsActive = false
      } else if (msg.type === 'event') {
        broadcastEvent(serverId, { type: 'event', serverId, event: String(msg.event || 'unknown'), utc: msg.utc, data: msg.data ?? {} })
        // R4：通知规则评估（fire-and-forget，不影响事件转发）
        if (typeof deps.onUpstreamEvent === 'function') {
          try { deps.onUpstreamEvent(serverId, String(msg.event || 'unknown'), msg.data ?? {}) } catch { /* ignore */ }
        }
      } else if (msg.type === 'result' || msg.type === 'error') {
        const pending = up.calls.get(String(msg.reqId))
        if (pending) {
          clearTimeout(pending.timer)
          up.calls.delete(String(msg.reqId))
          pending.resolve({ ok: msg.ok === true && msg.data?.success !== false, status: msg.status || 502, message: msg.message || msg.data?.message, data: msg.data })
        }
      }
    })
  })
}

function markDead(serverId, reason, expected) {
  const up = upstreams.get(serverId)
  if (!up || up.dead || (expected && up !== expected)) return
  up.dead = true
  stopUpstreamHeartbeat(up)
  failPending(up, reason)
  try {
    console.error('[PFC] wsHub 上游断开:', serverId, reason)
  } catch { /* ignore */ }
  try { up.socket.terminate() } catch { /* ignore */ }
  upstreams.delete(serverId)
  // 能力信息随连接失效：推空让前端显示"未知"
  broadcastUpstreamInfo(serverId, null)
  if (eventSubs.has(serverId)) {
    broadcastEventStatus(serverId, false, reason)
    scheduleEventReconnect(serverId)
  }
}

function startUpstreamHeartbeat(up) {
  stopUpstreamHeartbeat(up)
  up.heartbeat = setInterval(() => {
    if (up.dead || !up.ready) return
    if (Date.now() - up.lastPong > 90000) { markDead(up.serverId, '上游心跳超时', up); return }
    sendUpstream(up, JSON.stringify({ type: 'ping' }))
  }, UPSTREAM_HEARTBEAT_MS)
}

function stopUpstreamHeartbeat(up) {
  if (!up?.heartbeat) return
  clearInterval(up.heartbeat)
  up.heartbeat = null
}

function failPending(up, reason) {
  for (const [, p] of up.calls) {
    clearTimeout(p.timer)
    p.resolve({ ok: false, status: 0, message: reason })
  }
  up.calls.clear()
}

function sendResult(socket, reqId, serverId, ok, status, message, data) {
  const msg = { type: 'result', reqId, serverId, ok }
  if (status) msg.status = status
  if (message) msg.message = message
  if (data !== undefined) msg.data = data
  sendText(socket, JSON.stringify(msg))
}

function sendText(socket, text) {
  if (socket.readyState !== WebSocket.OPEN) return
  if (socket.bufferedAmount > 4 * 1024 * 1024) { closeClient(socket); return }
  socket.send(text, error => { if (error) closeClient(socket) })
}

function sendUpstream(up, text) {
  if (up.socket.readyState !== WebSocket.OPEN) { markDead(up.serverId, '上游连接未就绪', up); return }
  up.socket.send(text, error => { if (error) markDead(up.serverId, '上游发送失败', up) })
}

function invalidateServer(serverId) {
  const attempt = connecting.get(serverId)
  if (attempt) attempt.cancelled = true
  connecting.delete(serverId)
  const timer = eventReconnectTimers.get(serverId)
  if (timer) clearTimeout(timer)
  eventReconnectTimers.delete(serverId)
  transportMemory.delete(serverId)
  forbiddenUntil.delete(serverId)
  markDead(serverId, '服务器配置已更新')
  stopPoller(serverId)
  if (subs.has(serverId)) ensurePoller(serverId)
}

function shutdown() {
  for (const attempt of connecting.values()) attempt.cancelled = true
  connecting.clear()
  clearInterval(clientSweep)
  for (const socket of [...clients.keys()]) closeClient(socket)
  for (const timer of eventReconnectTimers.values()) clearTimeout(timer)
  eventReconnectTimers.clear()
  for (const id of [...upstreams.keys()]) markDead(id, '平台服务关闭')
  for (const id of [...pollers.keys()]) stopPoller(id)
  wss.close()
}

module.exports = { init, attach, callForServer, invalidateServer, shutdown }

/**
 * 供平台端（/api/sl/call、历史 HTTP 代理分支）调用的协商式控制执行：
 * 返回 { ok, status, message, data }（data = 游戏服完整响应体 {success,message,data}）。
 * 两种传输（HTTP/WS）自动协商翻转，与 WS 枢纽共用记忆。
 * 注意：必须生成连接内唯一的 reqId —— 否则上游 result 无法匹配 pending，调用悬空超时。
 */
async function callForServer(server, path, body) {
  if (!isAllowedControlPath(path)) return { ok: false, status: 400, message: '控制路径无效' }
  if (!server.apiKey) return { ok: false, status: 403, message: '该服务器未配置 API Key' }
  const reqId = crypto.randomUUID()
  return callVia(server, path, body, reqId)
}
