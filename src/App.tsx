import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import AppShell from '@/layouts/AppShell'

// 路由级懒加载，高内聚低耦合
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Servers = lazy(() => import('@/pages/Servers'))
const Players = lazy(() => import('@/pages/Players'))
const Plugins = lazy(() => import('@/pages/Plugins'))
const RemoteAdmin = lazy(() => import('@/pages/RemoteAdmin'))
const Console = lazy(() => import('@/pages/Console'))
const Logs = lazy(() => import('@/pages/Logs'))
const BanList = lazy(() => import('@/pages/BanList'))
const Files = lazy(() => import('@/pages/Files'))
const Api = lazy(() => import('@/pages/Api'))
const Settings = lazy(() => import('@/pages/Settings'))
const About = lazy(() => import('@/pages/About'))

const Fallback = () => (
  <div className="flex h-full items-center justify-center text-ink-mute font-mono text-xs">
    LOADING…
  </div>
)

export default function App() {
  return (
    <AppShell>
      <Suspense fallback={<Fallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/servers" element={<Servers />} />
          <Route path="/players" element={<Players />} />
          <Route path="/plugins" element={<Plugins />} />
          <Route path="/remoteadmin" element={<RemoteAdmin />} />
          <Route path="/console" element={<Console />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/banlist" element={<BanList />} />
          <Route path="/files" element={<Files />} />
          <Route path="/api" element={<Api />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  )
}
