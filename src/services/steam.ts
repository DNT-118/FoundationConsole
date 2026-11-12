import { useQuery } from '@tanstack/react-query'

export interface SteamProfile {
  steamId: string
  /** 平台同源头像地址（/api/steam/avatar?steamid=…）；无头像/获取失败时无此字段。 */
  avatar?: string
  /** 真实 Steam 昵称（steamcommunity 返回）。 */
  persona?: string
}

/**
 * 通过平台后端获取真实 Steam 资料（头像/昵称）。
 * 后端代理 steamcommunity XML 接口（无需 API key）并缓存 24h。
 */
export async function fetchSteamProfile(steamId: string): Promise<SteamProfile | null> {
  const resp = await fetch(`/api/steam/profile?steamid=${encodeURIComponent(steamId)}`)
  if (!resp.ok) return null
  const j = await resp.json()
  if (!j.success) return null
  return { steamId: j.steamId, avatar: j.avatar, persona: j.persona }
}

/** 按 steamId 缓存查询（10min stale）。steamId 缺省时不请求。 */
export function useSteamId(steamId: string | undefined, enabled = true) {
  return useQuery<SteamProfile | null>({
    queryKey: ['steam', steamId ?? ''],
    enabled: !!steamId && enabled,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: 0,
    queryFn: () => fetchSteamProfile(steamId as string),
  })
}
