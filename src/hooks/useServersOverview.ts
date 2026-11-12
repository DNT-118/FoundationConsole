import { useEffect } from 'react'
import { useQueries } from '@tanstack/react-query'
import { useServersStore } from '@/store/serversStore'
import { dataSourceFor } from '@/api/registry'
import { wsHub, useHubStatus } from '@/ws/hub'
import { useWsStateStore } from '@/ws/stateStore'
import type { ServerState } from '@/types/api'

/**
 * 全部已绑定服务器的状态概览（Dashboard 多服务器卡片用）。
 * 首选 WS 推送通道：一次 subscribe 全量服务器，平台聚合轮询后 state 帧推送；
 * hub 不可用时回退为每服务器一个 HTTP query（原实现）。
 */
export function useServersOverview() {
  const servers = useServersStore((s) => s.servers)
  const ids = servers.map((s) => s.id)
  const idsKey = ids.join(',')
  const hubUsable = useHubStatus((s) => s.usable)
  const byServer = useWsStateStore((s) => s.byServer)

  // 批量订阅（引用计数）
  useEffect(() => {
    if (!hubUsable || ids.length === 0) return
    wsHub.addWants(ids)
    wsHub.ensureConnected()
    return () => wsHub.removeWants(ids)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, hubUsable])

  // HTTP 回退（hub 不可用/降级时启用）
  const fallback = useQueries({
    queries: servers.map((s) => ({
      queryKey: ['server', s.id, `${s.host}:${s.port}`],
      enabled: !hubUsable,
      refetchInterval: s.refetchInterval ?? 5000,
      refetchOnWindowFocus: false,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        dataSourceFor(s).fetchServer(s.id, { signal }),
    })),
  })

  if (hubUsable) {
    return servers.map((s) => {
      const e = byServer[s.id]
      return {
        data: e?.state as ServerState | undefined,
        isError: !!e?.error,
        isFetching: false,
      }
    })
  }
  return fallback
}
