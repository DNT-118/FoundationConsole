import { useEffect, useState } from 'react'
import { Plus, Trash2, Server as ServerIcon, Check, Users } from 'lucide-react'
import PageStub from '@/components/PageStub'
import AddServerDialog from '@/components/AddServerDialog'
import { useServersStore, serverBaseUrl, serverLabel } from '@/store/serversStore'
import { useServerQuery } from '@/hooks/useServerQuery'
import { useT } from '@/i18n'
import { api } from '@/api/platform'
import type { ServerMember, ServerMemberRole } from '@/types/api'
import type { ServerConfig } from '@/store/serversStore'
import type { TKey } from '@/i18n/dict'

export default function Servers() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const servers = useServersStore((s) => s.servers)
  const activeId = useServersStore((s) => s.activeId)
  const setActive = useServersStore((s) => s.setActive)
  const fetchServers = useServersStore((s) => s.fetchServers)

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
                server={s}
                endpoint={serverBaseUrl(s)}
                active={s.id === activeId}
                onSelect={() => setActive(s.id)}
                onRemoved={() => { void fetchServers() }}
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
  server, endpoint, active, onSelect, onRemoved, t,
}: {
  server: ServerConfig
  endpoint: string
  active: boolean
  onSelect: () => void
  onRemoved: () => void
  t: ReturnType<typeof useT>
}) {
  const { data, isFetching, isError, error } = useServerQuery({ serverId: server.id, enabled: active })
  const online = data?.online ?? false
  const errMsg = isError && error instanceof Error ? error.message : null
  const displayName = serverLabel(server, data?.name)
  const role = server.role ?? 'owner'
  const canManageMembers = role === 'owner' || role === 'manager'
  const remove = useServersStore((s) => s.remove)
  const [membersOpen, setMembersOpen] = useState(false)

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
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {server.sharedBy && (
            <span className="border border-ink-mute px-1 py-0.5 font-mono text-[8px] uppercase tracking-wider text-ink-mute" title={server.sharedBy}>
              {t('servers.shared')}
            </span>
          )}
          <span className="border border-scp-safe/50 px-1 py-0.5 font-mono text-[8px] uppercase tracking-wider text-scp-safe">
            {t(`servers.role.${role}` as TKey)}
          </span>
          {active && (
            <span className="flex items-center gap-1 font-mono text-[10px] uppercase text-foreground">
              <Check size={11} /> {t('servers.active')}
            </span>
          )}
        </div>
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

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {!active && (
          <button
            onClick={onSelect}
            className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:text-foreground"
          >
            {t('servers.activate')}
          </button>
        )}
        {canManageMembers && (
          <button
            onClick={() => setMembersOpen((v) => !v)}
            aria-expanded={membersOpen}
            className="flex items-center gap-1 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:text-foreground"
          >
            <Users size={11} /> {t('servers.members')}
          </button>
        )}
        {role === 'owner' && (
          <button
            onClick={() => {
              if (!window.confirm(t('servers.confirmDelete').replace('{name}', displayName))) return
              void remove(server.id).then(onRemoved)
            }}
            aria-label={`${t('servers.del')} ${displayName}`}
            className="flex items-center gap-1 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:text-scp-err"
          >
            <Trash2 size={11} /> {t('servers.del')}
          </button>
        )}
      </div>

      {membersOpen && canManageMembers && (
        <MemberPanel serverId={server.id} owner={server.owner ?? ''} />
      )}
    </div>
  )
}

const MEMBER_ROLES: ServerMemberRole[] = ['viewer', 'operator', 'manager']

/** 成员管理（owner/manager）：添加 / 改角色 / 移除，全部经服务端强制校验。 */
function MemberPanel({ serverId, owner }: { serverId: string; owner: string }) {
  const t = useT()
  const [members, setMembers] = useState<ServerMember[] | null>(null)
  const [newUser, setNewUser] = useState('')
  const [newRole, setNewRole] = useState<ServerMemberRole>('viewer')
  const [msg, setMsg] = useState<string | null>(null)

  async function reload() {
    try {
      const r = await api<{ members: ServerMember[] }>(`/servers/members?serverId=${encodeURIComponent(serverId)}`)
      setMembers(r.members)
      setMsg(null)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }
  useEffect(() => { void reload() }, [serverId])

  async function act(fn: () => Promise<unknown>) {
    try { await fn(); await reload(); setMsg(null) } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <div className="mt-3 border-t border-ink-border pt-3">
      <p className="font-mono text-[9px] uppercase tracking-wider text-ink-mute">{t('servers.membersPanel')}</p>
      {msg && <p className="mt-1 font-mono text-[10px] text-scp-err">{msg}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={newUser}
          onChange={(e) => setNewUser(e.target.value)}
          placeholder={t('servers.memberUser')}
          className="w-40 border border-ink-border bg-ink px-2 py-1 font-mono text-[10px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
        />
        <select
          value={newRole}
          onChange={(e) => setNewRole(e.target.value as ServerMemberRole)}
          aria-label={t('servers.memberRole')}
          className="border border-ink-border bg-ink px-1.5 py-1 font-mono text-[10px] text-foreground focus:outline-none"
        >
          {MEMBER_ROLES.map((r) => (
            <option key={r} value={r}>{t(`servers.role.${r}` as TKey)}</option>
          ))}
        </select>
        <button
          onClick={() => {
            if (!newUser.trim()) return
            void act(async () => {
              await api(`/servers/${encodeURIComponent(serverId)}/members`, {
                method: 'POST', body: { username: newUser.trim(), role: newRole },
              })
              setNewUser('')
            })
          }}
          disabled={!newUser.trim()}
          className="border border-inverse px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink disabled:opacity-40"
        >
          {t('servers.memberAdd')}
        </button>
      </div>
      <div className="mt-2 space-y-1">
        {members === null && <p className="font-mono text-[10px] text-ink-mute">{t('common.loading')}</p>}
        {members?.length === 0 && <p className="font-mono text-[10px] text-ink-mute">// {t('servers.membersEmpty')}</p>}
        {members?.map((m) => (
          <div key={m.username} className="flex items-center justify-between gap-2 border border-ink-border px-2 py-1">
            <span className="min-w-0 truncate font-mono text-[10px] text-foreground">
              {m.username}
              {m.username === owner && <span className="ml-2 text-[9px] text-scp-safe">{t('servers.role.owner')}</span>}
            </span>
            {m.username === owner ? (
              <span />
            ) : (
              <span className="flex shrink-0 items-center gap-1.5">
                <select
                  value={m.role}
                  onChange={(e) => void act(() => api(`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(m.username)}`, {
                    method: 'PUT', body: { role: e.target.value },
                  }))}
                  aria-label={`${t('servers.memberRole')} · ${m.username}`}
                  className="border border-ink-border bg-ink px-1 py-0.5 font-mono text-[9px] text-foreground focus:outline-none"
                >
                  {MEMBER_ROLES.map((r) => (
                    <option key={r} value={r}>{t(`servers.role.${r}` as TKey)}</option>
                  ))}
                </select>
                <button
                  onClick={() => void act(() => api(`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(m.username)}`, { method: 'DELETE' }))}
                  aria-label={`${t('servers.memberRemove')} ${m.username}`}
                  className="font-mono text-[9px] uppercase tracking-wider text-ink-mute transition-colors hover:text-scp-err"
                >
                  <Trash2 size={10} />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
