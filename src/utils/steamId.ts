/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
/**
 * SteamID 解析：SLDataAPI 的 steam_id 形如 "7656119xxxxxxxxxx@steam"。
 * 只接受 17 位纯数字（可带 @steam 后缀）；@northwood / @discord / 假人等
 * 非 Steam ID 返回 undefined（不请求头像，不做匹配）。
 */
const STEAM_ID_RE = /^(\d{17})(?:@steam)?$/i

export function parseSteamId(raw: string | undefined | null): string | undefined {
  const m = String(raw ?? '').trim().match(STEAM_ID_RE)
  return m ? m[1] : undefined
}
