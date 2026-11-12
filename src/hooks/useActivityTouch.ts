import { useEffect } from 'react'
import { useAuthStore } from '@/store/authStore'

/**
 * 全局用户活动监听：把"使用中"事件（点击/按键/滚轮/触摸）转成会话心跳，
 * 配合 authStore.touch 实现"1 小时无操作自动登出"（滑动过期）。
 * 挂在登录后的 AppShell 上即可；不含 mousemove（过于频繁）。
 */
export function useActivityTouch() {
  const touch = useAuthStore((s) => s.touch)

  useEffect(() => {
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart']
    const handler = () => touch()
    for (const e of events) window.addEventListener(e, handler, { passive: true })
    return () => {
      for (const e of events) window.removeEventListener(e, handler)
    }
  }, [touch])
}
