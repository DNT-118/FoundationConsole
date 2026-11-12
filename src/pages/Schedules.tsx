/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
/**
 * 定时任务（R4）：按服务器配置定时广播 / CASSIE / 控制台命令（仅 SLDataAPI 已有控制端点）。
 * 创建/修改需 owner/manager（服务端强制）；执行走平台控制中继（注入 API Key）；
 * 服务重启后按 lastRunAt 恢复节奏；执行记录滚动保留 20 条，可暂停。
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, Loader2, Trash2, Play, Pause, History } from 'lucide-react'
import PageStub from '@/components/PageStub'
import { useT } from '@/i18n'
import { api } from '@/api/platform'
import { useServersStore, serverLabel } from '@/store/serversStore'
import { describeControlError } from '@/utils/controlHint'
import type { ScheduleTask } from '@/types/api'

const INTERVALS: [number, string][] = [
  [300, '5min'], [600, '10min'], [1800, '30min'], [3600, '1h'], [21600, '6h'], [86400, '24h'],
]

type Kind = 'broadcast' | 'cassie' | 'console'

function fmtTime(ts: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}

function payloadSummary(t: ReturnType<typeof useT>, kind: Kind, p: Record<string, unknown>): string {
  if (kind === 'broadcast') return `${t('schedule.kind.broadcast')} · "${String(p.message ?? '')}" · ${String(p.duration_seconds ?? 5)}s`
  if (kind === 'cassie') return `${t('schedule.kind.cassie')} · "${String(p.message ?? '')}"`
  return `${t('schedule.kind.console')} · ${String(p.command ?? '')}`
}

export default function Schedules() {
  const t = useT()
  const servers = useServersStore((s) => s.servers)
  const queryClient = useQueryClient()
  const [newServerId, setNewServerId] = useState('')
  const [kind, setKind] = useState<Kind>('broadcast')
  const [message, setMessage] = useState('')
  const [translation, setTranslation] = useState('')
  const [duration, setDuration] = useState(5)
  const [clearPrev, setClearPrev] = useState(false)
  const [intervalSeconds, setIntervalSeconds] = useState(1800)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [runsOpen, setRunsOpen] = useState<string | null>(null)

  const schedulesQuery = useQuery({
    queryKey: ['schedules'],
    queryFn: async () => (await api<{ schedules: ScheduleTask[] }>('/schedules')).schedules,
    refetchInterval: 30_000,
  })
  const schedules = schedulesQuery.data ?? []
  const manageable = servers.filter((s) => s.role === 'owner' || s.role === 'manager')

  async function create() {
    setBusy(true)
    setMsg(null)
    try {
      const payload = kind === 'broadcast'
        ? { message: message.trim(), duration_seconds: duration, clear_previous: clearPrev }
        : kind === 'cassie'
          ? { message: message.trim(), ...(translation.trim() ? { translation: translation.trim() } : {}) }
          : { command: message.trim() }
      await api('/schedules', {
        method: 'POST',
        body: { serverId: newServerId || manageable[0]?.id, kind, payload, intervalSeconds },
      })
      setMessage('')
      setTranslation('')
      await queryClient.invalidateQueries({ queryKey: ['schedules'] })
      setMsg({ ok: true, text: '✓' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  async function mutate(fn: () => Promise<unknown>) {
    setMsg(null)
    try { await fn(); await queryClient.invalidateQueries({ queryKey: ['schedules'] }) } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
  }

  const serverById = (id: string) => servers.find((s) => s.id === id)

  return (
    <PageStub code="M-18" title={t('nav.schedules')}>
      <div className="grid grid-cols-12 gap-3">
        {/* 创建 */}
        <section className="col-span-12 xl:col-span-4">
          <div className="border border-ink-border bg-ink-deep p-4">
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
              <Clock size={12} className="text-scp-safe" /> {t('schedule.new')}
            </span>
            <div className="mt-3 space-y-2">
              <select
                value={newServerId || manageable[0]?.id || ''}
                onChange={(e) => setNewServerId(e.target.value)}
                aria-label={t('schedule.server')}
                className="w-full border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse"
              >
                {manageable.length === 0 && <option value="">{t('schedule.noManageable')}</option>}
                {manageable.map((s) => (
                  <option key={s.id} value={s.id}>{serverLabel(s)}{s.apiKeyConfigured ? '' : ` — ${t('schedule.noKey')}`}</option>
                ))}
              </select>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
                aria-label={t('schedule.kindLabel')}
                className="w-full border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse"
              >
                <option value="broadcast">{t('schedule.kind.broadcast')}</option>
                <option value="cassie">{t('schedule.kind.cassie')}</option>
                <option value="console">{t('schedule.kind.console')}</option>
              </select>
              {kind === 'console' ? (
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t('schedule.commandPh')}
                  className="w-full border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
                />
              ) : (
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={2}
                  placeholder={kind === 'broadcast' ? t('schedule.broadcastPh') : t('schedule.cassiePh')}
                  className="w-full resize-y border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
                />
              )}
              {kind === 'broadcast' && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number" min={1} max={60}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    title={t('schedule.duration')}
                    className="w-20 border border-ink-border bg-ink px-2 py-1 font-mono text-[10px] text-foreground focus:outline-none"
                  />
                  <label className="flex items-center gap-1.5 font-mono text-[10px] text-ink-mute">
                    <input type="checkbox" checked={clearPrev} onChange={(e) => setClearPrev(e.target.checked)} className="accent-foreground" />
                    {t('schedule.clearPrev')}
                  </label>
                </div>
              )}
              {kind === 'cassie' && (
                <input
                  value={translation}
                  onChange={(e) => setTranslation(e.target.value)}
                  placeholder={t('schedule.translation')}
                  className="w-full border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
                />
              )}
              <select
                value={intervalSeconds}
                onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                aria-label={t('schedule.interval')}
                className="w-full border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse"
              >
                {INTERVALS.map(([v, label]) => (
                  <option key={v} value={v}>{t('schedule.every')} {label}</option>
                ))}
              </select>
              <p className="font-mono text-[9px] leading-relaxed text-ink-mute">{t('schedule.hint')}</p>
              <button
                onClick={() => void create()}
                disabled={busy || !message.trim() || manageable.length === 0 || !(newServerId || manageable[0]?.id)}
                className="border border-inverse px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink disabled:opacity-40"
              >
                {busy ? <Loader2 size={11} className="animate-spin" /> : null} {t('schedule.create')}
              </button>
              {msg && <p className={`font-mono text-[10px] ${msg.ok ? 'text-scp-safe' : 'text-scp-err'}`}>{msg.text}</p>}
            </div>
          </div>
        </section>

        {/* 列表 */}
        <section className="col-span-12 xl:col-span-8">
          <div className="border border-ink-border bg-ink-deep">
            <div className="flex flex-wrap items-center gap-2 border-b border-ink-border px-3 py-2">
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
                <Clock size={12} className="text-scp-safe" /> {t('schedule.list')} — {schedules.length}
              </span>
              <div className="ml-auto flex items-center gap-2">
                {schedulesQuery.isFetching && <Loader2 size={11} className="animate-spin text-ink-mute" />}
              </div>
            </div>
            {schedulesQuery.isError && (
              <p className="m-3 border-l-2 border-scp-err/60 bg-scp-err/5 px-2 py-1.5 font-mono text-[10px] text-scp-err">
                {describeControlError(schedulesQuery.error, t)}
              </p>
            )}
            {schedules.length === 0 && !schedulesQuery.isLoading && (
              <p className="p-4 font-mono text-[11px] text-ink-mute">// {t('schedule.empty')}</p>
            )}
            <div className="divide-y divide-ink-border/60">
              {schedules.map((s) => {
                const sv = serverById(s.serverId)
                const canManage = sv ? (sv.role === 'owner' || sv.role === 'manager') : false
                return (
                  <div key={s.id} className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 truncate font-mono text-[11px] text-foreground">
                        {sv ? serverLabel(sv) : s.serverId}
                      </span>
                      <span className={`shrink-0 border px-1 py-0.5 font-mono text-[8px] uppercase tracking-wider ${
                        s.lastStatus === 'ok' ? 'border-scp-safe/50 text-scp-safe'
                          : s.lastStatus === 'fail' ? 'border-scp-err/50 text-scp-err'
                            : 'border-ink-mute text-ink-mute'
                      }`}>
                        {s.lastStatus || '—'}
                      </span>
                      <span className="shrink-0 font-mono text-[9px] text-ink-mute">
                        {t('schedule.every')} {s.intervalSeconds >= 3600 ? `${Math.round(s.intervalSeconds / 3600)}h` : `${Math.round(s.intervalSeconds / 60)}min`}
                      </span>
                      <span className="shrink-0 font-mono text-[9px] text-ink-mute">
                        {t('schedule.lastRun')}: {fmtTime(s.lastRunAt)}
                      </span>
                      <span className="ml-auto flex shrink-0 items-center gap-1.5">
                        {canManage && (
                          <button
                            onClick={() => void mutate(() => api(`/schedules/${s.id}`, { method: 'PUT', body: { enabled: !s.enabled } }))}
                            aria-label={s.enabled ? t('schedule.pause') : t('schedule.resume')}
                            title={s.enabled ? t('schedule.pause') : t('schedule.resume')}
                            className="flex items-center gap-1 border border-ink-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground"
                          >
                            {s.enabled ? <Pause size={10} /> : <Play size={10} />}
                            {s.enabled ? t('schedule.pause') : t('schedule.resume')}
                          </button>
                        )}
                        <button
                          onClick={() => setRunsOpen(runsOpen === s.id ? null : s.id)}
                          aria-expanded={runsOpen === s.id}
                          className="flex items-center gap-1 border border-ink-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground"
                        >
                          <History size={10} /> {t('schedule.runs')}
                        </button>
                        {canManage && (
                          <button
                            onClick={() => void mutate(() => api(`/schedules/${s.id}`, { method: 'DELETE' }))}
                            aria-label={`${t('schedule.delete')} ${s.id}`}
                            className="text-ink-mute transition-colors hover:text-scp-err"
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </span>
                    </div>
                    <p className="mt-1 break-words font-mono text-[10px] text-ink-mute">
                      {payloadSummary(t, s.kind, s.payload)}
                    </p>
                    {runsOpen === s.id && (
                      <div className="mt-2 max-h-40 overflow-auto border border-ink-border/60 bg-ink p-1.5 font-mono text-[9px] leading-relaxed">
                        {s.runs.length === 0 && <p className="text-ink-mute">// {t('schedule.noRuns')}</p>}
                        {s.runs.map((r, i) => (
                          <p key={`${r.utc}-${i}`} className={r.ok ? 'text-scp-safe' : 'text-scp-err'}>
                            {new Date(r.utc).toLocaleString()} — {r.ok ? '✓' : '✗'} {r.message}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      </div>
    </PageStub>
  )
}
