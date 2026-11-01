import type { ReactNode } from 'react'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import Statusbar from './Statusbar'

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-ink text-white">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="relative flex-1 overflow-auto grid-bg">
          <div className="mx-auto h-full max-w-[1600px] p-6">{children}</div>
        </main>
        <Statusbar />
      </div>
    </div>
  )
}
