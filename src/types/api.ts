/** SLDataAPI response shape — mirrors DNTOF/SLDataAPI /get_sl_data */

export interface SlPlayer {
  nickname: string
  role: string
  team: string
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
  d_count: number
  foundation_count: number
  scp_count: number
  spectator_count: number
  ping: number
  players: SlPlayer[]
}

/** Normalized domain model used across the UI. */
export type Team = 'D-Class' | 'Foundation' | 'SCP' | 'Spectator' | 'Unknown'
export type FoundationStatus = 'SAFE' | 'EUCLID' | 'KETER' | 'THAUMIEL'

export interface Player {
  nickname: string
  role: string
  team: Team
  /** Source API exposes no per-player ping/steamId yet — reserved for future. */
  steamId?: string
  ping?: number
  duration?: number
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
  teamCounts: Record<Team, number>
  ping: number
  players: Player[]
  /** When this snapshot was fetched. */
  fetchedAt: number
}
