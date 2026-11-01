import type { FoundationStatus } from '@/types/api'
import type { ServerState } from '@/types/api'

/**
 * 基金会状态推断：
 *  - 无服务器/离线 → KETER（最高警戒）
 *  - 在线但人满 / 局势异常 → EUCLID
 *  - 在线且平稳 → SAFE
 *  - THAUMIEL 保留：管理员手动设定的实验/双活态（目前不自动触发）
 */
export function deriveStatus(state: ServerState | undefined): FoundationStatus {
  if (!state || !state.online) return 'KETER'
  const fill = state.maxPlayers > 0 ? state.playersCount / state.maxPlayers : 0
  if (fill >= 0.85) return 'EUCLID'
  return 'SAFE'
}

export const statusMeta: Record<FoundationStatus, { color: string; note: string }> = {
  SAFE:     { color: 'text-scp-safe', note: 'NORMAL OPERATIONS' },
  EUCLID:   { color: 'text-scp-warn', note: 'ELEVATED ACTIVITY' },
  KETER:    { color: 'text-scp-err',  note: 'CONTAINMENT RISK' },
  THAUMIEL: { color: 'text-white',    note: 'ACTIVE PROTOCOL' },
}
