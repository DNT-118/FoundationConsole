/**
 * 浏览器 ↔ 平台 的 WS 控制枢纽客户端（协议见 docs/ws-control-design.md）。
 * - 数据：订阅服务器后平台聚合轮询并通过 state 帧推送（写入 useWsStateStore）
 * - 控制：call(serverId, path, body) → result，reqId 关联 + 25s 超时
 * - 降级：连接不可用（失败超限）时 hub 标记 unavailable，各 hook 回退 HTTP 轮询，
 *   并每 60s 重试恢复推送模式
 */
import { create } from 'zustand'
import { useAuthStore } from '@/store/authStore'
import { useWsStateStore } from '@/ws/stateStore'
import { useWsEventsStore } from '@/ws/eventsStore'
import { ApiError } from '@/api/request'
import type { ControlResult } from '@/types/api'

/** hub 可用性状态（响应式：unavailable 翻转时驱动各 hook 回退/恢复）。 */
export const useHubStatus = create<{ usable: boolean; setUsable: (v: boolean) => void }>()((set) => ({
  usable: true,
  setUsable: (v) => set({ usable: v }),
}))

type ResultMessage = {
  type: 'result'
  reqId: string
  serverId: string
  ok: boolean
  status?: number
  message?: string
  data?: unknown
}

interface PendingCall {
  resolve: (r: ControlResult) => void
  reject: (e: Error) => void
  timer: number
}

const MAX_BACKOFF_MS = 30000
const RETRY_UNAVAILABLE_MS = 60000
const MAX_UNAVAILABLE_STRIKES = 3

class WsHub {
  private ws: WebSocket | null = null
  private ready = false
  private unavailable = false
  private backoff = 1000
  private strikes = 0
  private reconnectTimer: number | null = null
  private retryUnavailableTimer: number | null = null
  private heartbeatTimer: number | null = null
  private seq = 0
  private pending = new Map<string, PendingCall>()
  /** 连接建立前的调用排队（onopen 后冲刷），避免控制台等页面首次调用时直接回退 HTTP */
  private openQueue = new Map<string, () => void>()
  /** 订阅集合（含引用计数，多个 hook 可同时订阅同一台服务器） */
  private wants = new Map<string, number>()
  /** 事件流订阅与数据状态订阅相互独立；只有事件页挂载时才占用上游事件流。 */
  private eventWants = new Map<string, number>()

  isUsable(): boolean {
    return !this.unavailable
  }

  private wsUrl(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}/api/sl/ws`
  }

  /** 订阅需求登记（引用计数）。变化后全量下发 subscribe。 */
  addWant(serverId: string) {
    this.wants.set(serverId, (this.wants.get(serverId) ?? 0) + 1)
    this.pushSubscribe()
  }

  removeWant(serverId: string) {
    const n = (this.wants.get(serverId) ?? 1) - 1
    if (n <= 0) this.wants.delete(serverId)
    else this.wants.set(serverId, n)
    this.pushSubscribe()
  }

  /** 概览一次性批量订阅（与单订阅共用 refcount）。 */
  addWants(ids: string[]) {
    for (const id of ids) this.wants.set(id, (this.wants.get(id) ?? 0) + 1)
    this.pushSubscribe()
  }

  removeWants(ids: string[]) {
    for (const id of ids) {
      const n = (this.wants.get(id) ?? 1) - 1
      if (n <= 0) this.wants.delete(id)
      else this.wants.set(id, n)
    }
    this.pushSubscribe()
  }

  addEventWant(serverId: string) {
    this.eventWants.set(serverId, (this.eventWants.get(serverId) ?? 0) + 1)
    useWsEventsStore.getState().setStatus(serverId, 'connecting', '正在连接事件流')
    this.ensureConnected()
    this.pushEventSubscribe()
  }

  removeEventWant(serverId: string) {
    const n = (this.eventWants.get(serverId) ?? 1) - 1
    if (n <= 0) {
      this.eventWants.delete(serverId)
      useWsEventsStore.getState().setStatus(serverId, 'idle')
    } else {
      this.eventWants.set(serverId, n)
    }
    this.pushEventSubscribe()
  }

  private pushSubscribe() {
    if (!this.ready) return
    try {
      this.ws?.send(JSON.stringify({ type: 'subscribe', serverIds: [...this.wants.keys()] }))
    } catch { /* ignore */ }
  }

  private pushEventSubscribe() {
    if (!this.ready) return
    try {
      this.ws?.send(JSON.stringify({ type: 'subscribe_events', serverIds: [...this.eventWants.keys()] }))
    } catch { /* ignore */ }
  }

  ensureConnected() {
    const session = useAuthStore.getState().session
    if (!session) return
    if (this.ws || this.unavailable || this.reconnectTimer !== null) return
    this.open()
  }

  private open() {
    try {
      this.ws = new WebSocket(this.wsUrl())
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws.onopen = () => {
      this.ready = true
      this.backoff = 1000
      this.strikes = 0
      useHubStatus.getState().setUsable(true)
      this.pushSubscribe()
      this.pushEventSubscribe()
      this.startHeartbeat()
      // 冲刷连接建立前排队的调用
      const q = [...this.openQueue.values()]
      this.openQueue.clear()
      for (const fn of q) fn()
    }
    this.ws.onmessage = (ev) => this.handleMessage(ev.data)
    this.ws.onclose = () => {
      this.ready = false
      this.ws = null
      this.stopHeartbeat()
      this.failAllPending('连接已断开')
      for (const serverId of this.eventWants.keys()) {
        useWsEventsStore.getState().setStatus(serverId, 'disconnected', '平台 WebSocket 已断开')
      }
      this.scheduleReconnect()
    }
    this.ws.onerror = () => { /* onclose 统一处理 */ }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null || this.unavailable || !useAuthStore.getState().session) return
    this.strikes += 1
    if (this.strikes >= MAX_UNAVAILABLE_STRIKES) {
      // 连续失败：进入 HTTP 回退模式，60s 后再试探
      this.unavailable = true
      useHubStatus.getState().setUsable(false)
      this.backoff = MAX_BACKOFF_MS
      if (this.retryUnavailableTimer === null) {
        this.retryUnavailableTimer = window.setTimeout(() => {
          this.retryUnavailableTimer = null
          this.unavailable = false
          this.strikes = 0
          this.ensureConnected()
        }, RETRY_UNAVAILABLE_MS)
      }
      return
    }
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, this.backoff)
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS)
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = window.setInterval(() => {
      try { this.ws?.send(JSON.stringify({ type: 'ping' })) } catch { /* ignore */ }
    }, 25000)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private handleMessage(raw: unknown) {
    if (typeof raw !== 'string') return
    let msg: { type?: string } & Record<string, unknown>
    try { msg = JSON.parse(raw) } catch { return }

    switch (msg.type) {
      case 'state': {
        const serverId = String(msg.serverId ?? '')
        useWsStateStore.getState().applyState(serverId, msg.raw)
        break
      }
      case 'error': {
        const serverId = String(msg.serverId ?? '')
        useWsStateStore.getState().applyError(serverId, String(msg.message ?? '不可达'))
        break
      }
      case 'result': {
        const m = msg as unknown as ResultMessage
        const p = this.pending.get(m.reqId)
        if (p) {
          clearTimeout(p.timer)
          this.pending.delete(m.reqId)
          // 上游 WS 的 data 是 HTTP 响应体（{success,message,data}），
          // 解包一层内层 data，与 HTTP 控制路径的 ControlResult.data 形状对齐
          const rawData = m.ok ? m.data : undefined
          const inner = rawData && typeof rawData === 'object' && 'data' in rawData
            ? (rawData as { data?: unknown }).data
            : rawData
          if (!m.ok) { p.reject(new ApiError(m.message || `上游返回 HTTP ${m.status ?? 0}`, m.status)); break }
          p.resolve({
            success: m.ok && !(rawData && typeof rawData === 'object' && 'success' in rawData && rawData.success === false),
            message: m.message || (rawData && typeof rawData === 'object' && 'message' in rawData ? String(rawData.message) : '') || (m.ok ? '' : `上游返回 HTTP ${m.status ?? 0}`),
            data: m.ok ? inner : undefined,
            // 保留上游 HTTP 状态：业务失败（success=false）时 useControl 据此映射错误码
            status: m.status,
          })
        }
        break
      }
      case 'event': {
        const serverId = String(msg.serverId ?? '')
        if (!serverId) break
        useWsEventsStore.getState().append({
          serverId,
          event: String(msg.event ?? 'unknown'),
          utc: typeof msg.utc === 'string' ? msg.utc : new Date().toISOString(),
          data: msg.data && typeof msg.data === 'object'
            ? msg.data as Record<string, unknown>
            : {},
        })
        break
      }
      case 'event_status': {
        const serverId = String(msg.serverId ?? '')
        if (!serverId) break
        useWsEventsStore.getState().setStatus(
          serverId,
          msg.connected === true ? 'connected' : 'disconnected',
          typeof msg.message === 'string' ? msg.message : undefined,
        )
        break
      }
      case 'auth_error': {
        this.unavailable = true
        useHubStatus.getState().setUsable(false)
        try { this.ws?.close() } catch { /* ignore */ }
        break
      }
      case 'pong':
      case 'hello':
        break
      default:
        break
    }
  }

  private failAllPending(reason: string) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error(reason))
    }
    this.pending.clear()
    this.openQueue.clear()
  }

  /** 控制调用（reqId 关联，25s 超时）。hub 不可用时抛错由调用方回退 HTTP。 */
  call(serverId: string, path: string, body?: unknown, signal?: AbortSignal): Promise<ControlResult> {
    if (signal?.aborted) return Promise.reject(signal.reason)
    if (this.unavailable) return Promise.reject(new ApiError('WS 通道不可用'))
    this.ensureConnected()
    const reqId = `c_${Date.now()}_${this.seq++}`
    return new Promise<ControlResult>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        this.pending.delete(reqId)
        this.openQueue.delete(reqId)
        signal?.removeEventListener('abort', abort)
      }
      const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException('已取消', 'AbortError')) }
      const timer = window.setTimeout(() => {
        cleanup()
        reject(new ApiError('控制调用超时，请核实操作结果后再试'))
      }, 45000)
      this.pending.set(reqId, {
        resolve: result => { cleanup(); resolve(result) },
        reject: error => { cleanup(); reject(error) },
        timer,
      })
      signal?.addEventListener('abort', abort, { once: true })
      const sendNow = () => {
        if (!this.pending.has(reqId)) return
        if (!this.ready || !this.ws) { cleanup(); reject(new ApiError('连接尚未就绪')); return }
        try { this.ws.send(JSON.stringify({ type: 'call', reqId, serverId, path, body: body ?? {} })) }
        catch { cleanup(); reject(new ApiError('发送失败，请核实操作结果后再试')) }
      }
      if (this.ready && this.ws) sendNow()
      else this.openQueue.set(reqId, sendNow)
    })
  }

  /** 登出时清理（authStore 变化由调用方触发）。 */
  disconnect() {
    this.stopHeartbeat()
    if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.retryUnavailableTimer !== null) { clearTimeout(this.retryUnavailableTimer); this.retryUnavailableTimer = null }
    this.ready = false
    this.wants.clear()
    this.eventWants.clear()
    this.failAllPending('已登出')
    if (this.ws) { this.ws.onclose = null; this.ws.onmessage = null; this.ws.onopen = null; this.ws.close() }
    this.ws = null
    this.unavailable = false
    useHubStatus.getState().setUsable(true)
    useWsEventsStore.getState().reset()
    useWsStateStore.getState().reset()
  }
}

export const wsHub = new WsHub()

// 登出时断开并清空订阅
useAuthStore.subscribe((state, prev) => {
  if (prev?.session && !state.session) wsHub.disconnect()
})
