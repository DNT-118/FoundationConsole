import type { DataSource, ServerSnapshotOptions } from '@/api/DataSource'
import type { SlPlayer, SlServerData, ServerState } from '@/types/api'
import { normalizeServerData } from '@/api/normalize'
import { DEMO_URL_PREFIX } from './mode'

/**
 * 演示版专用：本地模拟的 SLDataAPI 数据源（地址以 demo:// 开头）。
 * 不发任何网络请求，数据只在浏览器里按时间生成，用来体验界面。
 */
export function isDemoUrl(baseUrl: string): boolean {
  return baseUrl.trim().toLowerCase().startsWith(DEMO_URL_PREFIX)
}

const roster: Array<Omit<SlPlayer, 'x' | 'y' | 'z'>> = [
  { nickname: 'Dr.Bright', steam_id: '76561190000000001', role: 'Scientist', team: '基金会' },
  { nickname: 'ClassD-9341', steam_id: '76561190000000002', role: 'ClassD', team: 'D级' },
  { nickname: 'ClassD-1127', steam_id: '76561190000000003', role: 'ClassD', team: 'D级' },
  { nickname: 'MTF-Epsilon', steam_id: '76561190000000004', role: 'NtfSergeant', team: '基金会' },
  { nickname: 'Guard-07', steam_id: '76561190000000005', role: 'FacilityGuard', team: '基金会' },
  { nickname: 'Peanut', steam_id: '76561190000000006', role: 'Scp173', team: 'SCP' },
  { nickname: 'Shy', steam_id: '76561190000000007', role: 'Scp096', team: 'SCP' },
  { nickname: 'CI-Rifleman', steam_id: '76561190000000008', role: 'ChaosRifleman', team: '混沌' },
  { nickname: 'Ghost', steam_id: '76561190000000009', role: 'Spectator', team: '观察者' },
]

function mockSnapshot(): SlServerData {
  const t = Date.now() / 1000
  const roundLen = 900
  const roundDuration = Math.floor(t % roundLen)
  const visible = 5 + Math.floor((Math.sin(t / 60) + 1) * 2) // 5..9
  const players: SlPlayer[] = roster.slice(0, visible).map((p, i) => ({
    ...p,
    x: Math.round((Math.sin(t / 20 + i) * 40 + i * 3) * 10) / 10,
    y: p.team === 'SCP' ? 0 : 300 + i,
    z: Math.round((Math.cos(t / 25 + i) * 40 - i * 2) * 10) / 10,
  }))
  const count = (team: string) => players.filter((p) => p.team === team).length
  const nukeArmed = roundDuration > 600

  return {
    success: true,
    server_name: 'FDC 演示服务器（本地模拟数据）',
    online: true,
    players_count: players.length,
    max_players: 30,
    round_started: true,
    round_duration: roundDuration,
    current_phase: roundDuration < 30 ? 'Waiting' : 'InProgress',
    nuke_status: nukeArmed ? 'InProgress' : 'Idle',
    nuke_countdown: nukeArmed ? Math.max(0, roundLen - roundDuration) : 0,
    voice_port: 0,
    game_version: 'demo',
    active_holiday: 'None',
    d_count: count('D级') + count('混沌'),
    foundation_count: count('基金会'),
    scp_count: count('SCP'),
    spectator_count: count('观察者'),
    ping: 20 + Math.floor((Math.sin(t / 7) + 1) * 15),
    players,
    dntof_plugins: { sl_player: null, omega_warhead: null },
    adapted_plugins: [],
  }
}

export function createDemoDataSource(): DataSource {
  return {
    id: 'demo',
    label: 'Demo（本地模拟）',
    async fetchServer(id: string, opts?: ServerSnapshotOptions): Promise<ServerState> {
      if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await new Promise((r) => setTimeout(r, 120))
      return normalizeServerData(mockSnapshot(), id)
    },
  }
}

/** 本机回环地址：浏览器通常允许 https 页面访问。 */
function isLoopback(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\./.test(h)
}

/**
 * 访问前检查：GitHub Pages 是 https，浏览器会拦截访问 http:// 远程地址（混合内容）。
 * 返回中文原因；可以访问时返回 null。
 */
export function demoBlockReason(baseUrl: string): string | null {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return '演示版：服务器地址格式无效'
  }
  const pageHttps = typeof location !== 'undefined' && location.protocol === 'https:'
  if (pageHttps && url.protocol === 'http:' && !isLoopback(url.hostname)) {
    return '演示版不可用：GitHub Pages 页面是 https，浏览器会拦截对 http:// 服务器的请求（混合内容）。请给 SLDataAPI 配置 https 反代，或在本地运行 FDC。'
  }
  return null
}

/** 包一层真实数据源：先做混合内容检查，再把网络/CORS 失败翻译成中文提示。 */
export function guardDataSource(inner: DataSource, baseUrl: string): DataSource {
  return {
    id: inner.id,
    label: inner.label,
    async fetchServer(id, opts) {
      const reason = demoBlockReason(baseUrl)
      if (reason) throw new Error(reason)
      try {
        return await inner.fetchServer(id, opts)
      } catch (err) {
        if (err instanceof TypeError) {
          throw new Error(
            '演示版：请求被浏览器拦截或服务器无法访问（可能是 CORS 未放行 github.io、证书无效或服务器离线）。',
          )
        }
        throw err
      }
    },
  }
}
