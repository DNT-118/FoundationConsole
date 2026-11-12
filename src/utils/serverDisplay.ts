import type { TKey } from '@/i18n/dict'
import type { ServerState } from '@/types/api'

/**
 * 服务器状态文本的国际化显示。
 * 游戏服返回的中文文案（如"进行中""未激活"）在 normalize 时映射为稳定状态码，
 * 这里按当前语言取词；未知状态码回退显示原文，保证游戏服改文案不破 UI。
 */
type T = (k: TKey) => string

const PHASE_KEYS: Record<NonNullable<ServerState['phaseCode']>, TKey> = {
  waiting: 'dash.phase.waiting',
  inprogress: 'dash.phase.inprogress',
  ended: 'dash.phase.ended',
  paused: 'dash.phase.paused',
}

const NUKE_KEYS: Record<'inactive' | 'detonated', TKey> = {
  inactive: 'dash.nuke.inactive',
  detonated: 'dash.nuke.detonated',
}

export function phaseText(
  data: Pick<ServerState, 'phaseCode' | 'currentPhase'> | null | undefined,
  t: T,
): string {
  if (!data) return '—'
  const key = data.phaseCode ? PHASE_KEYS[data.phaseCode] : null
  return key ? t(key) : data.currentPhase || '—'
}

export function nukeText(
  data: Pick<ServerState, 'nukeCode' | 'nukeStatus' | 'nukeCountdown'> | null | undefined,
  t: T,
): string {
  if (!data) return '—'
  if (data.nukeCode === 'countdown') {
    return `${t('dash.nuke.countdown')} ${data.nukeCountdown ?? 0}s`
  }
  if (data.nukeCode) {
    return t(NUKE_KEYS[data.nukeCode])
  }
  return data.nukeStatus || '—'
}
