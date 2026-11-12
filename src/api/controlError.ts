/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
/**
 * 控制调用错误对象（SLDataAPI 2.6.x 错误码对齐）。
 *
 * 上游在业务失败时返回 {success:false, message, data:{code,...}}：
 *   - 409 + code=holiday_inactive     节日功能未开启（data 带 feature/active_holiday/required）
 *   - 501 + code=feature_unavailable  当前游戏版本缺少该功能（dummies 等）
 *   - 426 + code=tls_required        上游要求 TLS（tls_mode: required）
 *   - 404 + code=transport_mismatch  传输协商（平台已自动翻转重试，一般不会透传到这里）
 * 平台自身错误（403 访客、404 服务器不存在等）没有 data.code。
 */
import type { ControlResult } from '@/types/api'

export class ControlError extends Error {
  /** 上游 HTTP 状态（0 = 传输层失败/未知）。 */
  status: number
  /** 上游机器可读错误码（data.code）；平台自身错误为空串。 */
  code: string
  /** 上游 data 字段（holiday_inactive 时含 feature/active_holiday/required）。 */
  data?: unknown

  constructor(message: string, status = 0, code = '', data?: unknown) {
    super(message)
    this.name = 'ControlError'
    this.status = status
    this.code = code
    this.data = data
  }
}

/** 已知的上游业务错误码（SLDataAPI HolidayGate / TlsPolicy / 传输协商）。 */
export const ControlErrorCode = {
  HolidayInactive: 'holiday_inactive',
  FeatureUnavailable: 'feature_unavailable',
  TlsRequired: 'tls_required',
  TransportMismatch: 'transport_mismatch',
} as const

export function isControlError(e: unknown): e is ControlError {
  return e instanceof ControlError
}

/** 从统一 ControlResult（success=false）构造 ControlError，提取 data.code 与 status。 */
export function controlErrorFrom(result: ControlResult): ControlError {
  const data = result.data && typeof result.data === 'object' ? (result.data as Record<string, unknown>) : undefined
  const code = typeof data?.code === 'string' ? data.code : ''
  return new ControlError(result.message || '操作失败', result.status ?? 0, code, result.data)
}

/**
 * 节日门控失败（409 holiday_inactive）时提取结构化信息；
 * 否则返回 null。UI 据此展示"节日未开启 + 当前节日"的友好提示，而不是裸错误文本。
 */
export function holidayInactiveInfo(e: unknown): { feature: string; activeHoliday: string; required: string[] } | null {
  if (!isControlError(e) || e.code !== ControlErrorCode.HolidayInactive) return null
  const d = e.data && typeof e.data === 'object' ? (e.data as Record<string, unknown>) : {}
  return {
    feature: typeof d.feature === 'string' ? d.feature : '',
    activeHoliday: typeof d.active_holiday === 'string' ? d.active_holiday : '',
    required: Array.isArray(d.required) ? d.required.map(String) : [],
  }
}
