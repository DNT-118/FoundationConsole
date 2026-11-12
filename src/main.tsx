import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { IS_DEMO } from './demo/mode'
import { seedDemoServer } from './demo/seed'

if (IS_DEMO) seedDemoServer()

// 演示版部署在子路径（如 /FoundationConsole/），路由需要 basename
const routerBase = IS_DEMO ? import.meta.env.BASE_URL.replace(/\/$/, '') || undefined : undefined

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 4_000,
      gcTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={routerBase}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
