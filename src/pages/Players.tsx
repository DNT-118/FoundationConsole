import { useMemo, useState } from 'react'
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel,
  type ColumnDef, type SortingState,
} from '@tanstack/react-table'
import { Search, Ban, VolumeX, LogOut, MessageSquare } from 'lucide-react'
import PageStub from '@/components/PageStub'
import { useServerQuery } from '@/hooks/useServerQuery'
import type { Player, Team } from '@/types/api'

const teamColor: Record<Team, string> = {
  'D-Class': 'text-scp-warn',
  Chaos: 'text-scp-warn',
  Foundation: 'text-white',
  SCP: 'text-scp-err',
  Spectator: 'text-ink-mute',
  Unknown: 'text-ink-mute',
}

export default function Players() {
  const { data } = useServerQuery()
  const players = data?.players ?? []
  const [global, setGlobal] = useState('')
  const [sorting, setSorting] = useState<SortingState>([])

  const columns = useMemo<ColumnDef<Player>[]>(
    () => [
      { accessorKey: 'nickname', header: 'Nickname' },
      { accessorKey: 'role', header: 'Role' },
      { accessorKey: 'team', header: 'Team' },
      { accessorKey: 'steamId', header: 'SteamID' },
    ],
    [],
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
    <PageStub code="M-03" title="Players">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-mute">
            {players.length} online
          </span>
          <div className="flex items-center gap-2 border border-ink-border bg-ink-deep px-2 py-1">
            <Search size={12} className="text-ink-mute" />
            <input
              value={global}
              onChange={(e) => setGlobal(e.target.value)}
              placeholder="filter…"
              className="bg-transparent font-mono text-[12px] text-white placeholder:text-ink-mute focus:outline-none"
            />
          </div>
        </div>

        {players.length === 0 ? (
          <div className="border border-dashed border-ink-border px-4 py-16 text-center font-mono text-[12px] text-ink-mute">
            // no players — server offline or empty round
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {table.getRowModel().rows.map((row) => (
              <PlayerCard key={row.id} player={row.original} />
            ))}
          </div>
        )}
      </div>
    </PageStub>
  )
}

function PlayerCard({ player }: { player: Player }) {
  return (
    <div className="border border-ink-border bg-ink-deep p-4 transition-colors hover:border-ink-mute">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="truncate font-mono text-[13px] text-white">{player.nickname}</div>
          <div className={`mt-0.5 font-mono text-[10px] uppercase tracking-wider ${teamColor[player.team]}`}>
            {player.team}
          </div>
        </div>
        <div className="grid h-8 w-8 shrink-0 place-items-center border border-ink-border bg-ink font-mono text-[11px] text-ink-mute">
          {player.nickname.slice(0, 2).toUpperCase()}
        </div>
      </div>

      <dl className="mt-3 space-y-1 font-mono text-[11px]">
        <Row k="Role" v={player.role} />
        <Row k="Team" v={player.team} />
        <Row k="SteamID" v={player.steamId || '—'} accent />
        <Row
          k="Pos"
          v={`${player.x.toFixed(1)}, ${player.y.toFixed(1)}, ${player.z.toFixed(1)}`}
        />
      </dl>

      <div className="mt-3 flex items-center gap-2 border-t border-ink-border pt-3">
        <Act icon={LogOut} label="Kick" />
        <Act icon={Ban} label="Ban" danger />
        <Act icon={VolumeX} label="Mute" />
        <Act icon={MessageSquare} label="Msg" />
      </div>
    </div>
  )
}

function Row({
  k, v, accent,
}: {
  k: string; v: string; accent?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="uppercase tracking-wider text-ink-mute">{k}</span>
      <span className={['truncate text-right', accent ? 'text-white' : 'text-ink-mute'].join(' ')}>
        {v}
      </span>
    </div>
  )
}

function Act({
  icon: Icon, label, danger,
}: { icon: typeof Ban; label: string; danger?: boolean }) {
  return (
    <button
      className={[
        'flex items-center gap-1 px-2 py-1 font-mono text-[10px] uppercase tracking-wider',
        'transition-colors',
        danger
          ? 'text-ink-mute hover:text-scp-err'
          : 'text-ink-mute hover:text-white',
      ].join(' ')}
      title={`${label} (reserved)`}
    >
      <Icon size={11} /> {label}
    </button>
  )
}
