import type { SlPlayer, SlServerData, Player, ServerState, Team } from '@/types/api'

const teamMap: Record<string, Team> = {
  'D级': 'D-Class',
  SCP: 'SCP',
  基金会: 'Foundation',
  '九尾狐': 'Foundation',
  观众: 'Spectator',
}

function normalizeTeam(raw: string): Team {
  return teamMap[raw] ?? 'Unknown'
}

function normalizePlayer(p: SlPlayer): Player {
  return {
    nickname: p.nickname,
    role: p.role,
    team: normalizeTeam(p.team),
  }
}

export function normalizeServerData(
  raw: SlServerData,
  id = 'primary',
): ServerState {
  const players = raw.players.map(normalizePlayer)

  const teamCounts: Record<Team, number> = {
    'D-Class': raw.d_count,
    Foundation: raw.foundation_count,
    SCP: raw.scp_count,
    Spectator: raw.spectator_count,
    Unknown: 0,
  }

  return {
    id,
    name: raw.server_name,
    online: raw.online,
    playersCount: raw.players_count,
    maxPlayers: raw.max_players,
    roundStarted: raw.round_started,
    roundDuration: raw.round_duration,
    currentPhase: raw.current_phase,
    nukeStatus: raw.nuke_status,
    nukeCountdown: raw.nuke_countdown,
    teamCounts,
    ping: raw.ping,
    players,
    fetchedAt: Date.now(),
  }
}
