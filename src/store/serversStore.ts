import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ServerConfig {
  id: string
  label: string
  /** SLDataAPI base URL, e.g. http://1.2.3.4:8081 */
  baseUrl: string
  /** Per-server token. */
  token: string
  /** Polling interval (ms). */
  refetchInterval: number
  createdAt: number
}

interface ServersState {
  servers: ServerConfig[]
  activeId: string | null
  add: (input: Omit<ServerConfig, 'id' | 'createdAt'>) => ServerConfig
  update: (id: string, patch: Partial<Omit<ServerConfig, 'id' | 'createdAt'>>) => void
  remove: (id: string) => void
  setActive: (id: string) => void
}

function makeId(): string {
  return `srv_${Math.random().toString(36).slice(2, 10)}`
}

function normalizeBase(url: string): string {
  return url.trim().replace(/\/$/, '')
}

export const useServersStore = create<ServersState>()(
  persist(
    (set, get) => ({
      servers: [],
      activeId: null,

      add: (input) => {
        const server: ServerConfig = {
          ...input,
          baseUrl: normalizeBase(input.baseUrl),
          id: makeId(),
          createdAt: Date.now(),
        }
        set((s) => ({
          servers: [...s.servers, server],
          activeId: s.activeId ?? server.id,
        }))
        return server
      },

      update: (id, patch) =>
        set((s) => ({
          servers: s.servers.map((srv) =>
            srv.id === id
              ? { ...srv, ...patch, baseUrl: patch.baseUrl ? normalizeBase(patch.baseUrl) : srv.baseUrl }
              : srv,
          ),
        })),

      remove: (id) =>
        set((s) => {
          const servers = s.servers.filter((srv) => srv.id !== id)
          const activeId =
            s.activeId === id ? (servers[0]?.id ?? null) : s.activeId
          return { servers, activeId }
        }),

      setActive: (id) => {
        if (get().servers.some((s) => s.id === id)) set({ activeId: id })
      },
    }),
    { name: 'pfc.servers' },
  ),
)
