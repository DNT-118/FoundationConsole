import { useQuery } from '@tanstack/react-query'

export interface SteamProfile {
  steamId: string
  /** Steam 头像 URL；真实接口返回。 */
  avatar?: string
  /** 真实 Steam 昵称；真实接口返回。 */
  persona?: string
}

/**
 * SteamID 自动查询。
 * 当前服务端（SLDataAPI）未暴露 steamId，先用昵称占位哈希作为本地 stable id，
 * 后期服务端升级暴露真实接口后，仅需把 fetchSteamId 的实现替换为真实调用，
 * 上层 Players 页无需改动。
 */
export function fetchSteamId(nickname: string): Promise<SteamProfile> {
  return new Promise((resolve) => {
    // 占位：基于昵称派生稳定 STEAMID0 形式，保证 UI 有可填值且稳定。
    let h = 0
    for (let i = 0; i < nickname.length; i++) {
      h = (h * 31 + nickname.charCodeAt(i)) >>> 0
    }
    const y = h % 1000
    const z = (h >> 10) % 1000000
    const steamId = `STEAM_0:1:${z}`
    resolve({ steamId, persona: nickname })
    // 故意不引用 y 以避免 lint 警告，留作未来真实接口参数位。
    void y
  })
}

/** 按 nickname 缓存自动查询（10min stale）。 */
export function useSteamId(nickname: string | undefined, enabled = true) {
  return useQuery<SteamProfile>({
    queryKey: ['steam', nickname ?? ''],
    enabled: !!nickname && enabled,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: 0,
    queryFn: () => fetchSteamId(nickname as string),
  })
}
