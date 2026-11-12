import { MotionConfig } from 'framer-motion'
import { useAuthStore } from '@/store/authStore'
import { ApiError } from '@/api/request'
/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { IS_DEMO } from '@/demo/mode'
import DemoBanner from '@/demo/DemoBanner'
import { installMockBackend } from '@/demo/mockBackend'
import '@/store/themeStore' // 主题模块副作用：模块加载即应用持久化主题（防闪白）

// 演示版：安装浏览器内模拟后端（拦截同源 /api/*，数据存 localStorage），必须在任何请求之前
if (IS_DEMO) installMockBackend(import.meta.env.BASE_URL)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 4_000,
      gcTime: 60_000,
      retry: (count, error) => count < 1 && !(error instanceof ApiError && [400, 401, 403, 404, 501].includes(error.status)),
      refetchOnWindowFocus: false,
    },
  },
})

useAuthStore.subscribe((state, previous) => {
  if (state.session?.username !== previous.session?.username) queryClient.clear()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user"><BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
        {IS_DEMO ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
            <DemoBanner />
            <div style={{ position: 'relative', flex: '1 1 auto', minHeight: 0 }}>
              <App />
            </div>
          </div>
        ) : (
          <App />
        )}
      </BrowserRouter></MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
)
