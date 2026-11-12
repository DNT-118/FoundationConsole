/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
/**
 * 上游 hello 能力信息（SLDataAPI 2.6 控制通道）：
 *  - version：上游插件版本串
 *  - beta：已开启的内测能力（adapted_actions / file_chunks）
 *  - tls / certFingerprint：本连接是否加密 + 证书 SHA-256（tls_mode off 时为 null）
 * 平台 wsHub 在上游握手 hello 后推送 upstream_info 帧；断开时推空（字段回退未知）。
 * 仅 WS 控制通道可用时有信息 —— HTTP 回退模式下保持 unknown。
 */
import { create } from 'zustand'

export interface UpstreamInfo {
  version: string
  beta: string[]
  tls: boolean | null
  certFingerprint: string | null
}

export const UPSTREAM_UNKNOWN: UpstreamInfo = { version: '', beta: [], tls: null, certFingerprint: null }

interface UpstreamState {
  byServer: Record<string, UpstreamInfo>
  apply: (serverId: string, info: Partial<UpstreamInfo> | null) => void
  reset: () => void
}

export const useUpstreamStore = create<UpstreamState>()((set) => ({
  byServer: {},
  apply: (serverId, info) =>
    set((state) => ({
      byServer: {
        ...state.byServer,
        [serverId]: info === null ? UPSTREAM_UNKNOWN : {
          version: typeof info.version === 'string' ? info.version : '',
          beta: Array.isArray(info.beta) ? info.beta.filter((x) => typeof x === 'string') : [],
          tls: info.tls === true ? true : info.tls === false ? false : null,
          certFingerprint: typeof info.certFingerprint === 'string' ? info.certFingerprint : null,
        },
      },
    })),
  reset: () => set({ byServer: {} }),
}))

/** 服务器的内测能力是否已知（WS 控制通道连接过且收到 hello）。 */
export function betaKnown(info: UpstreamInfo | undefined): info is UpstreamInfo {
  return !!info && (info.tls === true || info.tls === false)
}
