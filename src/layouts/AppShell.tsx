/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
import { useEffect, useState, type ReactNode } from 'react'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import Statusbar from './Statusbar'
import AnnouncementPopup from '@/components/AnnouncementPopup'
import { useActivityTouch } from '@/hooks/useActivityTouch'
import { useAuthStore } from '@/store/authStore'
import { useServersStore } from '@/store/serversStore'
import { useThemeStore } from '@/store/themeStore'
import BackgroundLayer from '@/components/BackgroundLayer'

export default function AppShell({ children }: { children: ReactNode }) {
  // 会话空闲心跳：1 小时无操作自动登出
  useActivityTouch()
  const [serverError, setServerError] = useState<string | null>(null)
  const theme = useThemeStore((s) => s.theme)

  // 登录后从服务端拉取当前用户的服务器配置（按用户隔离，服务端加密存储）
  const session = useAuthStore((s) => s.session)
  const fetchServers = useServersStore((s) => s.fetchServers)
  useEffect(() => {
    if (session) void fetchServers().then(() => setServerError(null)).catch(e => setServerError(e.message))
  }, [session?.username, fetchServers])

  return (
    <div className={`relative z-10 flex h-screen w-screen overflow-hidden text-foreground ${theme === 'anime' ? '' : 'bg-ink'}`}>
      {/* 二次元主题背景：视频（默认）+ 弱网/弱设备自动降级静态光晕 */}
      {theme === 'anime' && <BackgroundLayer />}
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        {serverError && <div role="alert" className="flex items-center justify-between gap-2 border border-scp-err/40 p-3 text-sm text-scp-err"><span>{serverError}</span><button onClick={() => void fetchServers().then(() => setServerError(null)).catch(e => setServerError(e.message))}>重试 / Retry</button></div>}
        <main className="relative flex-1 overflow-auto grid-bg">
          <div className="mx-auto h-full max-w-[1600px] p-3 sm:p-6">{children}</div>
        </main>
        <Statusbar />
      </div>
      {/* 登录通知弹窗：公告版本高于本地已读版本时弹出（勾选「下次不再提醒」后按版本记忆） */}
      <AnnouncementPopup />
    </div>
  )
}
