/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
/**
 * 玩家历史（R4）：基于 /get_sl_data 轮询差分的进出记录。
 * 在线趋势 SVG 图 + 按 userid 聚合的会话表（次数/总时长/最近在线）；数据保留天数由管理员配置。
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { History, Loader2 } from 'lucide-react'
import { useT } from '@/i18n'
import { api } from '@/api/platform'
import { describeControlError } from '@/utils/controlHint'
import type { PlayerHistoryData } from '@/types/api'

const DAY_OPTIONS = [1, 7, 14, 30]

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  return `${h}h ${Math.floor((seconds % 3600) / 60)}m`
}

/** 在线趋势 SVG 折线（填充到基线）。 */
function TrendChart({ trend }: { trend: { t: number; online: number }[] }) {
  const t = useT()
  if (trend.length < 2) {
    return <p className="p-4 font-mono text-[10px] text-ink-mute">// {t('history.noTrend')}</p>
  }
  const W = 600
  const H = 120
  const maxOnline = Math.max(1, ...trend.map((p) => p.online))
  const points = trend.map((p, i) => {
    const x = (i / (trend.length - 1)) * (W - 2) + 1
    const y = H - 4 - (p.online / maxOnline) * (H - 12)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" role="img" aria-label={t('history.trend')}>
      <polyline points={`1,${H - 4} ${points.join(' ')} ${W - 1},${H - 4}`} fill="currentColor" className="text-scp-safe/20" stroke="none" />
      <polyline points={points.join(' ')} fill="none" stroke="currentColor" className="text-scp-safe" strokeWidth="1.5" />
      <line x1="1" y1={H - 4} x2={W - 1} y2={H - 4} className="text-ink-border" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

export default function PlayerHistory({ serverId }: { serverId: string }) {
  const t = useT()
  const [days, setDays] = useState(7)

  const query = useQuery({
    queryKey: ['player-history', serverId, days],
    queryFn: async () => (await api<{ history: PlayerHistoryData }>(`/servers/history?serverId=${encodeURIComponent(serverId)}&days=${days}`)).history,
    refetchInterval: 60_000,
  })
  const data = query.data

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 border border-ink-border bg-ink-deep px-3 py-2">
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
          <History size={12} className="text-scp-safe" /> {t('history.title')}
        </span>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label={t('history.days')}
          className="border border-ink-border bg-ink px-2 py-1 font-mono text-[10px] text-foreground focus:outline-none"
        >
          {DAY_OPTIONS.map((d) => (
            <option key={d} value={d}>{t('history.days').replace('{days}', String(d))}</option>
          ))}
        </select>
        {query.isFetching && <Loader2 size={11} className="animate-spin text-ink-mute" />}
        <span className="ml-auto font-mono text-[9px] text-ink-mute">{t('history.hint')}</span>
      </div>

      {query.isError && (
        <p className="border-l-2 border-scp-err/60 bg-scp-err/5 px-2 py-1.5 font-mono text-[10px] text-scp-err">
          {describeControlError(query.error, t)}
        </p>
      )}

      {data && (
        <>
          <div className="border border-ink-border bg-ink-deep p-3">
            <p className="font-mono text-[9px] uppercase tracking-wider text-ink-mute">{t('history.trend')}</p>
            <TrendChart trend={data.trend} />
          </div>
          <div className="border border-ink-border bg-ink-deep">
            <div className="min-h-0 overflow-auto">
              <table className="w-full border-collapse font-mono text-[11px]">
                <thead>
                  <tr className="border-b border-ink-border text-left text-[9px] uppercase tracking-wider text-ink-mute">
                    <th className="px-3 py-2 font-normal">{t('history.nickname')}</th>
                    <th className="px-3 py-2 font-normal">{t('history.steamId')}</th>
                    <th className="px-3 py-2 font-normal">{t('history.sessions')}</th>
                    <th className="px-3 py-2 font-normal">{t('history.totalTime')}</th>
                    <th className="px-3 py-2 font-normal">{t('history.lastSeen')}</th>
                    <th className="px-3 py-2 font-normal">{t('history.state')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.userid} className="border-b border-ink-border/60 hover:bg-ink">
                      <td className="px-3 py-1.5 text-foreground">{u.nickname || '—'}</td>
                      <td className="px-3 py-1.5 text-ink-mute">{u.userid}</td>
                      <td className="px-3 py-1.5 text-ink-mute">{u.sessions}</td>
                      <td className="px-3 py-1.5 text-ink-mute">{fmtDuration(u.totalSeconds)}</td>
                      <td className="px-3 py-1.5 text-ink-mute">{new Date(u.lastSeen).toLocaleString()}</td>
                      <td className={`px-3 py-1.5 ${u.online ? 'text-scp-safe' : 'text-ink-mute'}`}>
                        {u.online ? t('common.online') : t('common.offline')}
                      </td>
                    </tr>
                  ))}
                  {data.users.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-4 text-center font-mono text-[10px] text-ink-mute">// {t('history.empty')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
