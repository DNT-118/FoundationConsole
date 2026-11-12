/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
import { create } from 'zustand'
import { api } from '@/api/platform'
import { useAuthStore } from '@/store/authStore'

export const DEFAULT_PORT = 8081

export interface ServerConfig {
  id: string
  /** 可选自定义标签；空则用返回的 server_name 或 host。 */
  label?: string
  host: string
  port: number
  /** 只读令牌（VerifyToken）。服务端加密存储且不回传明文（列表响应已打码）。 */
  token: string
  /** 可选：SLDataAPI 2.6 控制面 API Key。访客角色服务端强制清空；列表响应不回传明文。 */
  apiKey?: string
  /** 是否已配置 API Key（服务端脱敏后返回，前端据此决定控制功能是否可用）。 */
  apiKeyConfigured?: boolean
  /** 兼容旧平台响应；新服务端与前端均使用 apiKeyConfigured。 */
  controlEnabled?: boolean
  /** 控制接口传输方式（与服务端 controlTransport 对齐，硬互斥）：
   *  http = 走 HTTP /control/* 代理；ws = 走 WebSocket 控制通道（此时 HTTP /control/* 不可用）。 */
  controlTransport?: 'http' | 'ws'
  refetchInterval: number
  createdAt: number
}

/** 显示名：自定义标签 > 服务器返回名 > host。 */
export function serverLabel(
  s: Pick<ServerConfig, 'label' | 'host'>,
  serverName?: string,
): string {
  return s.label?.trim() || serverName?.trim() || s.host
}

/** 拼接 SLDataAPI 基址：http(s)://host:port — 供调用方使用。 */
export function serverBaseUrl(s: Pick<ServerConfig, 'host' | 'port'>): string {
  const h = s.host.trim()
  const hasProto = /^https?:\/\//i.test(h)
  const host = hasProto ? h : `http://${h}`
  return `${host.replace(/\/$/, '')}:${s.port}`
}

interface ServersState {
  servers: ServerConfig[]
  activeId: string | null
  /** 是否正在从服务端拉取列表。 */
  loading: boolean
  fetchServers: () => Promise<void>
  add: (input: Omit<ServerConfig, 'id' | 'createdAt'>) => Promise<ServerConfig>
  update: (id: string, patch: Partial<Omit<ServerConfig, 'id' | 'createdAt'>>) => Promise<void>
  remove: (id: string) => Promise<void>
  setActive: (id: string) => void
  /** 切换账户后清空内存态（服务端数据按用户隔离，下次登录重新拉取）。 */
  reset: () => void
}

function token(): string {
  return useAuthStore.getState().session?.token ?? ''
}

function cleanHost(h: string): string {
  return h.trim().replace(/\/$/, '')
}

const emptyState = { servers: [], activeId: null, loading: false }

// 激活服务器选择按用户持久化到 localStorage：刷新后保持上次激活的服务器，
// 不再回退到列表第一台（fetchServers 时按当前列表校验，失效则回退第一台）
const ACTIVE_KEY_PREFIX = 'pfc.activeServer'

function activeStorageKey(): string {
  const uname = useAuthStore.getState().session?.username ?? 'anon'
  return `${ACTIVE_KEY_PREFIX}:${uname}`
}

function loadSavedActive(): string | null {
  try { return localStorage.getItem(activeStorageKey()) } catch { return null }
}

function saveActive(id: string | null) {
  try {
    if (id) localStorage.setItem(activeStorageKey(), id)
    else localStorage.removeItem(activeStorageKey())
  } catch { /* ignore */ }
}

export const useServersStore = create<ServersState>()((set) => ({
  ...emptyState,
  fetchServers: async () => {
    const username = useAuthStore.getState().session?.username
    set({ loading: true })
    try {
      const r = await api<{ servers: ServerConfig[] }>('/servers', { token: token() })
      if (useAuthStore.getState().session?.username !== username) return
      const saved = loadSavedActive()
      const activeId = r.servers.some((s) => s.id === saved)
        ? saved
        : (r.servers[0]?.id ?? null)
      set({ servers: r.servers, activeId })
    } finally {
      set({ loading: false })
    }
  },
  add: async (input) => {
    const r = await api<{ server: ServerConfig }>('/servers', {
      method: 'POST',
      token: token(),
      body: {
        host: cleanHost(input.host),
        port: Number(input.port) || DEFAULT_PORT,
        token: input.token,
        apiKey: input.apiKey,
        label: input.label ?? '',
        controlTransport: input.controlTransport === 'ws' ? 'ws' : 'http',
        refetchInterval: Math.max(1000, Number(input.refetchInterval) || 5000),
      },
    })
    set((s) => ({
      servers: [...s.servers, r.server],
      activeId: s.activeId ?? r.server.id,
    }))
    return r.server
  },
  update: async (id, patch) => {
    const r = await api<{ server: ServerConfig }>(`/servers/${id}`, {
      method: 'PUT',
      token: token(),
      body: {
        host: patch.host !== undefined ? cleanHost(patch.host) : undefined,
        port: patch.port !== undefined ? Number(patch.port) : undefined,
        token: patch.token,
        apiKey: patch.apiKey,
        label: patch.label ?? '',
        controlTransport: patch.controlTransport,
        refetchInterval: patch.refetchInterval,
      },
    })
    set((s) => ({
      servers: s.servers.map((srv) => (srv.id === id ? r.server : srv)),
    }))
  },
  remove: async (id) => {
    await api(`/servers/${id}`, { method: 'DELETE', token: token() })
    set((s) => {
      const servers = s.servers.filter((srv) => srv.id !== id)
      const activeId = s.activeId === id ? (servers[0]?.id ?? null) : s.activeId
      saveActive(activeId)
      return { servers, activeId }
    })
  },
  setActive: (id) =>
    set((s) => {
      if (!s.servers.some((x) => x.id === id)) return {}
      saveActive(id)
      return { activeId: id }
    }),
  reset: () => set(emptyState),
}))

useAuthStore.subscribe((state, previous) => {
  if (state.session?.username !== previous.session?.username) useServersStore.getState().reset()
})
