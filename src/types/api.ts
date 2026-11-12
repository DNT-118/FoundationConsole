/** SLDataAPI response shape — mirrors DNTOF/SLDataAPI /get_sl_data */

export interface SlPlayer {
  nickname: string
  steam_id?: string
  role: string
  team: string
  x?: number
  y?: number
  z?: number
}

export interface SlServerData {
  success: boolean
  server_name: string
  online: boolean
  players_count: number
  max_players: number
  round_started: boolean
  round_duration: number
  current_phase: string
  nuke_status: string
  nuke_countdown: number
  d_count: number
  foundation_count: number
  scp_count: number
  spectator_count: number
  ping: number
  players: SlPlayer[]
  /** SLDataAPI v2.3：语音转发端口（VoiceEnabled=true 时非 0） */
  voice_port?: number
  /** SLDataAPI v2.6.x：游戏版本串（如 "14.2.8"） */
  game_version?: string
  /** SLDataAPI v2.6.x：当前生效节日 None / Christmas / Halloween / AprilFools */
  active_holiday?: string
  /** 可选：DNT_OF 系列插件探测信息（SLPlayer / OmegaWarhead） */
  dntof_plugins?: DntofInfo | null
  /** SLDataAPI v2.5.5：适配插件发现（PluginEndpointRegistry 全部注册项） */
  adapted_plugins?: AdaptedPluginInfo[] | null
}

/**
 * SLDataAPI v2.5.5 Nexus —— 适配插件发现条目
 * （/get_sl_data 的 adapted_plugins 与 GET /plugins/adapted 共用此结构）。
 * status 为插件回调返回的任意 JSON（≤4KB），无回调时为 null。
 * actions：[内测] beta_adapted_plugin_actions 开启时才返回（POST /control/adapted/<id>/<action>）。
 */
export interface AdaptedPluginInfo {
  id: string
  name: string
  version: string
  capabilities: string[]
  /** 只读子路径名列表，可经 GET /plugins/<id>/<route> 查询 */
  routes: string[]
  /** [内测] 写/动作路由名列表，可经 POST /control/adapted/<id>/<action> 调用 */
  actions?: string[]
  status?: unknown
}

/** GET /plugins/adapted 响应体 */
export interface AdaptedPluginListResult {
  success: boolean
  adapted_plugins: AdaptedPluginInfo[]
}

/** Normalized domain model used across the UI. */
export type Team = 'D-Class' | 'Foundation' | 'SCP' | 'Spectator' | 'Unknown'
export type FoundationStatus = 'SAFE' | 'EUCLID' | 'KETER' | 'THAUMIEL'

export interface Player {
  nickname: string
  role: string
  team: Team
  /** Source API exposes no per-player ping/steamId yet — reserved for future. */
  steamId?: string
  ping?: number
  duration?: number
  /** 世界坐标（地图追踪用）。 */
  x?: number
  y?: number
  z?: number
}

export interface ServerState {
  id: string
  name: string
  online: boolean
  playersCount: number
  maxPlayers: number
  roundStarted: boolean
  roundDuration: number
  currentPhase: string
  /** 回合阶段码（UI 按语言翻译；未知值 null 时回退原文）。 */
  phaseCode: 'waiting' | 'inprogress' | 'ended' | 'paused' | null
  nukeStatus: string
  /** 核弹状态码（countdown 时用 nukeCountdown 渲染倒计时）。 */
  nukeCode: 'inactive' | 'countdown' | 'detonated' | null
  nukeCountdown: number
  teamCounts: Record<Team, number>
  ping: number
  players: Player[]
  /** When this snapshot was fetched. */
  fetchedAt: number
  /** 可选：DNT_OF 系列插件探测信息 */
  dntof: DntofInfo | null
  /** SLDataAPI v2.5.5：适配插件发现列表（旧版本服务端无此字段时为空数组） */
  adaptedPlugins: AdaptedPluginInfo[]
  /** SLDataAPI v2.3：语音转发端口（启用时非 0） */
  voicePort: number
  /** SLDataAPI v2.6.x：游戏版本串（旧版本服务端缺省时为空串） */
  gameVersion: string
  /** SLDataAPI v2.6.x：当前生效节日（None / Christmas / Halloween / AprilFools） */
  activeHoliday: string
}

// ================= SLDataAPI v2.1 控制接口 =================

/** /control/* 统一响应体。status：上游 HTTP 状态（WS 通道保留，HTTP 通道 = 平台回传状态）。 */
export interface ControlResult<T = unknown> {
  success: boolean
  message: string
  data?: T
  status?: number
}

/** /control/reports 单条未处理举报。 */
export interface ReportRecord {
  id: string
  reporter_steam64: string
  reporter_name: string
  reporter_ip: string
  target_steam64: string
  target_name: string
  reason: string
  reported_at: string
  status: 'pending' | 'handled'
}

/** DNT_OF 系列插件探测信息 */
export interface SlPlayerDetected {
  present: boolean
  source_mode: 'local' | 'remote'
  remote_url?: string | null
  now_playing?: string | null
}

export interface CoinHolderInfo {
  nickname: string
  count: number
  position: string
}

export interface OmegaWarheadDetected {
  present: boolean
  phase: 'none' | 'collecting' | 'idle_holding' | 'confirming' | 'locked' | 'counting' | 'detonation'
  coin_holders: CoinHolderInfo[]
  controller_holder?: string | null
  countdown?: number | null
}

export interface DntofInfo {
  sl_player?: SlPlayerDetected | null
  omega_warhead?: OmegaWarheadDetected | null
}

/** /control/plugins */
export interface PluginInfo {
  name: string
  author: string
  version: string
  prefix: string
  priority: string
  /** 运行框架来源：LabAPI 原生插件 / 同服 EXILED 插件。 */
  source?: 'labapi' | 'exiled'
  /** 配置文件（properties.yml / is_enabled）中的启停状态。 */
  enabled: boolean
  /** SLDataAPI 自身：禁止禁用。 */
  self?: boolean
  /** 暂存的启停目标（null = 无暂存）。 */
  staged?: boolean | null
}

/** /control/moderation/ban_list 单条封禁记录（expires/issuance_time 为 unix 秒，0 = 永久） */
export interface BanEntry {
  user_id: string
  original_name: string
  reason: string
  issuer: string
  ban_type: 'steam' | 'ip'
  expires: number
  issuance_time: number
}

/** /control/logs */
export interface LogTailResult {
  file: string
  /** 读取的日志文件绝对路径（服务端返回）。 */
  path?: string
  total: number
  lines: string[]
}

/** /control/logs action=list —— 可用日志文件 */
export interface LogFileInfo {
  path: string
  name: string
  size: number
  modified: string
}

export interface LogListResult {
  count: number
  files: LogFileInfo[]
}

/** /control/files/* */
export interface FileEntry {
  name: string
  type: 'dir' | 'file'
  size: number
  modified: string
  /** 顶级防线：位于 SLDataAPI 自身配置目录（受保护），前端显示黄色且禁止打开。 */
  protected?: boolean
}

export interface FileListResult {
  path: string
  count: number
  entries: FileEntry[]
}

export interface FileReadResult {
  path: string
  size: number
  modified: string
  content: string
}

export interface FileWriteResult {
  path: string
  bytes: number
}

/** /control/console/command 输出 */
export interface CommandResult {
  output: string
  /** 命令执行窗口内捕获的服务器控制台回显（插件命令输出等）。 */
  console?: string
}

/** /control/plugins/slplayer 状态（status action） */
export interface SlPlayerSong {
  index: number
  display: string
  duration_seconds: number
  current: boolean
}

export interface SlPlayerStatus {
  playing: boolean
  index: number
  song?: string | null
  elapsed_seconds: number
  duration_seconds: number
  volume: number
  shuffle: boolean
  source: 'local' | 'remote'
  remote_url?: string | null
  playlist_count: number
  playlist: SlPlayerSong[]
}

/** /control/map/layout —— 房间布局 */
export interface MapRoom {
  name: string
  /** 原始 RoomType 枚举名（未翻译；lights/doors 等控制请求必须用此值） */
  rawName?: string
  zone: string
  shape: string
  /** 网格对齐矩形（世界坐标）：顶点落在网格线上，前端直接画，无需旋转 */
  ax: number
  az: number
  aw: number
  ad: number
  grid_scale: number
  /** 原始中心/尺寸（备用） */
  x: number
  z: number
  y: number
  w: number
  d: number
  /** 连接方向（臂式渲染用：走廊/房间向邻格延伸的连接臂） */
  conn?: { dx: number; dz: number }[]
  /** 是否为走廊（Unnamed 候选生成；渲染为细臂而非房间体） */
  isCorridor?: boolean
  /** fxdyj 形状分类（octagon/hex/shield/dead/circle/gate/rect/corridor/pass） */
  glyph?: string
  /** 显示坐标（fxdyj 布局：核心区镜像 -x/-z，LCZ 平移到核心区上方） */
  rx?: number
  rz?: number
}

export interface MapLayout {
  ready: boolean
  count: number
  bounds: { min_x: number; max_x: number; min_z: number; max_z: number }
  rooms: MapRoom[]
  /** LCZ 显示平移量（fxdyj lightShift；玩家坐标映射用） */
  lightShift?: { dx: number; dz: number }
}

// ================= SLDataAPI 2.6.x 新增端点数据 =================

/** /control/dummies 单个假人（spawn/list/remove 共用）。 */
export interface DummyInfo {
  nickname: string
  player_id: number
  userid?: string
  role: string
  is_dummy: true
}

/** /control/dummies action=list */
export interface DummiesListResult {
  count: number
  max: number
  dummies: DummyInfo[]
}

/** /control/round/wave（mtf / chaos 波次查询与控制）。 */
export interface WaveStatusResult {
  faction: string
  time_left: number
  tokens?: number
}

/** /control/player/inventory 的物品栏描述（list/add/remove/clear 共用）。 */
export interface InventoryInfo {
  nickname: string
  player_id: number
  count: number
  capacity: number
  items: { type: string; serial: number }[]
  ammo: Record<string, number>
}

/** /control/player/candy 结果。 */
export interface CandyResult {
  requested: number
  given: string[]
  bag: string[]
  candy_pool: string
  active_holiday: string
}

/** /control/map/status —— 设施状态快照（各段读取失败时为 null）。 */
export interface MapStatusResult {
  round: {
    started: boolean
    ended: boolean
    duration_seconds: number
    locked: boolean
    lobby_locked: boolean
    players: number
    total_deaths: number
    killed_by_scps: number
    escaped_class_d: number
    escaped_scientists: number
    surviving_scps: number
    changed_into_zombies: number
  } | null
  decontamination: {
    status: string
    is_decontaminating: boolean
    server_time: number
  } | null
  generators: {
    total: number
    engaged: number
    list: { room: string; engaged: boolean; activating: boolean; remaining_time: number; is_open: boolean; is_unlocked: boolean }[]
  } | null
  warhead: {
    exists: boolean
    lever: string
    locked: boolean
    authorized: boolean
    in_progress: boolean
    detonated: boolean
    time_until_detonation: number | null
  } | null
  scp914: { knob: string; is_upgrading: boolean } | null
  holiday: {
    active_holiday: string
    game_version: string
    candy_pool: string
    candy_kinds: string[]
    test_override: string | null
  } | null
}
