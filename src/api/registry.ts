import { createSlDataApi } from './slDataApi'
import type { DataSource } from './DataSource'
import type { ServerConfig } from '@/store/serversStore'
import { IS_DEMO } from '@/demo/mode'
import { createDemoDataSource, guardDataSource, isDemoUrl } from '@/demo/demoSource'

export type DataSourceId = 'sldata' | 'local' | 'server'

export interface RegistryEntry {
  id: DataSourceId
  label: string
}

/** 顶层源类型（GitHub / Local / Server）。UI 可切换。 */
export const dataSourceTypes: RegistryEntry[] = [
  { id: 'sldata', label: 'SLDataAPI (GitHub)' },
  // 未来：local / server 在此注册，不改动调用方。
]

export const defaultDataSourceId: DataSourceId =
  (import.meta.env.VITE_DATA_SOURCE as DataSourceId) ?? 'sldata'

/** 按某台服务器配置构造对应数据源（当前仅 SLDataAPI）。 */
export function dataSourceFor(server: ServerConfig): DataSource {
  if (IS_DEMO) {
    // 演示版：demo:// 走本地模拟；其它地址先做混合内容 / CORS 检查
    if (isDemoUrl(server.baseUrl)) return createDemoDataSource()
    return guardDataSource(
      createSlDataApi({ baseUrl: server.baseUrl, token: server.token }),
      server.baseUrl,
    )
  }
  switch (defaultDataSourceId) {
    case 'sldata':
    default:
      return createSlDataApi({ baseUrl: server.baseUrl, token: server.token })
  }
}
