import { useEffect, useMemo, useState } from 'react'
import { Activity, CirclePause, CirclePlay, Radio, Trash2 } from 'lucide-react'
import PageStub from '@/components/PageStub'
import ControlNotice from '@/components/ControlNotice'
import { useT } from '@/i18n'
import type { TKey } from '@/i18n/dict'
import { useI18nStore } from '@/i18n/store'
import { useControlSource } from '@/hooks/useControl'
import { wsHub } from '@/ws/hub'
import { useWsEventsStore, type SlServerEvent } from '@/ws/eventsStore'

/**
 * SLDataAPI WsEventBridge 实际推送的事件（对齐 SLDataAPI main bb002dd）。
 * 上游不推送 player_joined/player_left 等旧占位事件名。
 */
const EVENT_LABEL_KEYS: Record<string, TKey> = {
  player_banned: 'events.playerBanned',
  player_kicked: 'events.playerKicked',
  player_escaped: 'events.playerEscaped',
  player_role_changed: 'events.playerRoleChanged',
  player_reported: 'events.playerReported',
  wave_respawned: 'events.waveRespawned',
  decontamination_started: 'events.decontaminationStarted',
  generator_activated: 'events.generatorActivated',
  scp_terminated: 'events.scpTerminated',
  warhead_started: 'events.warheadStarted',
  warhead_stopped: 'events.warheadStopped',
  warhead_detonated: 'events.warheadDetonated',
}

const EMPTY_EVENTS: SlServerEvent[] = []

function text(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  return value === null || value === undefined || value === '' ? '—' : String(value)
}

/** {name} 占位填充（未提供的占位保留原样，便于发现字段缺失）。 */
function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => params[k] ?? m)
}

function eventSummary(event: SlServerEvent, t: (key: TKey) => string): string {
  const d = event.data
  const who = text(d, 'nickname')
  switch (event.event) {
    case 'player_banned':
      return `${who} ${fill(t('events.bannedSuffix'), { issuer: text(d, 'issuer_nickname') })}`
    case 'player_kicked':
      return `${who} ${fill(t('events.kickedSuffix'), { issuer: text(d, 'issuer_nickname') })}`
    case 'player_escaped':
      return `${who} ${fill(t('events.escapedSuffix'), {
        old: text(d, 'old_role'), new: text(d, 'new_role'), scenario: text(d, 'scenario'),
      })}`
    case 'player_role_changed':
      return `${who} ${fill(t('events.roleChangedSuffix'), { old: text(d, 'old_role'), new: text(d, 'new_role') })}`
    case 'player_reported':
      return fill(t('events.reportedSuffix'), {
        reporter: text(d, 'reporter_nickname'), target: text(d, 'target_nickname'),
      })
    case 'wave_respawned':
      return fill(t('events.waveSummary'), { team: text(d, 'team') || text(d, 'faction'), count: text(d, 'count') })
    case 'decontamination_started':
      return t('events.deconSummary')
    case 'generator_activated':
      return `${fill(t('events.generatorSummary'), { engaged: text(d, 'engaged'), total: text(d, 'total') })}${text(d, 'room') !== '—' ? ` · ${text(d, 'room')}` : ''}`
    case 'scp_terminated':
      return fill(t('events.scpTerminatedSuffix'), { nickname: who })
    case 'warhead_started':
      return t('events.warheadStartedSummary')
    case 'warhead_stopped':
      return t('events.warheadStoppedSummary')
    case 'warhead_detonated':
      return t('events.warheadDetonatedSummary')
    default:
      return event.event
  }
}

function formatEventTime(value: string, lang: 'zh-CN' | 'en'): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(lang === 'zh-CN' ? 'zh-CN' : 'en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date)
}

export default function Events() {
  const t = useT()
  const lang = useI18nStore((state) => state.lang)
  const { server, tokenConfigured } = useControlSource()
  const events = useWsEventsStore((state) => server ? (state.byServer[server.id] ?? EMPTY_EVENTS) : EMPTY_EVENTS)
  const status = useWsEventsStore((state) => server ? state.statusByServer[server.id] : undefined)
  const clear = useWsEventsStore((state) => state.clear)
  const [live, setLive] = useState(true)
  const [filter, setFilter] = useState('all')

  const wsConfigured = server?.controlTransport === 'ws'
  const canStream = !!server && tokenConfigured && wsConfigured

  useEffect(() => {
    if (!server || !canStream || !live) return
    wsHub.addEventWant(server.id)
    return () => wsHub.removeEventWant(server.id)
  }, [server, canStream, live])

  const availableTypes = useMemo(
    () => [...new Set([...Object.keys(EVENT_LABEL_KEYS), ...events.map((event) => event.event)])],
    [events],
  )
  const visibleEvents = filter === 'all' ? events : events.filter((event) => event.event === filter)
  const statusState = live && canStream ? (status?.state ?? 'connecting') : 'idle'
  const statusClass = statusState === 'connected'
    ? 'bg-scp-safe'
    : statusState === 'connecting'
      ? 'bg-scp-warn animate-pulse'
      : 'bg-ink-mute'

  return (
    <PageStub code="M-16" title={t('nav.events')}>
      <div className="flex h-full flex-col gap-3">
        <ControlNotice show={!tokenConfigured} />

        {server && tokenConfigured && !wsConfigured && (
          <div className="border border-scp-warn/40 bg-scp-warn/5 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-scp-warn">
            {t('events.wsOnly')}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border border-ink-border bg-ink-deep px-3 py-2.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusClass}`} />
          <span className="font-mono text-[10px] uppercase tracking-wider text-foreground">
            {statusState === 'connected'
              ? t('events.connected')
              : statusState === 'connecting'
                ? t('events.connecting')
                : statusState === 'disconnected'
                  ? t('events.disconnected')
                  : t('events.paused')}
          </span>
          {statusState !== 'idle' && status?.message && (
            <span className="font-mono text-[10px] text-ink-mute">· {status.message}</span>
          )}

          <div className="min-w-4 flex-1" />

          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="border border-ink-border bg-ink px-2 py-1.5 font-mono text-[10px] text-foreground focus:border-inverse focus:outline-none"
          >
            <option value="all">{t('events.all')}</option>
            {availableTypes.map((eventType) => (
              <option key={eventType} value={eventType}>
                {EVENT_LABEL_KEYS[eventType] ? t(EVENT_LABEL_KEYS[eventType]) : eventType}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setLive((value) => !value)}
            disabled={!canStream}
            className="flex items-center gap-1.5 border border-ink-border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground disabled:opacity-40"
          >
            {live ? <CirclePause size={12} /> : <CirclePlay size={12} />}
            {live ? t('events.pause') : t('events.resume')}
          </button>

          <button
            type="button"
            onClick={() => server && clear(server.id)}
            disabled={!server || events.length === 0}
            className="flex items-center gap-1.5 border border-ink-border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-scp-err hover:text-scp-err disabled:opacity-40"
          >
            <Trash2 size={12} /> {t('events.clear')}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto border border-ink-border bg-ink-deep" aria-live="polite">
          {visibleEvents.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-2 p-6 text-center">
              {statusState === 'connected' ? <Activity size={20} className="text-scp-safe" /> : <Radio size={20} className="text-ink-mute" />}
              <p className="font-mono text-[11px] text-foreground">
                {canStream ? t('events.empty') : t('events.unavailable')}
              </p>
              <p className="max-w-[64ch] font-mono text-[10px] leading-relaxed text-ink-mute">
                {t('events.emptyHint')}
              </p>
            </div>
          ) : (
            visibleEvents.map((event) => (
              <article
                key={event.id}
                className="grid gap-2 border-b border-ink-border px-3 py-2.5 last:border-b-0 sm:grid-cols-[90px_150px_minmax(0,1fr)] sm:items-start"
              >
                <time className="font-mono text-[10px] text-ink-mute" dateTime={event.utc}>
                  {formatEventTime(event.utc, lang)}
                </time>
                <span className="font-mono text-[10px] uppercase tracking-wider text-scp-safe">
                  {EVENT_LABEL_KEYS[event.event] ? t(EVENT_LABEL_KEYS[event.event]) : event.event}
                </span>
                <div className="min-w-0">
                  <p className="break-words text-[12px] leading-relaxed text-foreground">{eventSummary(event, t)}</p>
                  <p className="mt-1 break-all font-mono text-[9px] leading-relaxed text-ink-mute">
                    {Object.entries(event.data).map(([key, value]) => `${key}=${String(value)}`).join(' · ')}
                  </p>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </PageStub>
  )
}
