import { Activity, Users, Cpu, Database, Server, Clock, ShieldAlert } from 'lucide-react'
import { Suspense, lazy } from 'react'
import PageStub from '@/components/PageStub'
import { useServerQuery } from '@/hooks/useServerQuery'
import { useServersStore } from '@/store/serversStore'
import { deriveStatus, statusMeta } from '@/utils/status'
import type { ReactNode } from 'react'

const FoundationScene = lazy(() => import('@/components/three/FoundationScene'))

export default function Dashboard() {
  const hasServer = useServersStore((s) => s.servers.length > 0)
  const { data, isFetching, isError } = useServerQuery()
  const status = deriveStatus(data)
  const meta = statusMeta[status]

  return (
    <PageStub code="M-01" title="Dashboard">
      <div className="relative">
        {/* 极克制 3D 背景：不抢主体、不响应指针 */}
        <div className="pointer-events-none absolute inset-x-0 -top-2 -z-0 h-[360px] opacity-50">
          <Suspense fallback={null}>
            <FoundationScene />
          </Suspense>
        </div>
      <div className="relative z-10 grid grid-cols-12 gap-3">
        {/* 基金会状态 — 跨3列 */}
        <Card className="col-span-12 md:col-span-3 row-span-2">
          <CardLabel icon={ShieldAlert} text="Foundation Status" />
          <div className={`mt-2 font-mono text-[28px] uppercase tracking-[0.15em] ${meta.color}`}>
            {status}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
            {meta.note}
          </div>
        </Card>

        <StatCard icon={Users} label="Players" value={data ? `${data.playersCount}/${data.maxPlayers}` : '—'} />
        <StatCard icon={Cpu} label="Ping" value={data ? `${data.ping}ms` : '—'} />
        <StatCard icon={Server} label="Online" value={data ? (data.online ? 'YES' : 'NO') : '—'} />
        <StatCard icon={Database} label="Phase" value={data?.currentPhase ?? '—'} />
        <StatCard icon={Clock} label="Round" value={data ? `${data.roundDuration}s` : '—'} />
        <StatCard icon={Activity} label="Nuke" value={data?.nukeStatus ?? '—'} />

        {/* 队伍分布 */}
        <Card className="col-span-12 md:col-span-6">
          <CardLabel icon={Users} text="Team Distribution" />
          <div className="mt-3 grid grid-cols-4 gap-2 font-mono text-[11px]">
            <TeamStat label="D-CLASS" value={data?.teamCounts['D-Class']} />
            <TeamStat label="FOUNDATION" value={data?.teamCounts.Foundation} />
            <TeamStat label="SCP" value={data?.teamCounts.SCP} />
            <TeamStat label="SPECTATOR" value={data?.teamCounts.Spectator} />
          </div>
        </Card>

        {/* API 健康度 */}
        <Card className="col-span-12 md:col-span-6">
          <CardLabel icon={Database} text="API Health" />
          <div className="mt-3 space-y-1.5 font-mono text-[11px] text-ink-mute">
            <Row k="Source" v="SLDataAPI" />
            <Row k="State" v={isFetching ? 'SYNC…' : isError ? 'ERR' : 'IDLE'} />
            <Row k="Players" v={data ? String(data.playersCount) : '—'} />
            <Row k="Fetched" v={data ? new Date(data.fetchedAt).toLocaleTimeString() : '—'} />
          </div>
        </Card>
      </div>
      </div>

      {!hasServer && (
        <div className="mt-6 border border-dashed border-ink-border px-4 py-6 text-center font-mono text-[12px] text-ink-mute">
          // no server registered — go to Servers page to add an endpoint
        </div>
      )}
    </PageStub>
  )
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`border border-ink-border bg-ink-deep p-4 ${className}`}>
      {children}
    </div>
  )
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
      <div className="mt-2 font-mono text-[20px] tracking-tight text-white">{value}</div>
    </Card>
  )
}

function TeamStat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="border border-ink-border bg-ink p-2">
      <div className="text-[9px] uppercase tracking-wider text-ink-mute">{label}</div>
      <div className="mt-1 text-[18px] text-white">{value ?? '—'}</div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-ink-border pb-1">
      <span>{k}</span>
      <span className="text-white">{v}</span>
    </div>
  )
}
