/** SLDataAPI response shape — mirrors DNTOF/SLDataAPI Data/Models.cs (get_sl_data). */

export interface SlPlayer {
  nickname: string
  steam_id?: string
  role: string
  team: string
  x?: number
  y?: number
  z?: number
}

export interface SlAdaptedPlugin {
  id: string
  name: string
  version: string
  capabilities?: string[]
  routes?: string[]
  actions?: string[]
  status?: unknown
}

export interface SlCoinHolder {
  nickname: string
  count: number
  position: string
}

export interface SlPlayerPluginInfo {
  present: boolean
  source_mode: string
  remote_url?: string | null
  now_playing?: string | null
}

export interface SlOmegaWarheadInfo {
  present: boolean
  phase: string
  coin_holders?: SlCoinHolder[]
  controller_holder?: string | null
  countdown?: number | null
}

export interface SlDntofPlugins {
  sl_player?: SlPlayerPluginInfo | null
  omega_warhead?: SlOmegaWarheadInfo | null
}

export interface SlServerData {
  success: boolean
  server_name: string
  online: boolean
  players_count: number
  max_players: number
  round_started: boolean
  round_duration: number
  current_phase: string
  nuke_status: string
  nuke_countdown: number
  voice_port?: number
  game_version?: string
  active_holiday?: string
  d_count: number
  foundation_count: number
  scp_count: number
  spectator_count: number
  ping: number
  players: SlPlayer[]
  dntof_plugins?: SlDntofPlugins
  adapted_plugins?: SlAdaptedPlugin[]
}

/** Normalized domain model used across the UI. */
export type Team = 'D-Class' | 'Chaos' | 'Foundation' | 'SCP' | 'Spectator' | 'Unknown'
export type FoundationStatus = 'SAFE' | 'EUCLID' | 'KETER' | 'THAUMIEL'

export interface Player {
  nickname: string
  role: string
  team: Team
  steamId: string
  x: number
  y: number
  z: number
  ping?: number
  duration?: number
}

export interface AdaptedPlugin {
  id: string
  name: string
  version: string
  capabilities: string[]
  routes: string[]
  actions?: string[]
  status?: unknown
}

export interface DntofPluginsState {
  slPlayer?: {
    present: boolean
    sourceMode: string
    remoteUrl?: string | null
    nowPlaying?: string | null
  } | null
  omegaWarhead?: {
    present: boolean
    phase: string
    coinHolders: { nickname: string; count: number; position: string }[]
    controllerHolder?: string | null
    countdown?: number | null
  } | null
}

export interface ServerState {
  id: string
  name: string
  online: boolean
  playersCount: number
  maxPlayers: number
  roundStarted: boolean
  roundDuration: number
  currentPhase: string
  nukeStatus: string
  nukeCountdown: number
  voicePort: number
  gameVersion: string
  activeHoliday: string
  teamCounts: Record<Team, number>
  ping: number
  players: Player[]
  dntofPlugins: DntofPluginsState
  adaptedPlugins: AdaptedPlugin[]
  /** When this snapshot was fetched. */
  fetchedAt: number
}
