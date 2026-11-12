import { useMutation } from '@tanstack/react-query'
import type { ControlResult } from '@/types/api'
import { dataSourceFor } from '@/api/registry'
import { controlErrorFrom } from '@/api/controlError'
import { useServersStore } from '@/store/serversStore'
import { wsHub, useHubStatus } from '@/ws/hub'

/**
 * 当前激活服务器的控制接口入口。
 * 优先走 WS 控制通道（平台按服务器 controlTransport 分流：ws 中继 / HTTP 转发）；
 * hub 不可用时选用 HTTP 代理；已发送的调用失败后不重放。
 * - `control`：可用的控制调用函数；数据源不支持或未配置 API Key 时为 null
 * - `tokenConfigured`：是否已为服务器配置 API Key（决定页面是否显示"未配置"提示）
 */
export function useControlSource() {
  const servers = useServersStore((s) => s.servers)
  const activeId = useServersStore((s) => s.activeId)
  const server = servers.find((s) => s.id === activeId) ?? servers[0] ?? null
  const ds = server ? dataSourceFor(server) : null

  const tokenConfigured = !!server?.apiKeyConfigured || !!server?.controlEnabled || !!server?.apiKey
  const control = server && tokenConfigured
    ? async (path: string, body?: unknown, opts?: { signal?: AbortSignal }): Promise<ControlResult> => {
        // Choose a transport before sending. Never replay a command after an ambiguous failure.
        const result = useHubStatus.getState().usable
          ? await wsHub.call(server.id, path, body, opts?.signal)
          : await ds!.control!(path, body, opts)
        if (!result.success) throw controlErrorFrom(result)
        return result
      }
    : null

  return {
    server,
    control,
    tokenConfigured,
  }
}

export interface ControlCall {
  path: string
  body?: unknown
}

/** 通用控制操作 mutation（kick/ban/命令/回合等一次性动作）。 */
export function useControlMutation() {
  const { control } = useControlSource()
  return useMutation({
    mutationFn: async ({ path, body }: ControlCall): Promise<ControlResult> => {
      if (!control) {
        throw new Error('control unavailable')
      }
      return control(path, body)
    },
  })
}

/** 控制类只读数据查询的 queryFn 工厂（plugins/ban_list/logs/files list 等）。 */
export function makeControlQueryFn<T>(
  control: NonNullable<ReturnType<typeof useControlSource>['control']>,
  path: string,
  body?: unknown,
) {
  return async (_opts: { signal?: AbortSignal }): Promise<T> => {
    const result = await control(path, body, _opts)
    return result.data as T
  }
}
