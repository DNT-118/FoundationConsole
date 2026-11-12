/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
/**
 * 控制调用的用户可见提示：把 SLDataAPI 2.6.x 的结构化错误码
 * （409 holiday_inactive / 501 feature_unavailable / 426 tls_required）
 * 翻译成本地化文案；其余错误原样透出（上游 message 已可读）。
 */
import { holidayInactiveInfo, isControlError } from '../api/controlError.ts'
import type { TKey } from '@/i18n/dict'

type T = (key: TKey) => string

/** {name} 占位填充（未提供的占位保留原样，便于发现字段缺失）。 */
export function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => params[k] ?? m)
}

/** 节日码 → 本地化名（未知码原样显示）。 */
export function holidayLabel(code: string, t: T): string {
  switch ((code || '').trim()) {
    case 'Christmas': return t('holiday.Christmas')
    case 'Halloween': return t('holiday.Halloween')
    case 'AprilFools': return t('holiday.AprilFools')
    case '': case 'None': return t('holiday.None')
    default: return code
  }
}

/**
 * 控制调用异常 → 展示文本。
 * holiday_inactive：显示"需要什么节日 / 当前节日"；feature_unavailable / tls_required：固定提示。
 */
export function describeControlError(e: unknown, t: T): string {
  const info = holidayInactiveInfo(e)
  if (info) {
    const required = info.required.length > 0
      ? info.required.map((h) => holidayLabel(h, t)).join(' / ')
      : t('holiday.None')
    return fill(t('err.holidayInactive'), { required, active: holidayLabel(info.activeHoliday, t) })
  }
  if (isControlError(e)) {
    if (e.code === 'feature_unavailable') return t('err.featureUnavailable')
    if (e.code === 'tls_required') return t('err.tlsRequired')
  }
  return e instanceof Error ? e.message : String(e)
}
