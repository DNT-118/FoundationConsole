/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
import { useEffect, useRef, useState } from 'react'

/**
 * 二次元视频背景：默认播放。
 * 仅「用户手动关闭」降级为静态光晕 —— 不做任何网络状态判断（Edge 的
 * navigator.connection 上报不稳定，误降级导致视频不播）。
 * 静音循环：muted 用 ref 强制设置（React muted prop 有时不落 DOM 属性，
 * 浏览器会当有声 autoplay 拦截 —— Edge 常见）。
 * 若 autoplay 被浏览器策略拦截（如省电/节能模式），在用户首次点击/滚动后
 * 自动尝试恢复播放，绕过策略。
 */
export default function AnimeVideoBg() {
  const [fallback, setFallback] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const retried = useRef(false)

  // 用户手动关闭 → 静态光晕；不做网络检测
  useEffect(() => {
    let userOff = false
    try { userOff = localStorage.getItem('pfc.animeVideo') === '0' } catch { /* ignore */ }
    if (userOff) setFallback(true)
  }, [])

  // 挂载后强制 muted + 播放；被拦则在用户交互后重试
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = true
    v.defaultMuted = true
    const tryPlay = () => {
      void v.play().then(() => {
        if (!v.muted) v.muted = true
      }).catch(() => {
        v.muted = true
        void v.play().catch(() => { /* 留给交互后重试 */ })
      })
    }
    tryPlay()
    // 用户首次交互（点击/滚动/按键）后重试播放（绕过 autoplay 策略）
    const resume = () => { tryPlay() }
    window.addEventListener('pointerdown', resume, { once: true })
    window.addEventListener('scroll', resume, { once: true })
    return () => {
      window.removeEventListener('pointerdown', resume)
      window.removeEventListener('scroll', resume)
    }
  }, [])

  function onError() {
    // 首次错误：reload 重试；二次才降级
    if (!retried.current) {
      retried.current = true
      const v = videoRef.current
      if (v) { v.load() }
      return
    }
    setFallback(true)
  }

  if (fallback) return <div className="anime-bg on" />

  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        src="/video/aurora.mp4?v=1"
        onError={onError}
      />
      {/* 暗色遮罩：保证文字可读 */}
      <div className="absolute inset-0 bg-ink/60" />
    </div>
  )
}
