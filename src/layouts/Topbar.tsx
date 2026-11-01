import { Activity, Cpu, Database, Server as ServerIcon, Users } from 'lucide-react'
import { useServerQuery } from '@/hooks/useServerQuery'
import { useServersStore } from '@/store/serversStore'

export default function Topbar() {
  const servers = useServersStore((s) => s.servers)
  const activeId = useServersStore((s) => s.activeId)
  const active = servers.find((s) => s.id === activeId)
  const { data, isFetching, isError } = useServerQuery()

  const online = data?.online ?? false
  const status = active
    ? online
      ? 'ONLINE'
      : isError
        ? 'ERR'
        : '—'
    : 'NO SERVER'

  const statusColor = online
    ? 'text-scp-safe'
    : status === 'ERR'
      ? 'text-scp-err'
      : 'text-ink-mute'

  return (
    <header className="flex h-14 items-center justify-between border-b border-ink-border bg-ink px-4">
      <div className="flex items-center gap-3">
        <ServerIcon size={14} className="text-ink-mute" />
        <span className="font-mono text-[11px] uppercase tracking-wider text-white">
          {active?.label ?? 'NO SERVER'}
        </span>
        <span className={`font-mono text-[11px] ${statusColor}`}>{status}</span>
        {isFetching && <Activity size={12} className="animate-pulse text-ink-mute" />}
      </div>

      <div className="flex items-center gap-5 font-mono text-[11px] text-ink-mute">
        <Metric icon={Users} label="PLAYERS" value={data ? `${data.playersCount}/${data.maxPlayers}` : '—'} />
        <Metric icon={Cpu} label="PING" value={data ? `${data.ping}ms` : '—'} />
        <Metric icon={Database} label="PHASE" value={data?.currentPhase ?? '—'} />
      </div>
    </header>
  )
}

function Metric({
  icon: Icon, label, value,
}: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon size={12} className="text-ink-mute" />
      <span className="uppercase tracking-wider">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  )
}
