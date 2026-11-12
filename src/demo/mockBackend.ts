/**
 * GitHub Pages 演示版：浏览器内的 /api 模拟后端。
 * 拦截 window.fetch 中所有 /api/* 请求，用 localStorage 保存数据，不发出任何网络请求。
 * 只在演示构建（IS_DEMO）时安装；普通构建不会引用本文件。
 */
import { DEMO_MOCK_HOST } from './mode'

const STATE_KEY = 'fdc-demo.state'
const DEMO_USER = { username: 'demo', role: 'admin' as const, email: 'demo@example.com' }

export const DEMO_UNSUPPORTED = {
  mail: '演示版不支持邮件发送（没有后端，无法连接 SMTP 服务器）',
  smtp: '演示版不支持 SMTP 邮箱配置与 Microsoft（Entra ID）OAuth 授权：GitHub Pages 没有后端，无法连接邮件服务器或保存授权',
  events: '演示版不支持实时事件流（需要平台后端的 WebSocket 中继和真实游戏服务器）',
  oauth: '演示版不支持 Microsoft OAuth 授权（需要部署自己的后端）',
  steam: '演示版无法访问 Steam（没有后端代理），玩家头像显示为昵称缩写',
  voice: '演示版不支持语音监听（需要真实游戏服务器的语音 WebSocket）',
  realServer: '演示版无法连接真实游戏服务器：GitHub Pages 没有后端，所有数据为本地模拟。请自行部署 FDC 后端使用完整功能。',
  twofa: '演示版不支持双因素验证（无后端）',
  users: '演示版只有一个本地演示管理员账户，不能管理用户',
}

interface DemoServer {
  id: string
  label: string
  host: string
  port: number
  controlTransport: 'http' | 'ws'
  refetchInterval: number
  apiKeyConfigured: boolean
  createdAt: number
}

interface DemoState {
  servers: DemoServer[]
  announcement: {
    enabled: boolean; popupEnabled: boolean; version: number
    title: { zh: string; en: string }; content: { zh: string; en: string }; updatedAt: number
  }
  announcements: { id: string; title: string; content: string; author: string; createdAt: number }[]
  about: { thanks: string[]; sponsors: string[] }
  bans: { user_id: string; original_name: string; reason: string; issuer: string; ban_type: 'steam' | 'ip'; expires: number; issuance_time: number }[]
  plugins: { name: string; author: string; version: string; prefix: string; priority: string; source: 'labapi' | 'exiled'; enabled: boolean; self?: boolean; staged?: boolean | null }[]
  audit: { time: string; actor: string; endpoint: string; body: string; success: boolean; message: string }[]
  files: Record<string, string>
}

function now() { return Date.now() }
function rid(p: string) { return `${p}_${Math.random().toString(36).slice(2, 10)}` }

function initialState(): DemoState {
  const t = now()
  return {
    servers: [{
      id: 'srv_demo', label: '演示服务器（模拟）', host: DEMO_MOCK_HOST, port: 8081,
      controlTransport: 'http', refetchInterval: 3000, apiKeyConfigured: true, createdAt: t,
    }],
    announcement: {
      enabled: true, popupEnabled: false, version: 1,
      title: { zh: '欢迎体验 FDC 演示版', en: 'Welcome to the FDC demo' },
      content: {
        zh: '这是 GitHub Pages 演示版：所有数据保存在你的浏览器里，游戏服务器数据为模拟生成。',
        en: 'This is the GitHub Pages demo: data stays in your browser and server data is simulated.',
      },
      updatedAt: t,
    },
    announcements: [{
      id: 'a_demo1', author: 'demo', createdAt: t,
      title: '演示版说明',
      content: '## 演示版说明\n\n- 免登录，自动以演示管理员身份进入\n- 数据只保存在当前浏览器的 localStorage\n- 游戏服务器为本地模拟，控制操作只会记录到审计列表\n- 邮件、Steam 头像、语音、实时事件流需要自行部署后端',
    }],
    about: { thanks: ['SCP: Secret Laboratory 社区'], sponsors: [] },
    bans: [
      { user_id: '76561190000000101@steam', original_name: 'Griefer', reason: '演示数据：恶意破坏', issuer: 'demo', ban_type: 'steam', expires: Math.floor(t / 1000) + 86400 * 3, issuance_time: Math.floor(t / 1000) - 3600 },
      { user_id: '203.0.113.7', original_name: 'Spammer', reason: '演示数据：刷屏', issuer: 'demo', ban_type: 'ip', expires: 0, issuance_time: Math.floor(t / 1000) - 86400 },
    ],
    plugins: [
      { name: 'SLDataAPI', author: 'DNT_OF', version: '2.6.2', prefix: 'sldataapi', priority: 'Medium', source: 'labapi', enabled: true, self: true, staged: null },
      { name: 'SLPlayer', author: 'DNT_OF', version: '1.4.0', prefix: 'slplayer', priority: 'Medium', source: 'labapi', enabled: true, staged: null },
      { name: 'OmegaWarhead', author: 'DNT_OF', version: '1.2.0', prefix: 'omega', priority: 'Low', source: 'labapi', enabled: false, staged: null },
    ],
    audit: [],
    files: {
      'config_gameplay.txt': '# 演示文件（本地模拟）\nserver_name: FDC Demo\nmax_players: 30\n',
      'README.txt': '这里是演示版的模拟文件系统，保存只会写入浏览器 localStorage。\n',
    },
  }
}

function load(): DemoState {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (raw) return { ...initialState(), ...JSON.parse(raw) }
  } catch { /* ignore */ }
  const s = initialState()
  save(s)
  return s
}
function save(s: DemoState) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

function sanitize(s: DemoServer) {
  return {
    ...s, token: '', apiKey: s.apiKeyConfigured ? '••••••' : '',
    controlEnabled: s.apiKeyConfigured,
  }
}

// ---------------- 模拟游戏服数据 ----------------
const roster = [
  { nickname: 'Dr.Bright', steam_id: '76561190000000001@steam', role: '科学家', team: '基金会' },
  { nickname: 'ClassD-9341', steam_id: '76561190000000002@steam', role: 'D级人员', team: 'D级' },
  { nickname: 'ClassD-1127', steam_id: '76561190000000003@steam', role: 'D级人员', team: 'D级' },
  // 混沌分裂者：单独成队（上游 d_count 把 D 级与混沌算在一起，前端按玩家拆分显示）
  { nickname: 'Insurgent-01', steam_id: '76561190000000010@steam', role: '混沌分裂者步枪手', team: '混沌' },
  { nickname: 'Insurgent-02', steam_id: '76561190000000011@steam', role: '混沌分裂者压制手', team: '混沌' },
  { nickname: 'Epsilon-11', steam_id: '76561190000000004@steam', role: '九尾狐中士', team: '九尾狐' },
  { nickname: 'Guard-07', steam_id: '76561190000000005@steam', role: '设施警卫', team: '基金会' },
  { nickname: 'Peanut', steam_id: '76561190000000006@steam', role: 'SCP-173', team: 'SCP' },
  { nickname: 'Shy', steam_id: '76561190000000007@steam', role: 'SCP-096', team: 'SCP' },
  { nickname: 'Ghost', steam_id: '76561190000000009@steam', role: '观众', team: '观众' },
]

function isMockServer(s: DemoServer) { return s.host === DEMO_MOCK_HOST }

function slData(s: DemoServer) {
  const t = now() / 1000
  const roundLen = 900
  const dur = Math.floor(t % roundLen)
  const count = 8 + Math.floor((Math.sin(t / 60) + 1) * 1.5)
  const players = roster.slice(0, count).map((p, i) => ({
    ...p,
    x: Math.round((Math.sin(t / 20 + i) * 40 + i * 3) * 10) / 10,
    y: p.team === 'SCP' ? 0 : 300 + i,
    z: Math.round((Math.cos(t / 25 + i) * 40 - i * 2) * 10) / 10,
  }))
  const c = (team: string) => players.filter((p) => p.team === team).length
  const armed = dur > 780
  return {
    success: true,
    server_name: `${s.label || 'FDC Demo'}`,
    online: true,
    players_count: players.length,
    max_players: 30,
    round_started: dur >= 30,
    round_duration: dur,
    current_phase: dur < 30 ? '等待玩家' : '回合进行中',
    nuke_status: armed ? '倒计时中' : '未激活',
    nuke_countdown: armed ? roundLen - dur : 0,
    // 与 SLDataAPI 一致：d_count = ClassD + ChaosInsurgency
    d_count: c('D级') + c('混沌'),
    foundation_count: c('基金会') + c('九尾狐'),
    scp_count: c('SCP'),
    spectator_count: c('观众'),
    ping: 20 + Math.floor((Math.sin(t / 7) + 1) * 15),
    players,
    voice_port: 0,
    game_version: '14.2.0',
    active_holiday: '',
    dntof_plugins: {
      sl_player: { present: true, source_mode: 'local', remote_url: null, now_playing: 'Demo Track' },
      omega_warhead: null,
    },
    adapted_plugins: [{
      id: 'demo-plugin', name: '演示适配插件', version: '1.0.0',
      capabilities: ['status'], routes: ['status'], status: { demo: true },
    }],
  }
}

function controlData(st: DemoState, path: string, body: Record<string, unknown>): { success: boolean; message: string; data?: unknown } {
  const ok = (data?: unknown, message = '演示版：已模拟执行') => ({ success: true, message, data })
  switch (path) {
    case '/control/plugins':
      return ok({ count: st.plugins.length, plugins: st.plugins })
    case '/control/moderation/ban_list':
      return ok({ count: st.bans.length, bans: st.bans })
    case '/control/moderation/ban/revoke': {
      const id = String(body.user_id ?? body.target ?? '')
      st.bans = st.bans.filter((b) => b.user_id !== id)
      return ok()
    }
    case '/control/moderation/ban/add':
      st.bans.push({
        user_id: String(body.user_id ?? body.target ?? 'unknown'), original_name: String(body.name ?? body.target ?? '未知'),
        reason: String(body.reason ?? ''), issuer: 'demo', ban_type: 'steam',
        expires: 0, issuance_time: Math.floor(now() / 1000),
      })
      return ok()
    case '/control/audit/list':
      return ok({ count: st.audit.length, entries: st.audit })
    case '/control/reports':
      return ok([{
        id: 'r1', reporter_steam64: '76561190000000002', reporter_name: 'ClassD-9341', reporter_ip: '198.51.100.2',
        target_steam64: '76561190000000006', target_name: 'Peanut', reason: '演示举报：卡墙', reported_at: new Date().toISOString(), status: 'pending',
      }])
    case '/control/logs':
      if (body.action === 'list') return ok({ count: 1, files: [{ path: 'demo/server.log', name: 'server.log', size: 2048, modified: new Date().toISOString() }] })
      return ok({
        file: 'server.log', path: 'demo/server.log', total: 4,
        lines: ['[演示] 服务器已启动', '[演示] 回合开始', '[演示] Dr.Bright 加入了游戏', '[演示] 这是模拟日志，真实日志需要连接游戏服务器'],
      })
    case '/control/files/list':
      return ok({
        path: String(body.path ?? '/'), count: Object.keys(st.files).length,
        entries: Object.entries(st.files).map(([name, c]) => ({ name, type: 'file', size: c.length, modified: new Date().toISOString() })),
      })
    case '/control/files/read': {
      const name = String(body.path ?? '').split('/').pop() ?? ''
      const content = st.files[name] ?? ''
      return ok({ path: String(body.path ?? ''), size: content.length, modified: new Date().toISOString(), content })
    }
    case '/control/files/write': {
      const name = String(body.path ?? '').split('/').pop() ?? 'untitled.txt'
      st.files[name] = String(body.content ?? '')
      return ok({ path: String(body.path ?? ''), bytes: st.files[name].length }, '演示版：已保存到浏览器本地')
    }
    case '/control/console/command':
      return ok({ output: `[演示] 已模拟执行命令：${String(body.command ?? '')}\n真实命令需要连接游戏服务器。` })
    case '/control/map/seed':
      return ok({ ready: true, seed: 20261113 })
    case '/control/plugins/slplayer':
      return ok({
        playing: true, index: 0, song: 'Demo Track', elapsed_seconds: Math.floor(now() / 1000) % 180, duration_seconds: 180,
        volume: 60, shuffle: false, source: 'local', remote_url: null, playlist_count: 2,
        playlist: [
          { index: 0, display: 'Demo Track', duration_seconds: 180, current: true },
          { index: 1, display: 'Another Track', duration_seconds: 200, current: false },
        ],
      })
    default:
      return ok()
  }
}

// ---------------- 路由 ----------------
type Json = Record<string, unknown>

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}
const fail = (message: string, status = 400) => json(status, { success: false, message })

async function readBody(init?: RequestInit, req?: Request): Promise<Json> {
  try {
    if (init?.body && typeof init.body === 'string') return JSON.parse(init.body)
    if (req) { const t = await req.text(); return t ? JSON.parse(t) : {} }
  } catch { /* ignore */ }
  return {}
}

async function handle(path: string, method: string, url: URL, body: Json): Promise<Response> {
  const st = load()
  const done = (r: Response) => { save(st); return r }

  if (path === '/health') return json(200, { success: true, status: 'ok' })
  if (path === '/auth/status') return json(200, { success: true, firstRun: false, smtpConfigured: false })
  if (path === '/me' || path === '/auth/login' || path === '/auth/register' || path === '/auth/2fa/verify') {
    return json(200, { success: true, token: 'demo', user: DEMO_USER })
  }
  if (path === '/auth/logout') return json(200, { success: true })
  if (path === '/auth/send-code') return fail(DEMO_UNSUPPORTED.mail)
  if (path === '/auth/2fa/status') return json(200, { success: true, enabled: false })
  if (path.startsWith('/auth/2fa/')) return fail(DEMO_UNSUPPORTED.twofa)

  if (path === '/announcement' || path === '/admin/announcement') {
    if (method === 'PUT') {
      const prev = st.announcement
      const changed = JSON.stringify([prev.title, prev.content]) !== JSON.stringify([body.title, body.content])
      st.announcement = { ...prev, ...(body as object), version: prev.version + (changed ? 1 : 0), updatedAt: now() } as DemoState['announcement']
    }
    return done(json(200, { success: true, announcement: st.announcement }))
  }
  if (path === '/announcements') return json(200, { success: true, items: [...st.announcements].sort((a, b) => b.createdAt - a.createdAt) })
  if (path === '/admin/announcements' && method === 'POST') {
    if (!String(body.title ?? '').trim()) return fail('标题不能为空')
    const item = { id: rid('a'), title: String(body.title), content: String(body.content ?? ''), author: 'demo', createdAt: now() }
    st.announcements.push(item)
    return done(json(200, { success: true, item }))
  }
  if (path.startsWith('/admin/announcements/') && method === 'DELETE') {
    const id = decodeURIComponent(path.slice('/admin/announcements/'.length))
    st.announcements = st.announcements.filter((a) => a.id !== id)
    return done(json(200, { success: true }))
  }
  if (path === '/about') return json(200, { success: true, about: st.about })
  if (path === '/admin/about' && method === 'PUT') {
    const norm = (v: unknown) => (Array.isArray(v) ? v : String(v ?? '').split(/\r?\n/)).map((x) => String(x).trim()).filter(Boolean)
    st.about = { thanks: norm(body.thanks), sponsors: norm(body.sponsors) }
    return done(json(200, { success: true, about: st.about }))
  }

  if (path === '/admin/users' && method === 'GET') {
    return json(200, { success: true, users: [{ ...DEMO_USER, createdAt: st.servers[0]?.createdAt ?? now() }] })
  }
  if (path.startsWith('/admin/users')) return fail(DEMO_UNSUPPORTED.users)
  if (path === '/admin/smtp' && method === 'GET') {
    return json(200, {
      success: true,
      smtp: {
        configured: false, authMode: 'password', host: '', port: 465, user: '', from: '', secretConfigured: false,
        ms: { clientId: '', tenant: 'common', refreshTokenConfigured: false, accountEmail: '', tid: '', needsReauth: false, redirectFlowAvailable: false },
      },
    })
  }
  if (path.startsWith('/admin/smtp/ms') || path.startsWith('/admin/smtp/oauth2')) return fail(DEMO_UNSUPPORTED.oauth)
  if (path.startsWith('/admin/smtp')) return fail(DEMO_UNSUPPORTED.mail)
  if (path === '/admin/steam' && method === 'GET') return json(200, { success: true, configured: false, hint: '' })
  if (path.startsWith('/admin/steam') || path.startsWith('/steam/')) return fail(DEMO_UNSUPPORTED.steam, 404)

  if (path === '/servers' && method === 'GET') return json(200, { success: true, servers: st.servers.map(sanitize) })
  if (path === '/servers' && method === 'POST') {
    const host = String(body.host ?? '').trim()
    const port = Number(body.port)
    if (!host) return fail('主机不能为空')
    if (!Number.isInteger(port) || port < 1 || port > 65535) return fail('端口必须在 1-65535')
    const s: DemoServer = {
      id: rid('srv'), label: String(body.label ?? ''), host, port,
      controlTransport: body.controlTransport === 'ws' ? 'ws' : 'http',
      refetchInterval: Number(body.refetchInterval) || 5000,
      apiKeyConfigured: !!String(body.apiKey ?? ''), createdAt: now(),
    }
    st.servers.push(s)
    return done(json(200, { success: true, server: sanitize(s) }))
  }
  if (path.startsWith('/servers/')) {
    const id = decodeURIComponent(path.slice('/servers/'.length))
    const s = st.servers.find((x) => x.id === id)
    if (!s) return fail('服务器不存在', 404)
    if (method === 'DELETE') {
      st.servers = st.servers.filter((x) => x.id !== id)
      return done(json(200, { success: true }))
    }
    if (method === 'PUT') {
      Object.assign(s, {
        label: body.label !== undefined ? String(body.label) : s.label,
        host: body.host !== undefined ? String(body.host).trim() : s.host,
        port: body.port !== undefined ? Number(body.port) : s.port,
        controlTransport: body.controlTransport === 'ws' ? 'ws' : body.controlTransport === 'http' ? 'http' : s.controlTransport,
        refetchInterval: body.refetchInterval !== undefined ? Number(body.refetchInterval) : s.refetchInterval,
        apiKeyConfigured: body.apiKey !== undefined ? !!String(body.apiKey) : s.apiKeyConfigured,
      })
      return done(json(200, { success: true, server: sanitize(s) }))
    }
  }

  if (path === '/sl/data') {
    const s = st.servers.find((x) => x.id === url.searchParams.get('serverId'))
    if (!s) return fail('服务器不存在', 404)
    if (!isMockServer(s)) return fail(DEMO_UNSUPPORTED.realServer, 502)
    const p = url.searchParams.get('path') || '/get_sl_data'
    if (p === '/get_sl_data') return json(200, slData(s))
    if (p === '/plugins/adapted') return json(200, { success: true, adapted_plugins: slData(s).adapted_plugins })
    if (p.startsWith('/plugins/')) return json(200, { success: true, demo: true, path: p, message: '演示版模拟数据' })
    return fail('path 不在只读白名单')
  }
  if (path === '/sl/call' && method === 'POST') {
    const s = st.servers.find((x) => x.id === String(body.serverId ?? ''))
    if (!s) return fail('服务器不存在', 404)
    if (!isMockServer(s)) return fail(DEMO_UNSUPPORTED.realServer, 502)
    const cpath = String(body.path ?? '')
    if (!/^\/control\/[a-z][a-z0-9_]*(?:\/[a-z][a-z0-9_]*)*$/.test(cpath)) return fail('path 非法')
    const cbody = (body.body ?? {}) as Json
    const r = controlData(st, cpath, cbody)
    if (!['/control/audit/list', '/control/plugins', '/control/moderation/ban_list', '/control/logs', '/control/files/list', '/control/files/read', '/control/reports', '/control/map/seed', '/control/plugins/slplayer'].includes(cpath)) {
      st.audit.unshift({ time: new Date().toISOString(), actor: 'demo', endpoint: cpath, body: JSON.stringify(cbody).slice(0, 300), success: true, message: r.message })
      st.audit = st.audit.slice(0, 200)
    }
    return done(json(200, r))
  }

  return fail('演示版未模拟该接口', 404)
}

/** 安装 fetch 拦截：只处理 /api/*（含部署子路径前缀），其他请求原样放行。 */
export function installMockBackend(base: string): void {
  const prefix = base.replace(/\/$/, '')
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : undefined
    const url = new URL(req ? req.url : String(input), window.location.href)
    let p = url.pathname
    if (url.origin === window.location.origin) {
      if (prefix && p.startsWith(prefix + '/api/')) p = p.slice(prefix.length)
      if (p === '/api' || p.startsWith('/api/')) {
        const method = (init?.method ?? req?.method ?? 'GET').toUpperCase()
        const body = method === 'GET' || method === 'HEAD' ? {} : await readBody(init, req)
        await new Promise((r) => setTimeout(r, 60))
        return handle(p.slice(4) || '/', method, url, body)
      }
    }
    return realFetch(input as RequestInfo, init)
  }
}
