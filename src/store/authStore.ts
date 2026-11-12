/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
import { create } from 'zustand'
import { api } from '@/api/platform'
import type { UserRole } from '@/lib/vault'

/**
 * 会话空闲过期时间：1 小时没有任何用户操作自动登出。
 * 安全说明：会话载体是服务端下发的 HttpOnly cookie（前端 JS 不可读，XSS 无法窃取）。
 * 本 store 只保留内存态会话信息；页面刷新后通过 cookie 调用 /api/me 自动恢复。
 */
export const SESSION_TTL_MS = 60 * 60 * 1000
/** touch 节流：节流窗口内多次活动只更新一次 lastActive。 */
const TOUCH_THROTTLE_MS = 60 * 1000

export interface Session {
  username: string
  /** 角色：admin（管理账号）/ user（控制功能）/ guest（只读）。 */
  role: UserRole
  email?: string
  /** 平台会话 token（内存态；服务端同时下发 HttpOnly cookie，刷新后靠 cookie 恢复）。 */
  token: string
  loggedAt: number
  /** 最后一次用户活动时间（滑动过期基准）。 */
  lastActive: number
}

interface AuthState {
  session: Session | null
  /** 启动恢复完成（restore 已返回）前为 false，避免未登录闪跳。 */
  ready: boolean
  /** 非空 = 会话因空闲超时被清除（登录页据此显示"会话已过期"提示）。 */
  expiredAt: number | null
  /**
   * 登录第一步。返回 pending2fa=true 时（用户已启用双因素），
   * 调用方应引导输入 6 位动态码后调 /auth/2fa/verify 完成登录。
   */
  signIn: (identifier: string, password: string) => Promise<{ pending2fa?: boolean; username?: string }>
  signOut: () => void
  /** 用户活动心跳：节流更新 lastActive；若已超时则清除会话。 */
  touch: () => void
  /** 注册/2FA 验证成功后直接建立会话。 */
  establish: (token: string, user: { username: string; role: UserRole; email?: string }) => void
  /** 应用启动时用 HttpOnly cookie 尝试恢复会话。 */
  restore: () => Promise<void>
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  session: null,
  ready: false,
  expiredAt: null,

  signIn: async (identifier, password) => {
    const r = await api<{
      token?: string
      pending2fa?: boolean
      username?: string
      user?: { username: string; role: UserRole; email?: string }
    }>('/auth/login', { method: 'POST', body: { identifier, password } })

    // 已启用双因素：第一步只返回 pending2fa，不发会话
    if (r.pending2fa) {
      return { pending2fa: true, username: r.username }
    }
    if (!r.token || !r.user) {
      throw new Error('登录响应异常')
    }
    const now = Date.now()
    set({
      session: {
        username: r.user.username,
        role: r.user.role,
        email: r.user.email,
        token: r.token,
        loggedAt: now,
        lastActive: now,
      },
      expiredAt: null,
    })
    return {}
  },

  establish: (token, user) => {
    const now = Date.now()
    set({
      session: {
        username: user.username,
        role: user.role,
        email: user.email,
        token,
        loggedAt: now,
        lastActive: now,
      },
      expiredAt: null,
    })
  },

  signOut: () => {
    const token = get().session?.token
    // 服务端同时销毁会话并清 cookie；无内存 token 时也调一次（cookie 兜底）
    api('/auth/logout', { method: 'POST', ...(token ? { token } : {}) }).catch(() => { /* ignore */ })
    set({ session: null })
  },

  touch: () =>
    set((s) => {
      if (!s.session) return {}
      const now = Date.now()
      const base = s.session.lastActive || s.session.loggedAt
      if (now - base > SESSION_TTL_MS) {
        return { session: null, expiredAt: now }
      }
      if (now - base < TOUCH_THROTTLE_MS) return {}
      return { session: { ...s.session, lastActive: now } }
    }),

  restore: async () => {
    try {
      const r = await api<{ user?: { username: string; role: UserRole; email?: string } }>('/me', {})
      if (r.user) {
        const now = Date.now()
        set({
          session: {
            username: r.user.username,
            role: r.user.role,
            email: r.user.email,
            token: '',   // cookie 即凭证，无需内存 token
            loggedAt: now,
            lastActive: now,
          },
          expiredAt: null,
          ready: true,
        })
        return
      }
    } catch { /* 未登录或会话失效 */ }
    set({ session: null, ready: true })
  },
}))
