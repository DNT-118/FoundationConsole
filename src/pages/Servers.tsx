import { useState } from 'react'
import { Plus, Trash2, Server as ServerIcon, Check } from 'lucide-react'
import PageStub from '@/components/PageStub'
import AddServerDialog from '@/components/AddServerDialog'
import { useServersStore, serverBaseUrl, serverLabel } from '@/store/serversStore'
import { useServerQuery } from '@/hooks/useServerQuery'
import { useT } from '@/i18n'

export default function Servers() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const servers = useServersStore((s) => s.servers)
  const activeId = useServersStore((s) => s.activeId)
  const setActive = useServersStore((s) => s.setActive)
  const remove = useServersStore((s) => s.remove)

  return (
    <PageStub code="M-03" title={t('nav.servers')}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-mute">
            {servers.length} {t('servers.registered')}
          </span>
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 border border-inverse px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink"
          >
            <Plus size={12} /> {t('servers.add')}
          </button>
        </div>

        {servers.length === 0 ? (
          <div className="border border-dashed border-ink-border px-4 py-16 text-center font-mono text-[12px] text-ink-mute">
            // {t('servers.empty')}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {servers.map((s) => (
              <ServerCard
                key={s.id}
                id={s.id}
                server={s}
                endpoint={serverBaseUrl(s)}
                active={s.id === activeId}
                onSelect={() => setActive(s.id)}
                onDelete={() => remove(s.id)}
                t={t}
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
  id, server, endpoint, active, onSelect, onDelete, t,
}: {
  id: string
  server: { label?: string; host: string; controlTransport?: 'http' | 'ws' }
  endpoint: string
  active: boolean
  onSelect: () => void
  onDelete: () => void
  t: ReturnType<typeof useT>
}) {
  const { data, isFetching, isError, error } = useServerQuery({ serverId: id, enabled: active })
  const online = data?.online ?? false
  const errMsg = isError && error instanceof Error ? error.message : null
  const displayName = serverLabel(server, data?.name)

  return (
    <div
      className={[
        'relative border bg-ink-deep p-4 transition-colors',
        active ? 'border-inverse' : 'border-ink-border hover:border-ink-mute',
      ].join(' ')}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <ServerIcon size={14} className="text-ink-mute" />
          <span className="truncate font-mono text-[12px] uppercase tracking-wider text-foreground">
            {displayName}
          </span>
        </div>
        {active && (
          <span className="flex items-center gap-1 font-mono text-[10px] uppercase text-foreground">
            <Check size={11} /> {t('servers.active')}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 truncate font-mono text-[11px] text-ink-mute">
        <span className="truncate">{endpoint}</span>
        <span className={`shrink-0 border px-1 py-0.5 text-[8px] uppercase tracking-wider ${
          server.controlTransport === 'ws'
            ? 'border-scp-safe/50 text-scp-safe'
            : 'border-ink-mute text-ink-mute'
        }`}>
          {server.controlTransport === 'ws' ? t('servers.connWs') : t('servers.connHttp')}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
        <span className={online ? 'text-scp-safe' : isError ? 'text-scp-err' : 'text-ink-mute'}>
          {online ? t('common.online') : isError ? t('common.err') : isFetching ? t('common.sync') : '—'}
        </span>
        <span className="text-ink-mute">
          {data ? `${data.playersCount}/${data.maxPlayers}` : '—'}
        </span>
      </div>

      {errMsg && (
        <div className="mt-2 break-words border-l-2 border-scp-err/60 bg-scp-err/5 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-scp-err">
          {errMsg}
        </div>
      )}

      <div className="mt-3 flex justify-end gap-2">
        {!active && (
          <button
            onClick={onSelect}
            className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:text-foreground"
          >
            {t('servers.activate')}
          </button>
        )}
        <button
          onClick={onDelete}
          className="flex items-center gap-1 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:text-scp-err"
        >
          <Trash2 size={11} /> {t('servers.del')}
        </button>
      </div>
    </div>
  )
}
