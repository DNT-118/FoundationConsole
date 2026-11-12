import { createSlDataApi } from './slDataApi'
import type { DataSource } from './DataSource'
import type { ServerConfig } from '@/store/serversStore'

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
  switch (defaultDataSourceId) {
    case 'sldata':
    default:
      return createSlDataApi({
        serverId: server.id,
        // 凭据不回传明文：数据/控制走平台端点（serverId 白名单），平台内部自动请求游戏服
        controlEnabled: server.apiKeyConfigured ?? server.controlEnabled ?? !!server.apiKey,
      })
  }
}
