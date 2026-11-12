import ErrorBoundary from '@/components/ErrorBoundary'
import { useServersStore } from '@/store/serversStore'
/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
import { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import RequireAuth from '@/components/RequireAuth'
import AppShell from '@/layouts/AppShell'
import { useAuthStore } from '@/store/authStore'

const Login = lazy(() => import('@/pages/Login'))
const Register = lazy(() => import('@/pages/Register'))
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Announcement = lazy(() => import('@/pages/Announcement'))
const Servers = lazy(() => import('@/pages/Servers'))
const Players = lazy(() => import('@/pages/Players'))
const Plugins = lazy(() => import('@/pages/Plugins'))
const RemoteAdmin = lazy(() => import('@/pages/RemoteAdmin'))
const Console = lazy(() => import('@/pages/Console'))
const Map = lazy(() => import('@/pages/Map'))
const Voice = lazy(() => import('@/pages/Voice'))
const Logs = lazy(() => import('@/pages/Logs'))
const Reports = lazy(() => import('@/pages/Reports'))
const Events = lazy(() => import('@/pages/Events'))
const BanList = lazy(() => import('@/pages/BanList'))
const Files = lazy(() => import('@/pages/Files'))
const Api = lazy(() => import('@/pages/Api'))
const Settings = lazy(() => import('@/pages/Settings'))
const About = lazy(() => import('@/pages/About'))
const Notifications = lazy(() => import('@/pages/Notifications'))
const Schedules = lazy(() => import('@/pages/Schedules'))

const Fallback = () => (
  <div className="flex h-full items-center justify-center text-ink-mute font-mono text-xs">
    LOADING…
  </div>
)

const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}
const pageTransition = { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const }

export default function App() {
  const location = useLocation()
  const activeId = useServersStore(s => s.activeId)
  const ready = useAuthStore((s) => s.ready)
  const restore = useAuthStore((s) => s.restore)

  // 启动时用 HttpOnly cookie 恢复会话；完成前保持 LOADING，避免未登录闪跳
  useEffect(() => {
    void restore()
  }, [restore])

  if (!ready) return <Fallback />

  return (
    <AnimatePresence mode="wait">
      {location.pathname === '/login' || location.pathname === '/register' ? (
        <Suspense fallback={<Fallback />}>
          <Routes location={location} key="auth">
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
          </Routes>
        </Suspense>
      ) : (
        <RequireAuth key="app">
          <AppShell>
            <AnimatePresence mode="wait">
              <motion.div
                key={`${location.pathname}:${activeId}`}
                initial={pageVariants.initial}
                animate={pageVariants.animate}
                exit={pageVariants.exit}
                transition={pageTransition}
                className="h-full"
              >
                {/* Suspense 放在布局内部、只包页面区域：chunk 加载时侧栏/状态栏
                    保持挂载，不会整屏黑掉（页面 chunk 由导航悬停按需预取） */}
                <Suspense fallback={<Fallback />}>
                  <ErrorBoundary key={`${location.pathname}:${activeId}`}><Routes location={location}>
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/announcement" element={<Announcement />} />
                    <Route path="/servers" element={<Servers />} />
                    <Route path="/players" element={<Players />} />
                    <Route path="/plugins" element={<Plugins />} />
                    <Route path="/remoteadmin" element={<RemoteAdmin />} />
                    <Route path="/console" element={<Console />} />
                    <Route path="/map" element={<Map />} />
                    <Route path="/voice" element={<Voice />} />
                    <Route path="/logs" element={<Logs />} />
                    <Route path="/reports" element={<Reports />} />
                    <Route path="/events" element={<Events />} />
                    <Route path="/notifications" element={<Notifications />} />
                    <Route path="/schedules" element={<Schedules />} />
                    <Route path="/banlist" element={<BanList />} />
                    <Route path="/files" element={<Files />} />
                    <Route path="/api" element={<Api />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/about" element={<About />} />
                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                  </Routes></ErrorBoundary>
                </Suspense>
              </motion.div>
            </AnimatePresence>
          </AppShell>
        </RequireAuth>
      )}
    </AnimatePresence>
  )
}
