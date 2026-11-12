import type {
  DntofInfo,
  SlPlayer,
  SlServerData,
  Player,
  ServerState,
  Team,
} from '@/types/api'

const teamMap: Record<string, Team> = {
  'D级': 'D-Class',
  SCP: 'SCP',
  基金会: 'Foundation',
  '九尾狐': 'Foundation',
  观众: 'Spectator',
}

/** 剥离 SCPSL 富文本标签：<color=#...> <size=N> <b> <i> 等，并去首尾空白。 */
const RICH_TAG_RE = /<\/?(color|size|b|i|u|align|lineheight|mspace|cspace|indent|margin|pos|noparse)[^>]*>/gi
export function stripRichText(raw: string): string {
  return raw.replace(RICH_TAG_RE, '').trim()
}

function normalizeTeam(raw: string): Team {
  return teamMap[raw] ?? 'Unknown'
}

function normalizePlayer(p: SlPlayer): Player {
  return {
    nickname: p.nickname,
    role: p.role,
    team: normalizeTeam(p.team),
    steamId: p.steam_id || undefined,
    x: p.x,
    y: p.y,
    z: p.z,
  }
}

/** 回合阶段码（游戏服返回中文文案，映射为稳定枚举供 UI 翻译）。 */
export function phaseCode(raw: string): 'waiting' | 'inprogress' | 'ended' | 'paused' | null {
  if (raw.includes('等待')) return 'waiting'
  if (raw.includes('进行')) return 'inprogress'
  if (raw.includes('结束')) return 'ended'
  if (raw.includes('暂停')) return 'paused'
  return null
}

/** 核弹状态码（倒计时详情用 nukeCountdown 秒数渲染）。 */
export function nukeCode(raw: string): 'inactive' | 'countdown' | 'detonated' | null {
  if (raw.includes('未激活')) return 'inactive'
  if (raw.includes('倒计时')) return 'countdown'
  if (raw.includes('爆炸')) return 'detonated'
  return null
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

  const phase = stripRichText(raw.current_phase)
  const nuke = stripRichText(raw.nuke_status)

  return {
    id,
    name: stripRichText(raw.server_name),
    online: raw.online,
    playersCount: raw.players_count,
    maxPlayers: raw.max_players,
    roundStarted: raw.round_started,
    roundDuration: raw.round_duration,
    currentPhase: phase,
    phaseCode: phaseCode(phase),
    nukeStatus: nuke,
    nukeCode: nukeCode(nuke),
    nukeCountdown: raw.nuke_countdown,
    teamCounts,
    ping: raw.ping,
    players,
    fetchedAt: Date.now(),
    dntof: (raw.dntof_plugins as DntofInfo | null | undefined) ?? null,
    adaptedPlugins: raw.adapted_plugins ?? [],
    voicePort: raw.voice_port ?? 0,
  }
}
