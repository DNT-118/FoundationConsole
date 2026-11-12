/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
/**
 * 背景层（替代原视频背景 aurora.mp4）：
 * 按用户偏好渲染内置渐变 / 自定义图片 URL / 本地上传图片；
 * mode=default 时不渲染自定义层，仅静态光晕（.anime-bg，GPU 友好）。
 * 始终叠加暗色遮罩（dim），可加模糊，保证界面可读性。
 */
import { useMemo } from 'react'
import { useAuthStore } from '@/store/authStore'
import { bgPrefOf, getBgImage, isValidBgUrl, useBgStore, type BgPref } from '@/store/bgStore'

/** 内置渐变（克制、深色底，保证前景可读）。 */
const GRADIENTS: Record<'aurora' | 'dusk' | 'ember', string> = {
  aurora: 'linear-gradient(135deg, #0b1220 0%, #0f3a30 45%, #11584a 72%, #0b1220 100%)',
  dusk: 'linear-gradient(160deg, #191033 0%, #3b1e5e 42%, #7e2b52 76%, #221233 100%)',
  ember: 'linear-gradient(150deg, #150c0b 0%, #43150a 55%, #742a13 80%, #150c0b 100%)',
}

function layerStyle(pref: BgPref, uploadData: string | null): { background: string; blur: number } | null {
  if (pref.mode === 'aurora' || pref.mode === 'dusk' || pref.mode === 'ember') {
    return { background: GRADIENTS[pref.mode], blur: 0 }
  }
  if (pref.mode === 'url' && isValidBgUrl(pref.url)) {
    return { background: `url("${pref.url.replace(/"/g, '%22')}") center / cover no-repeat`, blur: pref.blur }
  }
  if (pref.mode === 'upload' && uploadData) {
    return { background: `url("${uploadData}") center / cover no-repeat`, blur: pref.blur }
  }
  return null
}

export default function BackgroundLayer() {
  const user = useAuthStore((s) => s.session?.username ?? '')
  const byUser = useBgStore((s) => s.byUser)
  const pref = bgPrefOf(byUser, user)
  // 上传图片本体在独立 localStorage 键（按用户）；标志变化时重读
  const uploadData = useMemo(
    () => (pref.hasImage ? getBgImage(user) : null),
    [user, pref.hasImage],
  )
  const layer = layerStyle(pref, uploadData)

  if (!layer) return <div className="anime-bg on" />

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: layer.background,
          filter: layer.blur > 0 ? `blur(${layer.blur}px)` : undefined,
          transform: layer.blur > 0 ? 'scale(1.05)' : undefined, // 模糊边缘不露白
        }}
      />
      {/* 暗色遮罩：保证文字可读（强度可调） */}
      <div className="absolute inset-0 bg-ink" style={{ opacity: Math.min(85, Math.max(0, pref.dim)) / 100 }} />
    </div>
  )
}
