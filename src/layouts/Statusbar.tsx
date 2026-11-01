import { useServerQuery } from '@/hooks/useServerQuery'
import { useServersStore } from '@/store/serversStore'

export default function Statusbar() {
  const active = useServersStore((s) => s.servers.find((x) => x.id === s.activeId))
  const { data, isFetching } = useServerQuery()
  const now = new Date()
  const clock = now.toISOString().slice(11, 19)

  return (
    <footer className="flex h-7 items-center justify-between border-t border-ink-border bg-ink-deep px-4 font-mono text-[10px] uppercase tracking-wider text-ink-mute">
      <div className="flex items-center gap-4">
        <span>PFC v0.1.0</span>
        <span className="text-ink-border">|</span>
        <span>{active?.baseUrl ?? 'no endpoint'}</span>
        <span className="text-ink-border">|</span>
        <span className={isFetching ? 'text-white' : ''}>
          {isFetching ? 'SYNC…' : 'IDLE'}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <span>ROUND {data ? `${data.roundDuration}s` : '—'}</span>
        <span className="text-ink-border">|</span>
        <span>NUKE {data?.nukeStatus ?? '—'}</span>
        <span className="text-ink-border">|</span>
        <span className="text-white">{clock} UTC</span>
      </div>
    </footer>
  )
}
