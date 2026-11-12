import type { FoundationStatus, ServerState } from '@/types/api'

/**
 * 基金会状态推断（全部绑定服务器的可达性聚合）：
 *  - 所有服务器正常上线 → SAFE
 *  - 部分服务器不可达 → EUCLID
 *  - 所有服务器不可达 → KETER
 *  - 未绑定任何服务器 → SAFE（无故障对象）
 * 等级词固定英文显示（SAFE/EUCLID/KETER），不随界面语言翻译。
 */
export interface FleetEntry {
  data?: ServerState | undefined
  isError?: boolean
}

export function deriveFleetStatus(entries: FleetEntry[]): FoundationStatus {
  if (entries.length === 0) return 'SAFE'
  const reachable = entries.filter((e) => e?.data?.online === true).length
  if (reachable === 0) return 'KETER'
  if (reachable === entries.length) return 'SAFE'
  return 'EUCLID'
}

/** 等级词固定英文（用户要求不分语言）。 */
export const statusLabel: Record<FoundationStatus, string> = {
  SAFE: 'SAFE',
  EUCLID: 'EUCLID',
  KETER: 'KETER',
  THAUMIEL: 'THAUMIEL',
}

export const statusMeta: Record<FoundationStatus, { color: string; note: string }> = {
  SAFE:     { color: 'text-scp-safe', note: 'NORMAL OPERATIONS' },
  EUCLID:   { color: 'text-scp-warn', note: 'ELEVATED ACTIVITY' },
  KETER:    { color: 'text-scp-err',  note: 'CONTAINMENT RISK' },
  THAUMIEL: { color: 'text-foreground', note: 'ACTIVE PROTOCOL' },
}
