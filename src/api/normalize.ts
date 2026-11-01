import type {
  SlPlayer,
  SlServerData,
  Player,
  ServerState,
  Team,
  AdaptedPlugin,
  DntofPluginsState,
} from '@/types/api'

/** Matches SLDataAPI DataCollector.GetTeamCN output. */
const teamMap: Record<string, Team> = {
  D级: 'D-Class',
  混沌: 'Chaos',
  基金会: 'Foundation',
  SCP: 'SCP',
  观察者: 'Spectator',
  其他: 'Unknown',
  未知: 'Unknown',
  // English / legacy fallbacks
  'D-Class': 'D-Class',
  ClassD: 'D-Class',
  Chaos: 'Chaos',
  ChaosInsurgency: 'Chaos',
  Foundation: 'Foundation',
  FoundationForces: 'Foundation',
  Spectator: 'Spectator',
  Dead: 'Spectator',
}

function normalizeTeam(raw: string): Team {
  return teamMap[raw] ?? 'Unknown'
}

function normalizePlayer(p: SlPlayer): Player {
  return {
    nickname: p.nickname,
    role: p.role,
    team: normalizeTeam(p.team),
    steamId: p.steam_id ?? '',
    x: p.x ?? 0,
    y: p.y ?? 0,
    z: p.z ?? 0,
  }
}

function normalizeDntof(raw: SlServerData['dntof_plugins']): DntofPluginsState {
  if (!raw) return {}
  const sl = raw.sl_player
  const omega = raw.omega_warhead
  return {
    slPlayer: sl
      ? {
          present: sl.present,
          sourceMode: sl.source_mode,
          remoteUrl: sl.remote_url,
          nowPlaying: sl.now_playing,
        }
      : sl === null
        ? null
        : undefined,
    omegaWarhead: omega
      ? {
          present: omega.present,
          phase: omega.phase,
          coinHolders: (omega.coin_holders ?? []).map((c) => ({
            nickname: c.nickname,
            count: c.count,
            position: c.position,
          })),
          controllerHolder: omega.controller_holder,
          countdown: omega.countdown,
        }
      : omega === null
        ? null
        : undefined,
  }
}

function normalizeAdapted(list: SlServerData['adapted_plugins']): AdaptedPlugin[] {
  return (list ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    version: p.version,
    capabilities: p.capabilities ?? [],
    routes: p.routes ?? [],
    actions: p.actions,
    status: p.status,
  }))
}

export function normalizeServerData(
  raw: SlServerData,
  id = 'primary',
): ServerState {
  const players = (raw.players ?? []).map(normalizePlayer)
  const chaosFromList = players.filter((p) => p.team === 'Chaos').length
  const dFromList = players.filter((p) => p.team === 'D-Class').length

  const teamCounts: Record<Team, number> = {
    'D-Class': dFromList || Math.max(0, (raw.d_count ?? 0) - chaosFromList),
    Chaos: chaosFromList,
    Foundation: raw.foundation_count ?? 0,
    SCP: raw.scp_count ?? 0,
    Spectator: raw.spectator_count ?? 0,
    Unknown: players.filter((p) => p.team === 'Unknown').length,
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
    voicePort: raw.voice_port ?? 0,
    gameVersion: raw.game_version ?? '',
    activeHoliday: raw.active_holiday ?? 'None',
    teamCounts,
    ping: raw.ping,
    players,
    dntofPlugins: normalizeDntof(raw.dntof_plugins),
    adaptedPlugins: normalizeAdapted(raw.adapted_plugins),
    fetchedAt: Date.now(),
  }
}
