/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
import { Activity, Users, Cpu, Database, Server, Clock, ShieldAlert } from 'lucide-react'
import { Suspense, lazy, useState } from 'react'
import PageStub from '@/components/PageStub'
import { useServerQuery } from '@/hooks/useServerQuery'
import { useServersOverview } from '@/hooks/useServersOverview'
import { useServersStore, serverLabel } from '@/store/serversStore'
import { deriveFleetStatus, statusLabel, statusMeta } from '@/utils/status'
import { nukeText, phaseText } from '@/utils/serverDisplay'
import { holidayLabel } from '@/utils/controlHint'
import { useT } from '@/i18n'
import { useThemeStore } from '@/store/themeStore'
import type { TKey } from '@/i18n/dict'
import type { FoundationStatus } from '@/types/api'
import type { ReactNode } from 'react'

const FoundationScene = lazy(() => import('@/components/three/FoundationScene'))

const noteKey: Record<FoundationStatus, TKey> = {
  SAFE: 'dash.note.safe', EUCLID: 'dash.note.euclid', KETER: 'dash.note.keter', THAUMIEL: 'dash.note.thaumiel',
}

export default function Dashboard() {
  const [showScene, setShowScene] = useState(false)
  const t = useT()
  const hasServer = useServersStore((s) => s.servers.length > 0)
  const servers = useServersStore((s) => s.servers)
  const activeId = useServersStore((s) => s.activeId)
  const setActive = useServersStore((s) => s.setActive)
  const overview = useServersOverview()
  const { data, isFetching, isError } = useServerQuery()
  const status = deriveFleetStatus(overview)
  const meta = statusMeta[status]
  const theme = useThemeStore((s) => s.theme)

  return (
    <PageStub code="M-01" title={t('nav.dashboard')} action={<button className="border border-ink-border px-3 py-1 text-xs text-ink-mute" aria-pressed={showScene} onClick={() => setShowScene(v => !v)}>3D {showScene ? 'ON' : 'OFF'}</button>}>
      <div className="relative">
        {showScene && theme !== 'anime' && (
          <div className="pointer-events-none absolute inset-x-0 -top-2 -z-0 h-[360px] opacity-50">
            <Suspense fallback={null}>
              <FoundationScene />
            </Suspense>
          </div>
        )}
        <div className="relative z-10 grid grid-cols-12 gap-3">
          <Card className="col-span-12 md:col-span-3 row-span-2">
            <CardLabel icon={ShieldAlert} text={t('dash.foundation')} />
            <div className={`mt-2 font-mono text-[28px] uppercase tracking-[0.15em] ${meta.color}`}>
              {statusLabel[status]}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
              {t(noteKey[status])}
            </div>
          </Card>

          <StatCard icon={Users} label={t('dash.players')} value={data ? `${data.playersCount}/${data.maxPlayers}` : '—'} />
          <StatCard icon={Cpu} label={t('dash.ping')} value={data ? `${data.ping}ms` : '—'} />
          <StatCard icon={Server} label={t('dash.online')} value={data ? (data.online ? t('common.online') : t('common.offline')) : '—'} />
          <StatCard icon={Database} label={t('dash.phase')} value={phaseText(data, t)} />
          <StatCard icon={Clock} label={t('dash.round')} value={data ? `${data.roundDuration}s` : '—'} />
          <StatCard icon={Activity} label={t('dash.nuke')} value={nukeText(data, t)} />

          <Card className="col-span-12 md:col-span-6">
            <CardLabel icon={Users} text={t('dash.teamDist')} />
            <div className="mt-3 grid grid-cols-5 gap-2 font-mono text-[11px]">
              <TeamStat label={t('dash.team.dclass')} value={data?.teamCounts['D-Class']} />
              <TeamStat label={t('dash.team.chaos')} value={data?.teamCounts.Chaos} />
              <TeamStat label={t('dash.team.foundation')} value={data?.teamCounts.Foundation} />
              <TeamStat label={t('dash.team.scp')} value={data?.teamCounts.SCP} />
              <TeamStat label={t('dash.team.spectator')} value={data?.teamCounts.Spectator} />
            </div>
          </Card>

          <Card className="col-span-12 md:col-span-6">
            <CardLabel icon={Database} text={t('dash.apiHealth')} />
            <div className="mt-3 space-y-1.5 font-mono text-[11px] text-ink-mute">
              <Row k={t('dash.apiSource')} v="SLDataAPI" />
              <Row k={t('dash.apiState')} v={isFetching ? t('common.sync') : isError ? t('common.err') : t('common.idle')} />
              <Row k={t('dash.apiPlayers')} v={data ? String(data.playersCount) : '—'} />
              <Row k={t('dash.apiFetched')} v={data ? new Date(data.fetchedAt).toLocaleTimeString() : '—'} />
              {/* SLDataAPI 2.6.x：game_version / active_holiday（旧版本服务端缺省时显示 —） */}
              <Row k={t('dash.gameVersion')} v={data?.gameVersion || '—'} />
              <Row k={t('dash.activeHoliday')} v={data ? holidayLabel(data.activeHoliday, t) : '—'} />
            </div>
          </Card>

          {servers.length > 0 && (
            <Card className="col-span-12">
              <CardLabel icon={Server} text={`${t('dash.allServers')} — ${servers.length}`} />
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {overview.map((q, i) => {
                  const s = servers[i]
                  if (!s) return null
                  const d = q.data
                  const active = s.id === activeId
                  return (
                    <button
                      key={s.id}
                      onClick={() => setActive(s.id)}
                      className={[
                        'border p-3 text-left font-mono transition-colors',
                        active
                          ? 'border-inverse bg-ink'
                          : 'border-ink-border bg-ink-deep hover:border-ink-mute',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[12px] text-foreground">
                          {serverLabel(s, d?.name)}
                        </span>
                        {active && (
                          <span className="shrink-0 border border-scp-safe/50 px-1 py-0.5 text-[8px] uppercase tracking-wider text-scp-safe">
                            {t('dash.activeServer')}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 truncate text-[10px] text-ink-mute">
                        {s.host}:{s.port}
                      </div>
                      <div className="mt-2 space-y-0.5 text-[10px] text-ink-mute">
                        {q.isError ? (
                          <span className="text-scp-err">{t('dash.serverUnreachable')}</span>
                        ) : (
                          <>
                            <span className={d?.online ? 'text-scp-safe' : 'text-scp-err'}>
                              {d ? (d.online ? t('common.online') : t('common.offline')) : '…'}
                            </span>
                            <span className="mx-2 text-ink-border">|</span>
                            {t('dash.players')} {d ? `${d.playersCount}/${d.maxPlayers}` : '—'}
                            <span className="mx-2 text-ink-border">|</span>
                            {t('dash.round')} {d ? `${d.roundDuration}s` : '—'}
                            <span className="mx-2 text-ink-border">|</span>
                            {t('dash.nuke')} {nukeText(d, t)}
                          </>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </Card>
          )}
        </div>
      </div>

      {!hasServer && (
        <div className="mt-6 border border-dashed border-ink-border px-4 py-6 text-center font-mono text-[12px] text-ink-mute">
          // {t('dash.noServer')}
        </div>
      )}
    </PageStub>
  )
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`border border-ink-border bg-ink-deep p-4 ${className}`}>{children}</div>
}

function CardLabel({ icon: Icon, text }: { icon: typeof Activity; text: string }) {
  return (
    <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute">
      <Icon size={11} /> {text}
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <Card className="col-span-6 md:col-span-3">
      <CardLabel icon={icon} text={label} />
      <div className="mt-2 font-mono text-[20px] tracking-tight text-foreground">{value}</div>
    </Card>
  )
}

function TeamStat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="border border-ink-border bg-ink p-2">
      <div className="text-[9px] uppercase tracking-wider text-ink-mute">{label}</div>
      <div className="mt-1 text-[18px] text-foreground">{value ?? '—'}</div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-ink-border pb-1">
      <span>{k}</span>
      <span className="text-foreground">{v}</span>
    </div>
  )
}
