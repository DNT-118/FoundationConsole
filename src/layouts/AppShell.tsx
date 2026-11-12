import type { ReactNode } from 'react'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import Statusbar from './Statusbar'
import { IS_DEMO } from '@/demo/mode'
import DemoBanner from '@/demo/DemoBanner'

export default function AppShell({ children }: { children: ReactNode }) {
  if (IS_DEMO) {
    // 演示版：警示栏在最上方占位，下方整体布局被推下，不遮挡内容
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-ink text-white">
        <DemoBanner />
        <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
          <Shell>{children}</Shell>
        </div>
      </div>
    )
  }
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-ink text-white">
      <Shell>{children}</Shell>
    </div>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="relative flex-1 overflow-auto grid-bg">
          <div className="mx-auto h-full max-w-[1600px] p-6">{children}</div>
        </main>
        <Statusbar />
      </div>
    </>
  )
}
