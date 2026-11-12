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
  { method: 'POST', path: '/control/broadcast', auth: 'control', desc: { zh: '全服广播：message（最多500字符）、duration_seconds（1–60秒）、clear_previous。', en: 'Broadcast: message (max 500 characters), duration_seconds (1–60), clear_previous.' } },
  { method: 'POST', path: '/control/staffchat', auth: 'control', desc: { zh: '管理聊天：message、is_silent；仅 AdminChat 权限玩家可见。', en: 'Staff chat: message, is_silent; visible to players with AdminChat permission.' } },
  { method: 'POST', path: '/control/audit/list', auth: 'control', desc: { zh: '最近控制审计：limit（1–500）；新到旧排序，内容按 API Key 权限脱敏。', en: 'Recent control audit: limit (1–500), newest first; body visibility follows API Key permissions.' } },
  {
    method: 'GET', path: '/get_sl_data', auth: 'verify',
    desc: { zh: '服务器实时数据：玩家列表（含 SteamID）、队伍分布、回合/核弹状态、DNT_OF 插件探测。', en: 'Live server data: players (with SteamID), team counts, round/warhead state, DNT_OF plugin detection.' },
  },
  {
    method: 'POST', path: '/control/console/command', auth: 'control',
    desc: { zh: '执行获授权的控制台命令；远程禁止执行 sldataapi / slda 和密钥管理命令。', en: 'Run authorized console commands; remote sldataapi / slda and API key management are prohibited.' },
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
    method: 'POST', path: '/control/moderation/mute', auth: 'control',
    desc: { zh: '语音禁言/解除。body: target + mute（true/false）。', en: 'Mute/unmute voice chat. body: target + mute (true/false).' },
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
    method: 'POST', path: '/control/cassie', auth: 'control',
    desc: { zh: 'CASSIE 播报。body: message + isHeld/isNoisy/isSubtitles。', en: 'CASSIE announcement. body: message + isHeld/isNoisy/isSubtitles.' },
  },
  {
    method: 'POST', path: '/control/round/warhead', auth: 'control',
    desc: { zh: '核弹控制。body: action = start | stop | detonate。', en: 'Warhead control. body: action = start | stop | detonate.' },
  },
  {
    method: 'POST', path: '/control/plugins', auth: 'control',
    desc: { zh: 'EXILED 插件列表（名称/作者/版本/启用状态）。', en: 'EXILED plugin list (name/author/version/enabled).' },
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
    desc: { zh: '服务器日志尾部。body: lines（默认200，上限2000）+ filter 关键词。', en: 'Server log tail. body: lines (default 200, max 2000) + filter keyword.' },
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
        <p className="text-sm text-ink-mute">{langKey === 'zh' ? 'SLDataAPI 2.6.0 PEAK：数据口使用 VerifyToken 请求头；控制、事件与语音使用 API Key。平台自动注入凭据。inventory / dummies 仍未实现（501）。' : 'SLDataAPI 2.6.0 PEAK: data uses a VerifyToken header; control, events and voice use API Key headers. The platform injects credentials. Inventory / dummies remain unimplemented (501).'}</p>
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
