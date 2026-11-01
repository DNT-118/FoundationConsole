import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useServersStore } from '@/store/serversStore'
import { dataSourceFor } from '@/api/registry'
import type { ServerState } from '@/types/api'

export interface UseServerQueryOptions {
  serverId?: string
  refetchInterval?: number
  enabled?: boolean
}

/**
 * 按当前激活服务器拉取数据。无激活服务器时不发请求。
 * 切换/添加/删除服务器会自动重查。
 */
export function useServerQuery(opts: UseServerQueryOptions = {}) {
  const { serverId, refetchInterval, enabled = true } = opts
  const servers = useServersStore((s) => s.servers)
  const activeId = useServersStore((s) => s.activeId)

  const server = servers.find((s) =>
    serverId ? s.id === serverId : s.id === activeId,
  )

  return useQuery<ServerState>({
    queryKey: ['server', server?.id ?? 'none', server?.baseUrl ?? ''],
    enabled: enabled && !!server,
    placeholderData: keepPreviousData,
    refetchInterval: refetchInterval ?? server?.refetchInterval ?? 5_000,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (!server) throw new Error('no active server')
      const ds = dataSourceFor(server)
      return ds.fetchServer(server.id, { signal })
    },
  })
}
