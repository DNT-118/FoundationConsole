import type { ControlResult, ServerState } from '@/types/api'

export interface ServerSnapshotOptions {
  signal?: AbortSignal
}

/**
 * Pluggable data source abstraction.
 * Implementations: SLDataAPI (GitHub), Local API, Server API.
 * The UI only ever depends on this interface, so swapping backends
 * is a configuration change, not a code change.
 */
export interface DataSource {
  readonly id: string
  readonly label: string
  fetchServer(id: string, opts?: ServerSnapshotOptions): Promise<ServerState>
  /**
   * 只读 GET 取数（SLDataAPI v2.6.0 PEAK verify_token 通道）：
   * /plugins/adapted 适配插件发现、/plugins/<id>/<route> 只读子路径。
   * 平台端有路径白名单；数据源不支持时该字段不存在，调用方判空即可。
   */
  fetchReadOnly?: (
    path: string,
    opts?: ServerSnapshotOptions,
  ) => Promise<unknown>
  /**
   * 控制接口调用（SLDataAPI v2.6 /control/*，一律 POST）。
   * 数据源不支持控制接口时该字段不存在；页面用 `dataSource.control` 判空即可。
   */
  control?: (
    path: string,
    body?: unknown,
    opts?: ServerSnapshotOptions,
  ) => Promise<ControlResult>
}
