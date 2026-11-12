/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
/**
 * 背景偏好（按用户保存在浏览器 localStorage，不上传服务器）。
 * mode：
 *  - default   无自定义背景（纯色/渐变主题色，仅静态光晕）
 *  - aurora/dusk/ember  内置渐变
 *  - url       自定义图片 URL（仅 http/https，受 CSP img-src 约束）
 *  - upload    本地上传图片（data URL 存 localStorage，文件 ≤2MB）
 * dim：暗色遮罩强度（0-85%）；blur：背景模糊 px（0-16）。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type BgMode = 'default' | 'aurora' | 'dusk' | 'ember' | 'url' | 'upload'

export interface BgPref {
  mode: BgMode
  url: string
  /** 本地上传图片是否存在（图片本体存独立 localStorage 键，避免 2MB 数据随偏好反复序列化） */
  hasImage?: boolean
  /** 暗色遮罩强度百分比（0-85）。 */
  dim: number
  /** 背景模糊（px，0-16）。 */
  blur: number
}

export const BG_DEFAULT: BgPref = { mode: 'default', url: '', hasImage: false, dim: 45, blur: 0 }

/** 本地上传图片的文件大小上限（2MB）。 */
export const BG_UPLOAD_MAX_BYTES = 2 * 1024 * 1024

/** URL 仅允许 http/https（CSP img-src 同步约束）。 */
export function isValidBgUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** 上传图片本体：独立 localStorage 键（按用户），data URL（≤2MB 文件）。 */
const bgImgKey = (user: string) => `pfc.bg.img.${encodeURIComponent(user || '@anon')}`

export function getBgImage(user: string): string | null {
  try { return localStorage.getItem(bgImgKey(user)) } catch { return null }
}

export function setBgImage(user: string, dataUrl: string | null): void {
  try {
    if (dataUrl) localStorage.setItem(bgImgKey(user), dataUrl)
    else localStorage.removeItem(bgImgKey(user))
  } catch { /* 配额满：调用方应先做过大小校验；这里静默（保持当前背景） */ }
}

interface BgState {
  byUser: Record<string, BgPref>
  set: (user: string, patch: Partial<BgPref>) => void
}

export const useBgStore = create<BgState>()(
  persist(
    (set) => ({
      byUser: {},
      set: (user, patch) =>
        set((s) => {
          const prev = s.byUser[user] ?? BG_DEFAULT
          return { byUser: { ...s.byUser, [user]: { ...prev, ...patch } } }
        }),
    }),
    { name: 'pfc.bg' },
  ),
)

/** 读取某用户的偏好（未设置过返回默认）。 */
export function bgPrefOf(byUser: Record<string, BgPref>, user: string | undefined): BgPref {
  return (user && byUser[user]) || BG_DEFAULT
}
