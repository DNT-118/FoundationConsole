import { create } from 'zustand'
import { normalizeServerData } from '@/api/normalize'
import type { ServerState } from '@/types/api'

/** WS 推送通道的服务器状态缓存（HTTP 轮询回退路径不经过此 store）。 */
interface Entry {
  state?: ServerState
  error?: string
  fetchedAt?: number
}

interface WsState {
  byServer: Record<string, Entry>
  applyState: (serverId: string, raw: unknown) => void
  applyError: (serverId: string, message: string) => void
  clear: (serverId: string) => void
  reset: () => void
}

export const useWsStateStore = create<WsState>()((set) => ({
  byServer: {},
  applyState: (serverId, raw) =>
    set((s) => {
      let state: ServerState | undefined
      try {
        state = normalizeServerData(raw as never, serverId)
      } catch {
        return { byServer: { ...s.byServer, [serverId]: { ...s.byServer[serverId], error: '服务器响应格式不兼容，请检查 SLDataAPI 版本' } } }
      }
      return {
        byServer: {
          ...s.byServer,
          [serverId]: { state, error: undefined, fetchedAt: Date.now() },
        },
      }
    }),
  applyError: (serverId, message) =>
    set((s) => ({
      byServer: {
        ...s.byServer,
        [serverId]: { ...(s.byServer[serverId] ?? {}), error: message },
      },
    })),
  clear: (serverId) =>
    set((s) => {
      const byServer = { ...s.byServer }
      delete byServer[serverId]
      return { byServer }
    }),
  reset: () => set({ byServer: {} }),
}))
