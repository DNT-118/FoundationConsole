import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'

/** 未登录则重定向到 /login。 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const session = useAuthStore((s) => s.session)
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}
