import { useEffect, useRef, useState } from 'react'
import { Radio, Volume2, VolumeX } from 'lucide-react'
import PageStub from '@/components/PageStub'
import ControlNotice from '@/components/ControlNotice'
import { useT } from '@/i18n'
import { useServerQuery } from '@/hooks/useServerQuery'
import { useServersStore } from '@/store/serversStore'
import { parseSteamId } from '@/utils/steamId'
import type { SlPlayer } from '@/types/api'

/** 频道枚举 → 显示名（与 SLDataAPI VoiceChatChannel 一致；图例只展示 4 个常用频道）。 */
const CHANNEL_NAMES: Record<number, string> = {
  0: '无', 1: '常规讲话', 2: '对讲机', 3: 'SCP频道', 4: '旁观者',
  5: '回合总结', 6: '全局广播', 7: '模仿', 8: 'SCP-1576', 9: '大厅', 10: 'SCP-1507',
}

/** 图例展示的频道（常规讲话 / 对讲机 / 旁观者 / 全局广播）。 */
const LEGEND_CHANNELS = [1, 2, 4, 6]

/** 说话者信息（WS speaker 帧）。 */
interface SpeakerInfo {
  nickname: string
  role?: string
  userid?: string
  channel: number
  playerid: number
}

/** 当前正在说话的状态（多频道用 / 合并）。 */
interface ActiveSpeaker {
  nickname: string
  /** SteamId（来自 speaker 帧 userid），角色从 /get_sl_data 的玩家列表按此匹配。 */
  steamId: string
  channels: number[]
  lastSeen: number
}

export default function Voice() {
  const t = useT()
  const { data: serverData } = useServerQuery()
  const servers = useServersStore((s) => s.servers)
  const active = useServersStore((s) => s.activeId)
  const activeServer = servers.find((s) => s.id === active) ?? servers[0]

  const [listening, setListening] = useState(false)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [speakers, setSpeakers] = useState<Map<string, ActiveSpeaker>>(new Map())
  const [muted, setMuted] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  // 语音端口：从 /get_sl_data 的 voicePort 读（SLDataAPI 启用语音时非 0）
  const voicePort = serverData?.voicePort ?? 0
  const enabled = voicePort > 0

  // 1.5s 无新包 = 停止说话（超时清理）
  useEffect(() => {
    if (!listening) return
    const timer = setInterval(() => {
      setSpeakers((prev) => {
        const now = Date.now()
        let changed = false
        const next = new Map(prev)
        for (const [k, v] of next) {
          if (now - v.lastSeen > 1500) { next.delete(k); changed = true }
        }
        return changed ? next : prev
      })
    }, 500)
    return () => clearInterval(timer)
  }, [listening])

  // WebSocket 生命周期
  useEffect(() => {
    if (!listening || !activeServer || !enabled) return

    const wsUrl = new URL('/api/sl/voice', location.origin)
    wsUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    wsUrl.searchParams.set('target', `${activeServer.host}:${activeServer.port}`)
    wsUrl.searchParams.set('voice_port', String(voicePort))

    let ws: WebSocket
    try {
      ws = new WebSocket(wsUrl.toString())
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return
    }

    ws.onopen = () => {
      setConnected(true)
      setError(null)
      // 初始化 AudioContext（用户手势后）
      if (!audioCtxRef.current) {
        try {
          audioCtxRef.current = new AudioContext({ sampleRate: 48000 })
        } catch { /* 浏览器限制，稍后重试 */ }
      }
    }

    ws.onclose = () => {
      setConnected(false)
      setSpeakers(new Map())
      if (wsRef.current === ws) wsRef.current = null
    }

    ws.onerror = () => {
      setError(t('voice.connectFailed'))
    }

    ws.onmessage = (ev) => {
      const data = ev.data
      if (typeof data === 'string') {
        // JSON 帧：speaker 信息 / hello
        try {
          const msg = JSON.parse(data)
          if (msg.type === 'speaker') {
            const info = msg as SpeakerInfo
            setSpeakers((prev) => {
              const next = new Map(prev)
              const key = String(info.playerid)
              const existing = next.get(key)
              const channels = existing?.channels ?? []
              if (!channels.includes(info.channel)) channels.push(info.channel)
              next.set(key, {
                nickname: info.nickname,
                // userid 形如 "76561198...@steam"（也有 @northwood/假人）：剥后缀，非 Steam ID 置空
                steamId: parseSteamId(info.userid) ?? '',
                channels,
                lastSeen: Date.now(),
              })
              return next
            })
          }
          if (msg.type === 'error') setError(msg.error || t('voice.connectFailed'))
        } catch { /* 非 JSON 文本帧忽略 */ }
        return
      }

      // 二进制语音帧: [0]=0x01 [1]=channel [2-3]=playerId(LE) [4-7]=seq [8..]=float32 PCM 48kHz mono
      if (data instanceof ArrayBuffer && data.byteLength > 8 && !muted) {
        const buf = new Uint8Array(data)
        const samples = new Float32Array(data.slice(8))
        // 标记说话（按 playerid 更新 lastSeen）
        const playerId = buf[2] | (buf[3] << 8)
        setSpeakers((prev) => {
          const next = new Map(prev)
          const existing = next.get(String(playerId))
          if (existing) next.set(String(playerId), { ...existing, lastSeen: Date.now() })
          return next
        })
        enqueuePcm(samples)
      }
    }

    return () => {
      wsRef.current = null
      try { ws.close() } catch { /* ignore */ }
      setConnected(false)
      setSpeakers(new Map())
      // 清理音频队列和待播放状态
      pcmQueueRef.current = []
      nextPlayTimeRef.current = 0
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
    }
  }, [listening, activeServer?.id, enabled, voicePort])

  /**
   * 音频调度队列：把连续 PCM 包累积成 ~200ms 的块，按 AudioContext 时间轴
   * 无缝排程播放。每个 20ms 包都直接 start() 一个 BufferSource 会因为
   * 浏览器调度抖动产生断续（"听起来卡顿"的根因）。
   */
  const pcmQueueRef = useRef<Float32Array[]>([])
  const nextPlayTimeRef = useRef(0)
  const flushTimerRef = useRef<number | null>(null)

  function flushQueue() {
    const actx = audioCtxRef.current
    const queue = pcmQueueRef.current
    if (!actx || queue.length === 0) return
    // 合并队列里所有包
    const total = queue.reduce((n, s) => n + s.length, 0)
    const merged = new Float32Array(total)
    let off = 0
    for (const s of queue) { merged.set(s, off); off += s.length }
    queue.length = 0

    const now = actx.currentTime
    if (nextPlayTimeRef.current < now) nextPlayTimeRef.current = now + 0.03 // 30ms 延迟余量
    try {
      const buffer = actx.createBuffer(1, merged.length, 48000)
      buffer.copyToChannel(merged, 0)
      const src = actx.createBufferSource()
      src.buffer = buffer
      src.connect(actx.destination)
      src.start(nextPlayTimeRef.current)
      nextPlayTimeRef.current += merged.length / 48000
    } catch { /* 播放失败忽略 */ }
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
  }

  function enqueuePcm(samples: Float32Array) {
    const ctx = audioCtxRef.current
    if (!ctx) {
      try {
        audioCtxRef.current = new AudioContext({ sampleRate: 48000 })
      } catch { return }
    }
    const actx = audioCtxRef.current
    if (!actx) return
    if (actx.state === 'suspended') {
      actx.resume().catch(() => undefined)
    }
    pcmQueueRef.current.push(samples)
    // 200ms 或首次包立即刷新（避免引入过多延迟）
    const queueDur = pcmQueueRef.current.reduce((n, s) => n + s.length, 0) / 48000
    if (queueDur >= 0.2 || flushTimerRef.current === null) {
      if (flushTimerRef.current === null) {
        // 首次：给 40ms 让更多包进来，减少碎块
        flushTimerRef.current = window.setTimeout(() => {
          flushTimerRef.current = null
          flushQueue()
        }, 40)
      } else {
        flushQueue()
      }
    }
  }

  const channelLabel = (channels: number[]) =>
    channels.length === 0 ? '' : channels.map((c) => CHANNEL_NAMES[c] ?? `#${c}`).join(' / ')

  return (
    <PageStub code="M-09" title={t('nav.voice')}>
      <div className="flex h-full flex-col space-y-3">
        <ControlNotice show={!activeServer?.controlEnabled} />

        {/* 状态头 */}
        <div className="flex flex-wrap items-center gap-3 border border-ink-border bg-ink-deep px-4 py-3">
          <Radio size={14} className={connected ? 'text-scp-safe' : 'text-ink-mute'} />
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-mute">
            {t('voice.title')}
          </span>
          <span className={`font-mono text-[10px] ${connected ? 'text-scp-safe' : 'text-ink-mute'}`}>
            {connected ? t('voice.connected') : t('voice.disconnected')}
          </span>
          {!enabled && (
            <span className="font-mono text-[10px] text-scp-err">
              // {t('voice.notEnabled')}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => setListening((v) => !v)}
              disabled={!enabled}
              className="border border-ink-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-foreground transition-colors hover:border-inverse disabled:opacity-40"
            >
              {listening ? t('voice.stop') : t('voice.start')}
            </button>
            <button
              onClick={() => setMuted((v) => !v)}
              disabled={!listening}
              title={t('voice.mute')}
              aria-label={t('voice.mute')}
              aria-pressed={muted}
              className="border border-ink-border p-1.5 text-ink-mute transition-colors hover:border-inverse hover:text-foreground disabled:opacity-40"
            >
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          </div>
        </div>

        {error && (
          <div className="border border-scp-err/40 bg-scp-err/10 px-3 py-2 font-mono text-[11px] text-scp-err">
            ✗ {error}
          </div>
        )}

        {/* 正在说话 */}
        <div className="border border-ink-border bg-ink-deep p-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
            {t('voice.speaking')} — {speakers.size}
          </span>
          <div className="mt-3 space-y-1.5">
            {listening && speakers.size === 0 && (
              <p className="font-mono text-[10px] text-ink-mute">// {t('voice.empty')}</p>
            )}
            {!listening && (
              <p className="font-mono text-[10px] text-ink-mute">// {t('voice.hint')}</p>
            )}
            {[...speakers.values()].map((s) => {
              // 角色从 /get_sl_data 的玩家列表按 steamId 匹配（实时角色，接口数据）
              const player = (serverData?.players ?? []).find((p) => p.steamId === s.steamId)
              return (
                <div
                  key={s.nickname}
                  className="flex items-center gap-3 border-b border-ink-border/60 py-1.5"
                >
                  <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-scp-safe" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                    {s.nickname}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-ink-mute">
                    {player?.role || '—'}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-scp-safe">
                    {channelLabel(s.channels)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* 频道图例 */}
        <div className="border border-ink-border bg-ink-deep p-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
            {t('voice.channels')}
          </span>
          <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {LEGEND_CHANNELS.map((k) => (
              <div key={k} className="flex items-center gap-2 font-mono text-[10px] text-ink-mute">
                <span className="inline-block h-2 w-2 border border-scp-safe/50" />
                {CHANNEL_NAMES[k]}
              </div>
            ))}
          </div>
        </div>

        {/* 在线玩家（参考） */}
        <div className="border border-ink-border bg-ink-deep p-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
            {t('voice.onlinePlayers')}
          </span>
          <div className="mt-3 max-h-40 space-y-1 overflow-auto">
            {(serverData?.players ?? []).map((p: SlPlayer) => (
              <div key={p.nickname} className="flex items-center gap-3 border-b border-ink-border/60 py-1">
                <span className="truncate font-mono text-[10px] text-foreground">{p.nickname}</span>
                <span className="ml-auto shrink-0 font-mono text-[9px] text-ink-mute">{p.role}</span>
              </div>
            ))}
            {(serverData?.players ?? []).length === 0 && (
              <p className="font-mono text-[10px] text-ink-mute">// {t('players.empty')}</p>
            )}
          </div>
        </div>
      </div>
    </PageStub>
  )
}
