/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
import { Activity, Cpu, Database, Server as ServerIcon, Users } from 'lucide-react'
import { useServerQuery } from '@/hooks/useServerQuery'
import { useServersStore, serverLabel } from '@/store/serversStore'
import { useT } from '@/i18n'
import { phaseText } from '@/utils/serverDisplay'
import { useThemeStore } from '@/store/themeStore'

export default function Topbar() {
  const t = useT()
  const theme = useThemeStore((s) => s.theme)
  const servers = useServersStore((s) => s.servers)
  const activeId = useServersStore((s) => s.activeId)
  const active = servers.find((s) => s.id === activeId)
  const { data, isFetching, isError } = useServerQuery()
  const displayName = active ? serverLabel(active, data?.name) : t('top.noServer')

  const online = data?.online ?? false
  const status = active
    ? online
      ? t('common.online')
      : isError
        ? t('common.err')
        : '—'
    : t('top.noServer')

  const statusColor = online
    ? 'text-scp-safe'
    : status === t('common.err')
      ? 'text-scp-err'
      : 'text-ink-mute'

  return (
    <header className={`flex h-14 shrink-0 items-center justify-between gap-3 border-b border-ink-border px-3 sm:px-4 ${theme === 'anime' ? '' : 'bg-ink'}`}>
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <ServerIcon size={14} className="shrink-0 text-ink-mute" />
        <span className="truncate font-mono text-[11px] uppercase tracking-wider text-foreground">
          {displayName} <span className="text-ink-mute/50">· DNT_OF</span>
        </span>
        <span className={`shrink-0 whitespace-nowrap font-mono text-[11px] ${statusColor}`}>{status}</span>
        {isFetching && <Activity size={12} className="shrink-0 animate-pulse text-ink-mute" />}
      </div>

      <div className="flex shrink-0 items-center gap-3 font-mono text-[11px] text-ink-mute lg:gap-5">
        <Metric icon={Users} label={t('top.players')} value={data ? `${data.playersCount}/${data.maxPlayers}` : '—'} />
        <Metric className="hidden sm:flex" icon={Cpu} label={t('top.ping')} value={data ? `${data.ping}ms` : '—'} />
        <Metric className="hidden lg:flex" icon={Database} label={t('top.phase')} value={phaseText(data, t)} />
      </div>
    </header>
  )
}

function Metric({
  icon: Icon, label, value, className = 'flex',
}: { icon: typeof Activity; label: string; value: string; className?: string }) {
  return (
    <div className={`${className} items-center gap-1.5 whitespace-nowrap`}>
      <Icon size={12} className="text-ink-mute" />
      <span className="uppercase tracking-wider">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  )
}
