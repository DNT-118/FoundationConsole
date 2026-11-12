import { useState } from 'react'
import { Plus, Trash2, Server as ServerIcon, Check } from 'lucide-react'
import PageStub from '@/components/PageStub'
import AddServerDialog from '@/components/AddServerDialog'
import { useServersStore } from '@/store/serversStore'
import { useServerQuery } from '@/hooks/useServerQuery'
import { IS_DEMO } from '@/demo/mode'
import DemoErrorNote from '@/demo/DemoErrorNote'

export default function Servers() {
  const [open, setOpen] = useState(false)
  const servers = useServersStore((s) => s.servers)
  const activeId = useServersStore((s) => s.activeId)
  const setActive = useServersStore((s) => s.setActive)
  const remove = useServersStore((s) => s.remove)

  return (
    <PageStub code="M-02" title="Servers">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-mute">
            {servers.length} registered
          </span>
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 border border-white px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-white transition-colors hover:bg-white hover:text-ink"
          >
            <Plus size={12} /> Add Server
          </button>
        </div>

        {servers.length === 0 ? (
          <div className="border border-dashed border-ink-border px-4 py-16 text-center font-mono text-[12px] text-ink-mute">
            // no servers — click “Add Server” to register an endpoint
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {servers.map((s) => (
              <ServerCard
                key={s.id}
                id={s.id}
                label={s.label}
                baseUrl={s.baseUrl}
                active={s.id === activeId}
                onSelect={() => setActive(s.id)}
                onDelete={() => remove(s.id)}
              />
            ))}
          </div>
        )}
      </div>

      <AddServerDialog open={open} onClose={() => setOpen(false)} />
    </PageStub>
  )
}

function ServerCard({
  id, label, baseUrl, active, onSelect, onDelete,
}: {
  id: string
  label: string
  baseUrl: string
  active: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const { data, isFetching, isError, error } = useServerQuery({ serverId: id, enabled: active })
  const online = data?.online ?? false

  return (
    <div
      className={[
        'relative border bg-ink-deep p-4 transition-colors',
        active ? 'border-white' : 'border-ink-border hover:border-ink-mute',
      ].join(' ')}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <ServerIcon size={14} className="text-ink-mute" />
          <span className="font-mono text-[12px] uppercase tracking-wider text-white">
            {label}
          </span>
        </div>
        {active && (
          <span className="flex items-center gap-1 font-mono text-[10px] uppercase text-white">
            <Check size={11} /> Active
          </span>
        )}
      </div>

      <div className="mt-3 truncate font-mono text-[11px] text-ink-mute">
        {baseUrl}
      </div>

      <div className="mt-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
        <span className={online ? 'text-scp-safe' : isError ? 'text-scp-err' : 'text-ink-mute'}>
          {online ? 'ONLINE' : isError ? 'ERR' : isFetching ? 'SYNC…' : '—'}
        </span>
        <span className="text-ink-mute">
          {data ? `${data.playersCount}/${data.maxPlayers}` : '—'}
        </span>
      </div>

      {IS_DEMO && isError && <DemoErrorNote error={error} />}

      <div className="mt-3 flex justify-end gap-2">
        {!active && (
          <button
            onClick={onSelect}
            className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:text-white"
          >
            Activate
          </button>
        )}
        <button
          onClick={onDelete}
          className="flex items-center gap-1 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:text-scp-err"
        >
          <Trash2 size={11} /> Del
        </button>
      </div>
    </div>
  )
}
