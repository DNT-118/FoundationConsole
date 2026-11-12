import PageStub from '@/components/PageStub'
import { useT } from '@/i18n'
import { useI18nStore } from '@/i18n/store'
import { serverBaseUrl } from '@/store/serversStore'
import { useServersStore } from '@/store/serversStore'

interface EndpointDoc {
  method: 'GET' | 'POST'
  path: string
  auth: 'verify' | 'control'
  desc: { zh: string; en: string }
}

const ENDPOINTS: EndpointDoc[] = [
  { method: 'GET', path: '/plugins/adapted', auth: 'verify', desc: { zh: '适配插件发现；只读子路由使用 GET /plugins/<id>/<route>。', en: 'Adapted plugin discovery; read-only routes use GET /plugins/<id>/<route>.' } },
  {
    method: 'GET', path: '/get_sl_data', auth: 'verify',
    desc: { zh: '服务器实时数据：玩家列表（含 SteamID）、队伍分布、回合/核弹状态、游戏版本 game_version、当前节日 active_holiday、语音端口 voice_port、DNT_OF 插件探测、适配插件列表。', en: 'Live server data: players (with SteamID), team counts, round/warhead state, game_version, active_holiday, voice_port, DNT_OF plugin detection, adapted plugin list.' },
  },
  { method: 'POST', path: '/control/broadcast', auth: 'control', desc: { zh: '全服广播：message（最多500字符）、duration_seconds（1–60秒）、clear_previous。', en: 'Broadcast: message (max 500 characters), duration_seconds (1–60), clear_previous.' } },
  { method: 'POST', path: '/control/staffchat', auth: 'control', desc: { zh: '管理聊天：message、is_silent；仅 AdminChat 权限玩家可见。', en: 'Staff chat: message, is_silent; visible to players with AdminChat permission.' } },
  { method: 'POST', path: '/control/audit/list', auth: 'control', desc: { zh: '最近控制审计：limit（1–500）；新到旧排序，内容按 API Key 权限脱敏。', en: 'Recent control audit: limit (1–500), newest first; body visibility follows API Key permissions.' } },
  {
    method: 'POST', path: '/control/console/command', auth: 'control',
    desc: { zh: '执行获授权的控制台命令；远程禁止执行 sldataapi / slda 和密钥管理命令。', en: 'Run authorized console commands; remote sldataapi / slda and API key management are prohibited.' },
  },
  {
    method: 'POST', path: '/control/player/data', auth: 'control',
    desc: { zh: '玩家档案（只读）：生命/护盾/体力/物品/弹药/效果/TemporaryBypass。body: target。', en: 'Player profile (read-only): health/AHP/stamina/items/ammo/effects/TemporaryBypass. body: target.' },
  },
  {
    method: 'POST', path: '/control/player/inventory', auth: 'control',
    desc: { zh: '物品栏：action=list/add/remove/clear + item + amount（≤8）；节日物品未开启时返回 409 holiday_inactive。', en: 'Inventory: action=list/add/remove/clear + item + amount (≤8); returns 409 holiday_inactive when a holiday item is locked.' },
  },
  {
    method: 'POST', path: '/control/player/candy', auth: 'control',
    desc: { zh: 'SCP-330 糖果：candy（CandyKindID 名或 random）+ amount（≤6）；节日糖果按当前节日自动门控。', en: 'SCP-330 candy: candy (CandyKindID name or random) + amount (≤6); holiday candies are gated by the active holiday.' },
  },
  {
    method: 'POST', path: '/control/moderation/kick', auth: 'control',
    desc: { zh: '踢出玩家。body: target（昵称/UserId/数字ID）+ reason。', en: 'Kick a player. body: target (nickname/UserId/ID) + reason.' },
  },
  {
    method: 'POST', path: '/control/moderation/ban', auth: 'control',
    desc: { zh: '封禁在线玩家。body: target + reason + duration（分钟，0=永久）。', en: 'Ban an online player. body: target + reason + duration (minutes, 0=permanent).' },
  },
  {
    method: 'POST', path: '/control/player/role', auth: 'control',
    desc: { zh: '更换玩家职业。body: target + role（RoleTypeId 名）。', en: 'Change player role. body: target + role (RoleTypeId name).' },
  },
  {
    method: 'POST', path: '/control/admin/teleport', auth: 'control',
    desc: { zh: '传送玩家。body: target + x/y/z 世界坐标。', en: 'Teleport a player. body: target + x/y/z world coords.' },
  },
  {
    method: 'POST', path: '/control/admin/state', auth: 'control',
    desc: { zh: '玩家状态：godmode / bypass / intercom / health。body: target + 字段（全部缺省 = 只读查询）。', en: 'Player state: godmode / bypass / intercom / health. body: target + fields (all omitted = read-only query).' },
  },
  {
    method: 'POST', path: '/control/moderation/mute', auth: 'control',
    desc: { zh: '语音禁言/解除。body: target + mute（true/false）+ mute_scope（voice/intercom）+ persistent。', en: 'Mute/unmute voice chat. body: target + mute (true/false) + mute_scope (voice/intercom) + persistent.' },
  },
  {
    method: 'POST', path: '/control/moderation/msg', auth: 'control',
    desc: { zh: '给玩家发消息。body: target + message + msg_type（hint/broadcast）+ duration_seconds。', en: 'Message a player. body: target + message + msg_type (hint/broadcast) + duration_seconds.' },
  },
  {
    method: 'POST', path: '/control/round', auth: 'control',
    desc: { zh: '回合控制。body: action = restart | end | start。', en: 'Round control. body: action = restart | end | start.' },
  },
  {
    method: 'POST', path: '/control/round/wave', auth: 'control',
    desc: { zh: '重生波次。body: faction（mtf/chaos）+ action = instant | set（seconds/tokens）| status。', en: 'Respawn wave. body: faction (mtf/chaos) + action = instant | set (seconds/tokens) | status.' },
  },
  {
    method: 'POST', path: '/control/cassie', auth: 'control',
    desc: { zh: 'CASSIE 播报。body: message + isHeld/isNoisy/isSubtitles + translation（字幕翻译，可选）。', en: 'CASSIE announcement. body: message + isHeld/isNoisy/isSubtitles + translation (subtitle text, optional).' },
  },
  {
    method: 'POST', path: '/control/round/warhead', auth: 'control',
    desc: { zh: '核弹控制。body: action = start | stop | detonate。', en: 'Warhead control. body: action = start | stop | detonate.' },
  },
  {
    method: 'POST', path: '/control/dummies', auth: 'control',
    desc: { zh: '假人（admin）：action = spawn（nickname/role）| list | remove（target=PlayerId/昵称/all）。同时最多 5 个。', en: 'Dummies (admin): action = spawn (nickname/role) | list | remove (target=PlayerId/nickname/all). Max 5 alive.' },
  },
  {
    method: 'POST', path: '/control/map/facility', auth: 'control',
    desc: { zh: '门/电梯/灯光控制：action = doors（door_type/scope/lock_door/open_door）| elevators（elevator_type/command/level）| lights（room_type/lights_off/color/flicker_seconds）。', en: 'Doors/elevators/lights: action = doors (door_type/scope/lock_door/open_door) | elevators (elevator_type/command/level) | lights (room_type/lights_off/color/flicker_seconds).' },
  },
  {
    method: 'POST', path: '/control/map/layout', auth: 'control',
    desc: { zh: '房间布局（只读，本回合随机布局）。', en: 'Room layout (read-only, random per round).' },
  },
  {
    method: 'POST', path: '/control/map/seed', auth: 'control',
    desc: { zh: '回合种子（只读）。', en: 'Round seed (read-only).' },
  },
  {
    method: 'POST', path: '/control/map/export', auth: 'control',
    desc: { zh: '布局导出（含区域生成元数据）。', en: 'Layout export (with zone generation metadata).' },
  },
  {
    method: 'POST', path: '/control/map/status', auth: 'control',
    desc: { zh: '设施状态快照（只读）：回合统计 / 去污 / 发电机 / 核弹 / SCP-914 / 节日（candy_pool 等）。', en: 'Facility status snapshot (read-only): round stats / decontamination / generators / warhead / SCP-914 / holiday (candy_pool etc.).' },
  },
  {
    method: 'POST', path: '/control/plugins', auth: 'control',
    desc: { zh: '插件列表与启停（LabAPI + EXILED）：action = 空（列表）| reload | stage（name/enabled）| clear | apply。', en: 'Plugin list & enable/disable (LabAPI + EXILED): action = empty (list) | reload | stage (name/enabled) | clear | apply.' },
  },
  {
    method: 'POST', path: '/control/plugins/slplayer', auth: 'control',
    desc: { zh: 'SLPlayer 音乐控制：action = status | list | play | next | stop | volume | shuffle | reload | fetch。', en: 'SLPlayer music control: action = status | list | play | next | stop | volume | shuffle | reload | fetch.' },
  },
  {
    method: 'POST', path: '/control/adapted/<plugin_id>/<action>', auth: 'control',
    desc: { zh: '［内测 beta_adapted_plugin_actions］适配插件写/动作路由；默认拒绝，需 Key endpoints_override 显式放开。', en: '[beta_adapted_plugin_actions] Adapted plugin write/action routes; denied by default, grant via key endpoints_override.' },
  },
  {
    method: 'POST', path: '/control/moderation/ban_list', auth: 'control',
    desc: { zh: '封禁列表（Steam + IP 两类，含到期时间）。', en: 'Ban list (Steam + IP entries, with expiry).' },
  },
  {
    method: 'POST', path: '/control/moderation/ban/add', auth: 'control',
    desc: { zh: '新增封禁（支持离线玩家）。body: user_id + duration + ban_type（steam/ip）+ reason。', en: 'Add a ban (works offline). body: user_id + duration + ban_type (steam/ip) + reason.' },
  },
  {
    method: 'POST', path: '/control/moderation/ban/revoke', auth: 'control',
    desc: { zh: '解除封禁。body: user_id + ban_type。', en: 'Revoke a ban. body: user_id + ban_type.' },
  },
  {
    method: 'POST', path: '/control/logs', auth: 'control',
    desc: { zh: '服务器日志尾部。body: action=list（列文件）| 空（尾部）+ lines（默认200，上限2000）+ filter + path。', en: 'Server log tail. body: action=list (list files) | empty (tail) + lines (default 200, max 2000) + filter + path.' },
  },
  {
    method: 'POST', path: '/control/reports', auth: 'control',
    desc: { zh: '举报记录管理。body: action=list 读取未处理记录；action=handle + id 标记已处理。需 report_enabled=true。', en: 'Report management. body: action=list for pending reports; action=handle + id marks one handled. Requires report_enabled=true.' },
  },
  {
    method: 'POST', path: '/control/files/list', auth: 'control',
    desc: { zh: '文件目录列表（相对 FileRoot）。body: path。', en: 'File directory listing (relative to FileRoot). body: path.' },
  },
  {
    method: 'POST', path: '/control/files/read', auth: 'control',
    desc: { zh: '读取文件内容（上限 1MB）。body: path。', en: 'Read a file (max 1MB). body: path.' },
  },
  {
    method: 'POST', path: '/control/files/write', auth: 'control',
    desc: { zh: '写入/覆盖文件（上限 512KB，自动建父目录）。body: path + content。', en: 'Write/overwrite a file (max 512KB, creates parent dirs). body: path + content.' },
  },
  {
    method: 'POST', path: '/control/files/stat | read_chunk | write_chunk', auth: 'control',
    desc: { zh: '［内测 beta_file_root_ws］分块读写（base64 + sha256 校验，突破单请求体积限制）与文件 stat。', en: '[beta_file_root_ws] Chunked read/write (base64 + sha256 verification, bypasses single-request size limits) and file stat.' },
  },
]

const AUTH_LABEL: Record<'verify' | 'control', { zh: string; en: string }> = {
  verify: { zh: 'VerifyToken', en: 'VerifyToken' },
  control: { zh: 'API Key', en: 'API Key' },
}

export default function Api() {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const langKey = lang === 'zh-CN' ? 'zh' : 'en'
  const servers = useServersStore((s) => s.servers)
  const activeId = useServersStore((s) => s.activeId)
  const active = servers.find((s) => s.id === activeId) ?? servers[0] ?? null

  return (
    <PageStub code="M-13" title={t('nav.api')}>
      <div className="flex h-full flex-col space-y-3">
        <p className="text-sm text-ink-mute">{langKey === 'zh' ? 'SLDataAPI 2.6.x（main · bb002dd 之后）：数据口使用 VerifyToken（Bearer / X-SLDataAPI-Token）；控制、事件与语音使用 API Key（Bearer / X-SLDataAPI-Key，duty/admin 角色创建时固定）。平台自动注入凭据。节日相关功能未开启时上游返回 409 holiday_inactive，控制台会给出友好提示。' : 'SLDataAPI 2.6.x (main, after bb002dd): data uses a VerifyToken (Bearer / X-SLDataAPI-Token); control, events and voice use API Keys (Bearer / X-SLDataAPI-Key, duty/admin role fixed at creation). The platform injects credentials. Holiday-gated features return 409 holiday_inactive when inactive, surfaced with a friendly hint.'}</p>
        {active && (
          <p className="font-mono text-[10px] text-ink-mute">
            // {t('api.base')}: <span className="text-foreground">{serverBaseUrl(active)}</span>
            {' '}· {t('api.read')}: <span className="text-scp-safe">{t('api.verifyToken')}</span>
            {' '}· {t('api.control')}: <span className="text-scp-warn">{t('api.apiKey')}</span>
          </p>
        )}

        <div className="flex min-h-0 flex-1 flex-col border border-ink-border bg-ink-deep">
          <div className="border-b border-ink-border px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
              {t('api.doc')} — {ENDPOINTS.length}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse font-mono text-[11px]">
              <thead>
                <tr className="border-b border-ink-border text-left text-[9px] uppercase tracking-wider text-ink-mute">
                  <th className="px-3 py-2 font-normal">{t('api.method')}</th>
                  <th className="px-3 py-2 font-normal">{t('api.path')}</th>
                  <th className="px-3 py-2 font-normal">{t('api.auth')}</th>
                  <th className="px-3 py-2 font-normal">{t('api.desc')}</th>
                </tr>
              </thead>
              <tbody>
                {ENDPOINTS.map((e) => (
                  <tr key={e.path} className="border-b border-ink-border/60 hover:bg-ink">
                    <td className={`px-3 py-2 ${e.method === 'GET' ? 'text-scp-safe' : 'text-scp-warn'}`}>
                      {e.method}
                    </td>
                    <td className="px-3 py-2 break-all text-foreground">{e.path}</td>
                    <td className="px-3 py-2 text-ink-mute">
                      {AUTH_LABEL[e.auth][langKey]}
                    </td>
                    <td className="px-3 py-2 text-ink-mute">
                      {e.desc[langKey]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PageStub>
  )
}
