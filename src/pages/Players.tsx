import { useMemo, useState } from 'react'
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel,
  type ColumnDef, type SortingState,
} from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { Search, Ban, VolumeX, LogOut, MessageSquare, Loader2 } from 'lucide-react'
import PageStub from '@/components/PageStub'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useServerQuery } from '@/hooks/useServerQuery'
import { useSteamId } from '@/services/steam'
import { useT } from '@/i18n'
import { useControlMutation, useControlSource, type ControlCall } from '@/hooks/useControl'
import type { TKey } from '@/i18n/dict'
import type { Player, Team } from '@/types/api'

const teamColor: Record<Team, string> = {
  'D-Class': 'text-scp-warn',
  Foundation: 'text-foreground',
  SCP: 'text-scp-err',
  Spectator: 'text-ink-mute',
  Unknown: 'text-ink-mute',
}
const teamKey: Record<Team, TKey> = {
  'D-Class': 'team.dclass',
  Foundation: 'team.foundation',
  SCP: 'team.scp',
  Spectator: 'team.spectator',
  Unknown: 'team.unknown',
}

type ActKind = 'kick' | 'ban' | 'mute' | 'msg'

export default function Players() {
  const t = useT()
  const { data } = useServerQuery()
  const players = data?.players ?? []
  const [global, setGlobal] = useState('')
  const [sorting, setSorting] = useState<SortingState>([])

  const columns = useMemo<ColumnDef<Player>[]>(
    () => [
      { accessorKey: 'nickname', header: t('nav.players') },
      { accessorKey: 'role', header: t('players.role') },
      { accessorKey: 'team', header: t('players.team') },
    ],
    [t],
  )

  const table = useReactTable({
    data: players,
    columns,
    state: { sorting, globalFilter: global },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobal,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  return (
    <PageStub code="M-04" title={t('nav.players')}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-mute">
            {players.length} {t('players.online')}
          </span>
          <div className="flex items-center gap-2 border border-ink-border bg-ink-deep px-2 py-1">
            <Search size={12} className="text-ink-mute" />
            <input
              value={global}
              onChange={(e) => setGlobal(e.target.value)}
              placeholder={t('players.filter')}
              className="bg-transparent font-mono text-[12px] text-foreground placeholder:text-ink-mute focus:outline-none"
            />
          </div>
        </div>

        {players.length === 0 ? (
          <div className="border border-dashed border-ink-border px-4 py-16 text-center font-mono text-[12px] text-ink-mute">
            // {t('players.empty')}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {table.getRowModel().rows.map((row) => (
              <PlayerCard key={row.id} player={row.original} t={t} />
            ))}
          </div>
        )}
      </div>
    </PageStub>
  )
}

function PlayerCard({ player, t }: { player: Player; t: ReturnType<typeof useT> }) {
  const { data: steam, isFetching } = useSteamId(player.steamId || undefined)
  const { control } = useControlSource()
  const mutation = useControlMutation()
  const queryClient = useQueryClient()

  const [collapsed, setCollapsed] = useState(true)
  const [action, setAction] = useState<ActKind | null>(null)
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState(60)
  const [message, setMessage] = useState('')
  const [msgType, setMsgType] = useState<'hint' | 'broadcast'>('hint')
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null)
  const [pending, setPending] = useState<ControlCall | null>(null)

  const canRun = !!control
  const busy = mutation.isPending

  const realSteam = player.steamId || (isFetching ? '…' : steam?.steamId ?? '—')

  function submit(call: ControlCall, confirm: string) {
    setPending(call)
    setConfirmMsg(confirm)
  }

  function exec() {
    setConfirmMsg(null)
    if (!pending) return
    void mutation.mutateAsync(pending)
      .then(() => {
        setAction(null)
        setReason('')
        setMessage('')
        return queryClient.invalidateQueries({ queryKey: ['server'] })
      })
      .catch(() => undefined)
  }

  return (
    <div className="border border-ink-border bg-ink-deep p-4 transition-colors hover:border-ink-mute">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="truncate font-mono text-[13px] text-foreground">{player.nickname}</div>
          <div className={`mt-0.5 font-mono text-[10px] uppercase tracking-wider ${teamColor[player.team]}`}>
            {t(teamKey[player.team])}
          </div>
        </div>
        {steam?.avatar ? (
          <img
            src={steam.avatar}
            alt={player.nickname}
            loading="lazy"
            className="h-8 w-8 shrink-0 border border-ink-border object-cover"
          />
        ) : (
          <div className="grid h-8 w-8 shrink-0 place-items-center border border-ink-border bg-ink font-mono text-[11px] text-ink-mute">
            {player.nickname.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>

      <dl className="mt-3 space-y-1 font-mono text-[11px]">
        <Row k={t('players.role')} v={player.role} />
        <Row k={t('players.team')} v={t(teamKey[player.team])} />
        <Row
          k={t('players.steamId')}
          v={realSteam}
          accent
          onToggle={() => setCollapsed((c) => !c)}
          collapseLabel={collapsed ? t('common.expand') : t('common.collapse')}
        />
        {!collapsed && steam?.persona && (
          <Row k={t('players.persona')} v={steam.persona} />
        )}
      </dl>

      {action === null ? (
        <div className="mt-3 flex items-center gap-2 border-t border-ink-border pt-3">
          <Act icon={LogOut} label={t('players.kick')} disabled={!canRun || busy}
            onClick={() => { setAction('kick'); setReason('') }} />
          <Act icon={Ban} label={t('players.ban')} danger disabled={!canRun || busy}
            onClick={() => { setAction('ban'); setReason(''); setDuration(60) }} />
          <Act icon={VolumeX} label={t('players.mute')} danger disabled={!canRun || busy}
            onClick={() => setAction('mute')} />
          <Act icon={MessageSquare} label={t('players.msg')} disabled={!canRun || busy}
            onClick={() => { setAction('msg'); setMessage('') }} />
        </div>
      ) : (
        <div className="mt-3 space-y-2 border-t border-ink-border pt-3">
          {action === 'kick' && (
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('ra.reason')}
              className="w-full border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
            />
          )}
          {action === 'ban' && (
            <div className="flex gap-2">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('ra.reason')}
                className="w-full border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
              />
              <input
                type="number" min={0}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                placeholder={t('ra.banDuration')}
                className="w-24 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
              />
            </div>
          )}
          {action === 'mute' && (
            <p className="font-mono text-[10px] text-ink-mute">
              // {t('ra.confirmMute').replace('{name}', player.nickname)}
            </p>
          )}
          {action === 'msg' && (
            <div className="space-y-2">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('ra.msg')}
                rows={2}
                className="w-full resize-y border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
              />
              <div className="flex items-center gap-2">
                <select
                  value={msgType}
                  onChange={(e) => setMsgType(e.target.value as 'hint' | 'broadcast')}
                  className="border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse"
                >
                  <option value="hint">{t('ra.msgHint')}</option>
                  <option value="broadcast">{t('ra.msgBroadcast')}</option>
                </select>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              {busy && <Loader2 size={11} className="animate-spin text-ink-mute" />}
              <button
                onClick={() => setAction(null)}
                disabled={busy}
                className="font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:text-foreground disabled:opacity-40"
              >
                {t('common.cancel')}
              </button>
            </span>
            <button
              onClick={() => {
                if (action === 'kick') {
                  submit(
                    { path: '/control/moderation/kick', body: { target: player.nickname, reason: reason.trim() } },
                    t('ra.confirmKick').replace('{name}', player.nickname),
                  )
                } else if (action === 'ban') {
                  submit(
                    { path: '/control/moderation/ban', body: { target: player.nickname, reason: reason.trim(), duration } },
                    t('ra.confirmBan').replace('{name}', player.nickname).replace('{duration}', String(duration)),
                  )
                } else if (action === 'mute') {
                  submit(
                    { path: '/control/moderation/mute', body: { target: player.nickname, mute: true } },
                    t('ra.confirmMute').replace('{name}', player.nickname),
                  )
                } else if (message.trim()) {
                  submit(
                    {
                      path: '/control/moderation/msg',
                      body: { target: player.nickname, message: message.trim(), msg_type: msgType, duration_seconds: 5 },
                    },
                    `→ ${player.nickname}`,
                  )
                }
              }}
              disabled={busy || (action === 'msg' && !message.trim())}
              className="border border-scp-err px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-scp-err transition-colors hover:bg-scp-err hover:text-foreground disabled:opacity-40"
            >
              {t('common.confirm')}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmMsg !== null}
        message={confirmMsg ?? ''}
        busy={busy}
        onCancel={() => setConfirmMsg(null)}
        onConfirm={exec}
      />
    </div>
  )
}

function Row({
  k, v, accent, onToggle, collapseLabel,
}: {
  k: string; v: string; accent?: boolean
  onToggle?: () => void; collapseLabel?: string
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="uppercase tracking-wider text-ink-mute">{k}</span>
      <button
        type="button"
        onClick={onToggle}
        disabled={!onToggle}
        className={[
          'truncate text-right',
          accent ? 'text-foreground' : 'text-ink-mute',
          onToggle ? 'cursor-pointer hover:underline' : 'cursor-default',
        ].join(' ')}
        title={onToggle ? collapseLabel : undefined}
      >
        {v}
      </button>
    </div>
  )
}

function Act({
  icon: Icon, label, danger, disabled, onClick,
}: {
  icon: typeof Ban; label: string; danger?: boolean; disabled?: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'flex items-center gap-1 px-2 py-1 font-mono text-[10px] uppercase tracking-wider',
        'transition-colors disabled:opacity-40',
        danger ? 'text-ink-mute hover:text-scp-err' : 'text-ink-mute hover:text-foreground',
      ].join(' ')}
    >
      <Icon size={11} /> {label}
    </button>
  )
}
