import type { FoundationStatus, ServerState } from '@/types/api'

/**
 * 基金会状态推断：
 *  - 无服务器/离线 → KETER
 *  - 核弹倒计时 / Omega 锁定或引爆中 → KETER
 *  - 人满 / 核弹未激活但 Omega 收集中 / 万圣节等活跃节日 → EUCLID
 *  - 在线且平稳 → SAFE
 *  - THAUMIEL 保留：管理员手动设定（目前不自动触发）
 */
export function deriveStatus(state: ServerState | undefined): FoundationStatus {
  if (!state || !state.online) return 'KETER'

  const nuke = state.nukeStatus ?? ''
  if (nuke.includes('倒计时') || nuke.includes('已爆炸')) return 'KETER'

  const omega = state.dntofPlugins.omegaWarhead
  if (omega?.present && ['locked', 'counting', 'detonation', 'confirming'].includes(omega.phase)) {
    return 'KETER'
  }

  const fill = state.maxPlayers > 0 ? state.playersCount / state.maxPlayers : 0
  if (fill >= 0.85) return 'EUCLID'
  if (omega?.present && ['collecting', 'idle_holding'].includes(omega.phase)) return 'EUCLID'
  if (state.activeHoliday && state.activeHoliday !== 'None') return 'EUCLID'

  return 'SAFE'
}

export const statusMeta: Record<FoundationStatus, { color: string; note: string }> = {
  SAFE: { color: 'text-scp-safe', note: 'NORMAL OPERATIONS' },
  EUCLID: { color: 'text-scp-warn', note: 'ELEVATED ACTIVITY' },
  KETER: { color: 'text-scp-err', note: 'CONTAINMENT RISK' },
  THAUMIEL: { color: 'text-white', note: 'ACTIVE PROTOCOL' },
}
