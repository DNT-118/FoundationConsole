import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useServersStore } from '@/store/serversStore'
import { dataSourceFor } from '@/api/registry'
import { wsHub, useHubStatus } from '@/ws/hub'
import { useWsStateStore } from '@/ws/stateStore'
import type { ServerState } from '@/types/api'

export interface UseServerQueryOptions {
  serverId?: string
  refetchInterval?: number
  enabled?: boolean
}

/**
 * 按当前激活（或指定）服务器拉取状态。
 * 首选 WS 推送通道（平台聚合轮询 → state 帧写入 useWsStateStore）；
 * hub 不可用时自动回退 HTTP 轮询（原有 react-query 路径保留）。
 */
export function useServerQuery(opts: UseServerQueryOptions = {}) {
  const { serverId, refetchInterval, enabled = true } = opts
  const servers = useServersStore((s) => s.servers)
  const activeId = useServersStore((s) => s.activeId)

  const server = servers.find((s) =>
    serverId ? s.id === serverId : s.id === activeId,
  )
  const sid = server?.id
  const hubUsable = useHubStatus((s) => s.usable)
  const entry = useWsStateStore((s) => (sid ? s.byServer[sid] : undefined))

  // 订阅（引用计数）：挂载时 +1，卸载时 -1
  useEffect(() => {
    if (!sid || !enabled || !hubUsable) return
    wsHub.addWant(sid)
    wsHub.ensureConnected()
    return () => wsHub.removeWant(sid)
  }, [sid, enabled, hubUsable])

  // HTTP 回退（hub 不可用/降级时启用）
  const fallback = useQuery<ServerState>({
    queryKey: ['server', server?.id ?? 'none', server ? `${server.host}:${server.port}` : ''],
    enabled: enabled && !!server && !hubUsable,
    refetchInterval: refetchInterval ?? server?.refetchInterval ?? 5000,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (!server) throw new Error('no active server')
      const ds = dataSourceFor(server)
      return ds.fetchServer(server.id, { signal })
    },
  })

  if (hubUsable) {
    const fresh = !!entry && Date.now() - (entry.fetchedAt ?? 0) < 15000
    return {
      data: entry?.state,
      isFetching: !entry || !fresh,
      isError: !!entry?.error,
      error: entry?.error ? new Error(entry.error) : null,
    }
  }
  return fallback
}
