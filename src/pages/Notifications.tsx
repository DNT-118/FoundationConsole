/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
/**
 * 通知中心（R4）：基于控制 WS 真实事件（12 种）的平台内提醒 + 管理员邮件通道。
 * 规则：服务器（全部/单台）+ 事件多选 + 频率限制；站内收件箱支持已读/清空。
 */
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Mail, Loader2, Trash2, CheckCheck } from 'lucide-react'
import PageStub from '@/components/PageStub'
import { useT } from '@/i18n'
import { api } from '@/api/platform'
import { useAuthStore } from '@/store/authStore'
import { useServersStore } from '@/store/serversStore'
import type { NotificationItem, NotificationRule } from '@/types/api'
import type { TKey } from '@/i18n/dict'

/** 12 种真实事件 → 事件流页同款 i18n 标签。 */
const EVENT_KEYS: Record<string, TKey> = {
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

const INTERVALS: [number, string][] = [
  [60, '1min'], [300, '5min'], [600, '10min'], [1800, '30min'],
]

export default function Notifications() {
  const t = useT()
  const role = useAuthStore((s) => s.session?.role)
  const username = useAuthStore((s) => s.session?.username)
  const servers = useServersStore((s) => s.servers)
  const queryClient = useQueryClient()
  const isAdmin = role === 'admin'

  const [newEvents, setNewEvents] = useState<string[]>(['player_reported', 'warhead_started'])
  const [newServerId, setNewServerId] = useState<string>('*')
  const [newInapp, setNewInapp] = useState(true)
  const [newEmail, setNewEmail] = useState(false)
  const [newInterval, setNewInterval] = useState(300)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const rulesQuery = useQuery({
    queryKey: ['notify-rules', username],
    queryFn: async () => {
      const r = await api<{ rules: NotificationRule[]; events: string[] }>('/notifications/rules')
      return r
    },
  })
  const inboxQuery = useQuery({
    queryKey: ['notifications', username],
    queryFn: async () => {
      const r = await api<{ items: NotificationItem[] }>('/notifications')
      return r.items
    },
    refetchInterval: 30_000,
  })

  useEffect(() => { void queryClient.invalidateQueries({ queryKey: ['notify-rules'] }) }, [username, queryClient])

  async function createRule() {
    setBusy(true)
    setMsg(null)
    try {
      await api('/notifications/rules', {
        method: 'POST',
        body: { serverId: newServerId, events: newEvents, inapp: newInapp, email: newEmail, minIntervalSeconds: newInterval },
      })
      await queryClient.invalidateQueries({ queryKey: ['notify-rules'] })
      setMsg({ ok: true, text: '✓' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  async function mutateRule(fn: () => Promise<unknown>) {
    setMsg(null)
    try { await fn(); await queryClient.invalidateQueries({ queryKey: ['notify-rules'] }) } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
  }

  const items = inboxQuery.data ?? []
  const unread = items.filter((n) => !n.read).length
  const rules = rulesQuery.data?.rules ?? []
  const serverName = (id: string) => id === '*' ? t('notify.allServers') : (servers.find((s) => s.id === id) ? serverLabelOf(id) : id)
  const serverLabelOf = (id: string) => {
    const s = servers.find((x) => x.id === id)
    return s ? (s.label?.trim() || `${s.host}:${s.port}`) : id
  }

  return (
    <PageStub code="M-17" title={t('nav.notifications')}>
      <div className="grid grid-cols-12 gap-3">
        {/* 规则创建 */}
        <section className="col-span-12 xl:col-span-5 space-y-3">
          <div className="border border-ink-border bg-ink-deep p-4">
            <CardLabel icon={<Bell size={12} />} text={t('notify.newRule')} />
            <div className="mt-3 space-y-2">
              <select
                value={newServerId}
                onChange={(e) => setNewServerId(e.target.value)}
                aria-label={t('notify.server')}
                className="w-full border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse"
              >
                <option value="*">{t('notify.allServers')}</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>{s.label?.trim() || `${s.host}:${s.port}`}</option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-1">
                {(rulesQuery.data?.events ?? Object.keys(EVENT_KEYS)).map((ev) => (
                  <label key={ev} className="flex items-center gap-1.5 font-mono text-[10px] text-ink-mute">
                    <input
                      type="checkbox"
                      checked={newEvents.includes(ev)}
                      onChange={(e) => setNewEvents((cur) => (e.target.checked ? [...cur, ev] : cur.filter((x) => x !== ev)))}
                      className="accent-foreground"
                    />
                    {EVENT_KEYS[ev] ? t(EVENT_KEYS[ev]) : ev}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 font-mono text-[10px] text-ink-mute">
                  <input type="checkbox" checked={newInapp} onChange={(e) => setNewInapp(e.target.checked)} className="accent-foreground" />
                  {t('notify.inapp')}
                </label>
                <label className={`flex items-center gap-1.5 font-mono text-[10px] ${isAdmin ? 'text-ink-mute' : 'text-ink-mute/50'}`}
                  title={isAdmin ? undefined : t('notify.emailAdminOnly')}>
                  <input
                    type="checkbox"
                    checked={newEmail && isAdmin}
                    disabled={!isAdmin}
                    onChange={(e) => setNewEmail(e.target.checked)}
                    className="accent-foreground"
                  />
                  <Mail size={10} /> {t('notify.email')}（{isAdmin ? t('notify.emailReady') : t('notify.emailAdminOnly')}）
                </label>
                <select
                  value={newInterval}
                  onChange={(e) => setNewInterval(Number(e.target.value))}
                  aria-label={t('notify.interval')}
                  className="border border-ink-border bg-ink px-1.5 py-1 font-mono text-[10px] text-foreground focus:outline-none"
                >
                  {INTERVALS.map(([v, label]) => (
                    <option key={v} value={v}>{t('notify.every')} {label}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => void createRule()}
                disabled={busy || newEvents.length === 0}
                className="border border-inverse px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink disabled:opacity-40"
              >
                {busy ? <Loader2 size={11} className="animate-spin" /> : null} {t('notify.create')}
              </button>
              {msg && <p className={`font-mono text-[10px] ${msg.ok ? 'text-scp-safe' : 'text-scp-err'}`}>{msg.text}</p>}
            </div>
          </div>

          {/* 规则列表 */}
          <div className="border border-ink-border bg-ink-deep p-4">
            <CardLabel icon={<Bell size={12} />} text={`${t('notify.rules')} — ${rules.length}`} />
            <div className="mt-3 space-y-2">
              {rules.length === 0 && <p className="font-mono text-[10px] text-ink-mute">// {t('notify.noRules')}</p>}
              {rules.map((r) => (
                <div key={r.id} className="border border-ink-border px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-mono text-[10px] text-foreground">{serverName(r.serverId)}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <label className="flex items-center gap-1 font-mono text-[9px] text-ink-mute">
                        <input
                          type="checkbox"
                          checked={r.enabled}
                          onChange={(e) => void mutateRule(() => api(`/notifications/rules/${r.id}`, { method: 'PUT', body: { enabled: e.target.checked } }))}
                          className="accent-foreground"
                        />
                        {t('notify.enabled')}
                      </label>
                      <button
                        onClick={() => void mutateRule(() => api(`/notifications/rules/${r.id}`, { method: 'DELETE' }))}
                        aria-label={`${t('notify.delete')} ${serverName(r.serverId)}`}
                        className="text-ink-mute transition-colors hover:text-scp-err"
                      >
                        <Trash2 size={11} />
                      </button>
                    </span>
                  </div>
                  <p className="mt-1 break-words font-mono text-[9px] leading-relaxed text-ink-mute">
                    {r.events.map((ev) => (EVENT_KEYS[ev] ? t(EVENT_KEYS[ev]) : ev)).join(' · ')}
                    {' '}| {r.inapp ? t('notify.inapp') : ''}{r.email ? ` ${t('notify.email')}` : ''} | {t('notify.every')} {r.minIntervalSeconds}s
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 收件箱 */}
        <section className="col-span-12 xl:col-span-7">
          <div className="flex h-full flex-col border border-ink-border bg-ink-deep">
            <div className="flex flex-wrap items-center gap-2 border-b border-ink-border px-3 py-2">
              <CardLabel icon={<Bell size={12} />} text={`${t('notify.inbox')} — ${unread ? `${unread} ${t('notify.unread')}` : t('notify.allRead')}`} />
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => void queryClient.invalidateQueries({ queryKey: ['notifications'] })}
                  className="font-mono text-[10px] text-ink-mute transition-colors hover:text-foreground"
                >
                  {t('reports.refresh')}
                </button>
                <button
                  onClick={() => void api('/notifications/read', { method: 'POST', body: {} }).then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }))}
                  disabled={unread === 0}
                  className="flex items-center gap-1 border border-ink-border px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground disabled:opacity-40"
                >
                  <CheckCheck size={10} /> {t('notify.markAllRead')}
                </button>
                <button
                  onClick={() => void api('/notifications', { method: 'DELETE' }).then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }))}
                  disabled={items.length === 0}
                  className="flex items-center gap-1 border border-ink-border px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-ink-mute transition-colors hover:border-scp-err hover:text-scp-err disabled:opacity-40"
                >
                  <Trash2 size={10} /> {t('notify.clearInbox')}
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {items.length === 0 && (
                <p className="p-4 font-mono text-[11px] text-ink-mute">// {t('notify.emptyInbox')}</p>
              )}
              {items.map((n) => (
                <div key={n.id} className={`border-b border-ink-border/60 px-3 py-2 ${n.read ? '' : 'bg-scp-warn/5'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`min-w-0 truncate font-mono text-[10px] uppercase tracking-wider ${n.read ? 'text-ink-mute' : 'text-scp-warn'}`}>
                      {EVENT_KEYS[n.event] ? t(EVENT_KEYS[n.event]) : n.event}
                    </span>
                    <span className="shrink-0 font-mono text-[9px] text-ink-mute">
                      {serverName(n.serverId)} · {new Date(n.utc).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="mt-1 break-words text-[12px] leading-relaxed text-foreground">{n.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </PageStub>
  )
}

function CardLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
      <span className="text-scp-safe">{icon}</span> {text}
    </span>
  )
}
