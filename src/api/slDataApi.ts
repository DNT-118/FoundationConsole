import type { ControlResult, SlServerData, ServerState } from '@/types/api'
import type { DataSource, ServerSnapshotOptions } from './DataSource'
import { controlErrorFrom } from './controlError'
import { normalizeServerData } from './normalize'
import { requestJson } from './request'

export interface SlDataApiConfig {
  /** 平台内注册的服务器 ID —— 数据/控制一律走平台端点（serverId 白名单）。 */
  serverId: string
  /**
   * 是否已配置控制面 API Key（SLDataAPI v2.6）。
   * 凭据本身由平台加密存储，平台内部自动注入；前端只关心"能不能用"。
   */
  controlEnabled?: boolean
  /** 单次请求超时（ms），默认 45000，覆盖上游握手及主线程排队时间。 */
  timeoutMs?: number
}

/**
 * SLDataAPI 数据源（平台原生端点版）。
 * 浏览器永不直连游戏服务器：数据 GET 走 /api/sl/data?serverId=，
 * 控制 POST 走 /api/sl/call（serverId + path + body），平台按当前用户的
 * 服务器白名单校验后，内部自动请求游戏服务器并注入存储的 VerifyToken/API Key。
 * 不再暴露任意 URL 代理 —— 无 SSRF 面。
 */
export function createSlDataApi(config: SlDataApiConfig): DataSource {
  const timeoutMs = config.timeoutMs ?? 45000

  function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, opts?: ServerSnapshotOptions): Promise<T> {
    const endpoint = method === 'POST'
      ? '/api/sl/call'
      : `/api/sl/data?serverId=${encodeURIComponent(config.serverId)}&path=${encodeURIComponent(path)}`
    // Never replay control requests: a lost response does not mean the operation failed.
    return requestJson<T>(endpoint, {
      method,
      signal: opts?.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: method === 'POST' ? JSON.stringify({ serverId: config.serverId, path, body }) : undefined,
    }, timeoutMs)
  }

  async function fetchServer(
    id: string,
    opts?: ServerSnapshotOptions,
  ): Promise<ServerState> {
    const raw = await request<SlServerData>('GET', '/get_sl_data', undefined, opts)
    if (!raw.success) {
      throw new Error('SLDataAPI: success=false')
    }
    return normalizeServerData(raw, id)
  }

  /**
   * 只读 GET 取数（v2.6.0 PEAK verify_token 通道）：/plugins/adapted、/plugins/<id>/<route>。
   * 与 fetchServer 同通道（平台 /api/sl/data 白名单转发），但返回原始 JSON 不做归一化。
   */
  async function fetchReadOnly(
    path: string,
    opts?: ServerSnapshotOptions,
  ): Promise<unknown> {
    return request<unknown>('GET', path, undefined, opts)
  }

  async function control(
    path: string,
    body?: unknown,
    opts?: ServerSnapshotOptions,
  ): Promise<ControlResult> {
    if (!config.controlEnabled) {
      throw new Error('SLDataAPI: 未配置控制面 API Key')
    }
    const result = await request<ControlResult>('POST', path, body, opts)
    if (!result.success) {
      // 业务错误带结构化信息（409 holiday_inactive / 501 feature_unavailable 等），供 UI 优雅提示
      throw controlErrorFrom(result)
    }
    return result
  }

  return {
    id: 'sldata',
    label: 'SLDataAPI (GitHub)',
    fetchServer,
    fetchReadOnly,
    control,
  }
}
