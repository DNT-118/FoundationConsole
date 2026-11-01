import type { SlServerData, ServerState } from '@/types/api'
import type { DataSource, ServerSnapshotOptions } from './DataSource'
import { normalizeServerData } from './normalize'

export interface SlDataApiConfig {
  baseUrl: string
  token: string
}

export function createSlDataApi(config: SlDataApiConfig): DataSource {
  const base = config.baseUrl.replace(/\/$/, '')

  async function fetchServer(
    id: string,
    opts?: ServerSnapshotOptions,
  ): Promise<ServerState> {
    const url = `${base}/get_sl_data?token=${encodeURIComponent(config.token)}`

    const res = await fetch(url, {
      signal: opts?.signal,
      headers: { Accept: 'application/json' },
    })

    if (res.status === 403) {
      throw new Error('SLDataAPI: token 错误或缺失 (403 Forbidden)')
    }
    if (res.status === 404) {
      throw new Error('SLDataAPI: 路径不存在 (404)')
    }
    if (!res.ok) {
      throw new Error(`SLDataAPI: HTTP ${res.status}`)
    }

    const raw = (await res.json()) as SlServerData
    if (!raw.success) {
      throw new Error('SLDataAPI: success=false')
    }

    return normalizeServerData(raw, id)
  }

  return {
    id: 'sldata',
    label: 'SLDataAPI (GitHub)',
    fetchServer,
  }
}

export const defaultSlDataApi = createSlDataApi({
  baseUrl: import.meta.env.VITE_SL_DATA_API_BASE ?? 'http://127.0.0.1:8081',
  token: import.meta.env.VITE_SL_DATA_API_TOKEN ?? '',
})
