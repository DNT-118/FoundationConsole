/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
import { useEffect, useRef, useState } from 'react'
import { Settings as SettingsIcon, Save, Users as UsersIcon, Loader2, Mail, Send, Image as ImageIcon, ExternalLink } from 'lucide-react'
import PageStub from '@/components/PageStub'
import { useT } from '@/i18n'
import { useI18nStore, type Lang } from '@/i18n/store'
import { useThemeStore } from '@/store/themeStore'
import { bgPrefOf, isValidBgUrl, setBgImage, useBgStore, BG_UPLOAD_MAX_BYTES } from '@/store/bgStore'
import { useServersStore, serverLabel } from '@/store/serversStore'
import { useAuthStore } from '@/store/authStore'
import { api, getAnnouncement, saveAnnouncement, type AnnouncementData } from '@/api/platform'
import type { UserRole } from '@/lib/vault'

/** 危险操作确认开关的 localStorage 键：'0' = 跳过确认。 */
export const CONFIRM_DANGER_KEY = 'pfc.confirmDanger'

export function isConfirmDangerEnabled(): boolean {
  try {
    return localStorage.getItem(CONFIRM_DANGER_KEY) !== '0'
  } catch {
    return true
  }
}

interface AdminUser {
  username: string
  email: string
  role: UserRole
  createdAt: number
}

/** 微软个人账户租户（outlook.com 个人邮箱）——与 server/msOAuth.js 保持一致。 */
const MS_PERSONAL_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad'

/** GET /api/admin/smtp 的安全视图（secret 只回布尔，绝不回明文）。 */
interface SmtpView {
  configured: boolean
  authMode: 'password' | 'oauth2'
  host: string
  port: number
  user: string
  from: string
  secretConfigured: boolean
  ms?: {
    clientId: string
    tenant: string
    refreshTokenConfigured: boolean
    accountEmail: string
    tid: string
    needsReauth: boolean
    redirectFlowAvailable: boolean
  }
}

export default function Settings() {
  const t = useT()
  const { lang, setLang } = useI18nStore()
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  // ===== 背景偏好（按用户保存在本浏览器；仅 anime 主题显示自定义背景） =====
  const bgUser = useAuthStore((s) => s.session?.username ?? '')
  const byUser = useBgStore((s) => s.byUser)
  const bgSet = useBgStore((s) => s.set)
  const bg = bgPrefOf(byUser, bgUser)
  const [bgUrlInput, setBgUrlInput] = useState(bg.mode === 'url' ? bg.url : '')
  const [bgMsg, setBgMsg] = useState<string | null>(null)
  const bgFileRef = useRef<HTMLInputElement>(null)
  // 切换用户时同步 URL 输入框
  useEffect(() => {
    const p = bgPrefOf(useBgStore.getState().byUser, bgUser)
    setBgUrlInput(p.mode === 'url' ? p.url : '')
    setBgMsg(null)
  }, [bgUser])

  function applyBgUrl() {
    const u = bgUrlInput.trim()
    if (!u) { setBgMsg(t('settings.bg.urlInvalid')); return }
    if (!isValidBgUrl(u)) { setBgMsg(t('settings.bg.urlInvalid')); return }
    bgSet(bgUser, { mode: 'url', url: u })
    setBgMsg(null)
  }

  function onBgUploadFile(file: File | undefined | null) {
    if (!file) return
    if (file.size > BG_UPLOAD_MAX_BYTES) { setBgMsg(t('settings.bg.tooLarge')); return }
    const reader = new FileReader()
    reader.onload = () => {
      const data = String(reader.result ?? '')
      if (!data.startsWith('data:image/')) { setBgMsg(t('settings.bg.urlInvalid')); return }
      // 图片本体写独立 localStorage 键（按用户）；偏好里只记标志
      setBgImage(bgUser, data)
      bgSet(bgUser, { mode: 'upload', hasImage: true })
      setBgMsg(null)
    }
    reader.onerror = () => setBgMsg(t('common.err'))
    reader.readAsDataURL(file)
  }

  const servers = useServersStore((s) => s.servers)
  const activeId = useServersStore((s) => s.activeId)
  const update = useServersStore((s) => s.update)
  const role = useAuthStore((s) => s.session?.role)
  const sessionToken = useAuthStore((s) => s.session?.token)

  const active = servers.find((s) => s.id === activeId) ?? servers[0] ?? null
  const [interval, setInterval] = useState(String(active?.refetchInterval ?? 5000))
  const [confirmDanger, setConfirmDanger] = useState(isConfirmDangerEnabled())
  const [savedMsg, setSavedMsg] = useState(false)

  // ===== 管理员：邮箱配置 =====
  const [smtp, setSmtp] = useState({
    authMode: 'password' as 'password' | 'oauth2',
    host: 'smtp.qq.com', port: 465, user: '', from: '',
    pass: '',
  })
  const [secretConfigured, setSecretConfigured] = useState(false)
  const [clearPass, setClearPass] = useState(false)
  const [smtpConfigured, setSmtpConfigured] = useState(false)
  const [smtpMsg, setSmtpMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [smtpBusy, setSmtpBusy] = useState(false)
  const [smtpTesting, setSmtpTesting] = useState(false)
  const [smtpTestMsg, setSmtpTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [oauthBusy, setOauthBusy] = useState(false)
  const [oauthMsg, setOauthMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // Microsoft OAuth 状态（GET /admin/smtp 的 ms 段）
  const [ms, setMs] = useState<SmtpView['ms'] | null>(null)
  // 设备代码流：发起后的用户码与轮询
  const [device, setDevice] = useState<{ id: string; userCode: string; verificationUri: string; expiresAt: number; interval: number } | null>(null)
  const devicePollRef = useRef<number | null>(null)

  // ===== 管理员：Steam API Key =====
  const [steamKey, setSteamKeyInput] = useState('')
  const [steamConfigured, setSteamConfigured] = useState(false)
  const [steamMsg, setSteamMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [steamBusy, setSteamBusy] = useState(false)

  // ===== 管理员：公告配置 =====
  const [ann, setAnn] = useState<AnnouncementData | null>(null)
  const [annBusy, setAnnBusy] = useState(false)
  const [annMsg, setAnnMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Microsoft OAuth 回跳结果（/settings?msauth=ok|error&msg=...）
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('msauth') === 'ok') {
      setOauthMsg({ ok: true, text: '✓ ' + t('settings.msDone') })
      // 回跳成功后刷新 MS 状态
      void api<{ smtp: SmtpView }>('/admin/smtp', { token: sessionToken ?? '' })
        .then((r) => setMs(r.smtp.ms ?? null))
        .catch(() => { /* ignore */ })
    } else if (q.get('msauth') === 'error') {
      setOauthMsg({ ok: false, text: '✗ ' + (q.get('msg') ?? t('common.err')) })
    }
    if (q.has('msauth')) window.history.replaceState({}, '', window.location.pathname)
    // 卸载时停止设备码轮询
    return () => { if (devicePollRef.current !== null) window.clearTimeout(devicePollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  // ===== 管理员：用户管理 =====
  const [users, setUsers] = useState<AdminUser[]>([])
  const [newUser, setNewUser] = useState({ email: '', username: '', password: '', role: 'guest' as UserRole })
  const [acctMsg, setAcctMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [acctBusy, setAcctBusy] = useState(false)

  const isAdmin = role === 'admin'

  useEffect(() => {
    // 注意：不能用 !sessionToken 拦截——cookie 会话下刷新后内存 token 为空，
    // 服务端靠 HttpOnly cookie 鉴权，这里只需判断是否管理员
    if (!isAdmin) return
    void api<{ smtp: SmtpView }>('/admin/smtp', { token: sessionToken ?? '' }).then((r) => {
      const s = r.smtp
      setSmtpConfigured(s.configured)
      setSecretConfigured(!!s.secretConfigured)
      setMs(s.ms ?? null)
      if (s.configured) {
        setSmtp({
          authMode: s.authMode === 'oauth2' ? 'oauth2' : 'password',
          host: s.host, port: s.port, user: s.user, from: s.from,
          pass: '',
        })
        setClearPass(false)
      }
    }).catch(() => { /* ignore */ })
    void loadUsers()
    void api<{ configured: boolean; hint: string }>('/admin/steam', { token: sessionToken ?? '' })
      .then((r) => setSteamConfigured(r.configured))
      .catch(() => { /* ignore */ })
    void getAnnouncement(sessionToken ?? '')
      .then(setAnn)
      .catch(() => { /* ignore */ })
  }, [isAdmin, sessionToken])

  /** 拉取 SMTP 安全视图（设备码授权完成后调用）。 */
  async function reloadSmtpView() {
    const r = await api<{ smtp: SmtpView }>('/admin/smtp', { token: sessionToken ?? '' })
    const s = r.smtp
    setSmtpConfigured(s.configured)
    setSecretConfigured(!!s.secretConfigured)
    setMs(s.ms ?? null)
    if (s.configured) {
      setSmtp((prev) => ({
        ...prev,
        authMode: s.authMode === 'oauth2' ? 'oauth2' : 'password',
        host: s.host, port: s.port, user: prev.user || s.user, from: prev.from || s.from,
      }))
    }
    return s
  }

  async function loadUsers() {
    try {
      const r = await api<{ users: AdminUser[] }>('/admin/users', { token: sessionToken ?? '' })
      setUsers(r.users)
    } catch { /* ignore */ }
  }

  async function saveSmtp() {
    setSmtpMsg(null)
    setSmtpBusy(true)
    try {
      // 空密码 = 保留已存值；勾选清除才传 null。secret/refreshToken 不经表单（MS 流程管理）
      await api<{ smtp: SmtpView }>('/admin/smtp', {
        method: 'PUT',
        token: sessionToken ?? '',
        body: {
          authMode: smtp.authMode,
          host: smtp.host,
          port: smtp.port,
          user: smtp.user,
          from: smtp.from,
          pass: clearPass ? null : (smtp.pass || undefined),
        },
      })
      setSmtpConfigured(true)
      setSecretConfigured(clearPass ? false : secretConfigured || !!smtp.pass)
      setSmtp((s) => ({ ...s, pass: '' }))
      setClearPass(false)
      await reloadSmtpView()
      setSmtpMsg({ ok: true, text: '✓' })
    } catch (e) {
      setSmtpMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setSmtpBusy(false)
    }
  }

  async function testSmtp() {
    setSmtpTestMsg(null)
    setSmtpTesting(true)
    try {
      // 只发收件人：凭据一律用服务器已保存的配置（先保存再测试）
      const r = await api<{ success: boolean; message?: string; host?: string; port?: number; ip?: string }>(
        '/admin/smtp/test',
        { method: 'POST', token: sessionToken ?? '', body: { to: smtp.user || smtp.from } },
      )
      if (r.success) {
        setSmtpTestMsg({ ok: true, text: `✓ ${t('settings.smtpTestOk')}（${r.host}:${r.port} → ${r.ip}）` })
      } else {
        setSmtpTestMsg({ ok: false, text: `✗ ${r.message ?? t('common.err')}（${r.host ?? ''}:${r.port ?? ''} → ${r.ip ?? ''}）` })
      }
    } catch (e) {
      setSmtpTestMsg({ ok: false, text: `✗ ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setSmtpTesting(false)
    }
  }

  async function saveSteam() {
    setSteamMsg(null)
    setSteamBusy(true)
    try {
      await api('/admin/steam', {
        method: 'PUT',
        token: sessionToken ?? '',
        body: { key: steamKey.trim() },
      })
      setSteamConfigured(!!steamKey.trim())
      setSteamKeyInput('')
      setSteamMsg({ ok: true, text: '✓' })
    } catch (e) {
      setSteamMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setSteamBusy(false)
    }
  }

  async function saveAnnouncementCfg() {
    if (!ann) return
    setAnnMsg(null)
    setAnnBusy(true)
    try {
      const saved = await saveAnnouncement(ann, sessionToken ?? '')
      setAnn(saved)
      setAnnMsg({ ok: true, text: t('settings.announcementSaved') })
    } catch (e) {
      setAnnMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setAnnBusy(false)
    }
  }

  /** 设备代码流：发起 + 按 interval 轮询（pending/slow_down/declined/expired/error 全处理）。 */
  async function connectMicrosoftDevice() {
    setOauthMsg(null)
    setOauthBusy(true)
    setDevice(null)
    try {
      const r = await api<{ success: boolean; id?: string; userCode?: string; verificationUri?: string; expiresIn?: number; interval?: number; message?: string }>(
        '/admin/smtp/ms/device/start', { method: 'POST', token: sessionToken ?? '' },
      )
      if (!r.success || !r.id) {
        setOauthMsg({ ok: false, text: `✗ ${r.message ?? t('common.err')}` })
        return
      }
      const started = {
        id: r.id,
        userCode: r.userCode ?? '',
        verificationUri: r.verificationUri ?? 'https://microsoft.com/devicelogin',
        expiresAt: Date.now() + (r.expiresIn ?? 900) * 1000,
        interval: r.interval ?? 5,
      }
      setDevice(started)
      scheduleDevicePoll(started)
    } catch (e) {
      setOauthMsg({ ok: false, text: `✗ ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setOauthBusy(false)
    }
  }

  function scheduleDevicePoll(d: { id: string; interval: number; expiresAt: number }) {
    if (devicePollRef.current !== null) window.clearTimeout(devicePollRef.current)
    devicePollRef.current = window.setTimeout(() => { void pollDevice(d) }, Math.max(2, d.interval) * 1000)
  }

  async function pollDevice(d: { id: string; interval: number; expiresAt: number }) {
    if (Date.now() > d.expiresAt) {
      setDevice(null)
      setOauthMsg({ ok: false, text: '✗ ' + t('settings.msExpired') })
      return
    }
    try {
      const r = await api<{ success: boolean; status?: string; interval?: number; message?: string; accountEmail?: string; smtpHost?: string }>(
        '/admin/smtp/ms/device/poll',
        { method: 'POST', token: sessionToken ?? '', body: { id: d.id } },
      )
      switch (r.status) {
        case 'pending':
          scheduleDevicePoll({ ...d, interval: r.interval ?? d.interval })
          return
        case 'slow_down':
          scheduleDevicePoll({ ...d, interval: r.interval ?? (d.interval + 5) })
          return
        case 'done': {
          setDevice(null)
          await reloadSmtpView()
          setOauthMsg({ ok: true, text: '✓ ' + t('settings.msDone') + (r.accountEmail ? ` (${r.accountEmail})` : '') })
          return
        }
        case 'declined':
          setDevice(null)
          setOauthMsg({ ok: false, text: '✗ ' + t('settings.msDeclined') })
          return
        case 'expired':
          setDevice(null)
          setOauthMsg({ ok: false, text: '✗ ' + t('settings.msExpired') })
          return
        default:
          setDevice(null)
          setOauthMsg({ ok: false, text: `✗ ${r.message ?? t('common.err')}` })
      }
    } catch (e) {
      // 网络抖动：按当前间隔继续重试，直到过期
      scheduleDevicePoll(d)
      setOauthMsg({ ok: false, text: `⚠ ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  /** 可选：授权码 + PKCE 跳转流（需 PFC_MS_REDIRECT_URI / PFC_PUBLIC_URL）。 */
  async function connectMicrosoftRedirect() {
    setOauthMsg(null)
    setOauthBusy(true)
    try {
      const r = await api<{ success: boolean; url?: string; message?: string }>(
        '/admin/smtp/ms/authorize/start', { token: sessionToken ?? '' },
      )
      if (r.success && r.url) {
        window.location.href = r.url   // 跳转微软登录页，授权后回跳 /settings?msauth=ok|error
        return
      }
      setOauthMsg({ ok: false, text: `✗ ${r.message ?? t('common.err')}` })
    } catch (e) {
      setOauthMsg({ ok: false, text: `✗ ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setOauthBusy(false)
    }
  }

  async function disconnectMicrosoft() {
    setOauthMsg(null)
    setOauthBusy(true)
    try {
      await api('/admin/smtp/ms/disconnect', { method: 'POST', token: sessionToken ?? '' })
      await reloadSmtpView()
      setOauthMsg({ ok: true, text: '✓ ' + t('settings.msDisconnected') })
    } catch (e) {
      setOauthMsg({ ok: false, text: `✗ ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setOauthBusy(false)
    }
  }

  async function createUser() {
    setAcctMsg(null)
    setAcctBusy(true)
    try {
      await api('/admin/users', {
        method: 'POST',
        token: sessionToken ?? '',
        body: newUser,
      })
      setNewUser({ email: '', username: '', password: '', role: 'guest' })
      await loadUsers()
      setAcctMsg({ ok: true, text: '✓' })
    } catch (e) {
      setAcctMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setAcctBusy(false)
    }
  }

  async function removeUser(username: string) {
    setAcctMsg(null)
    setAcctBusy(true)
    try {
      await api(`/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE', token: sessionToken ?? '' })
      await loadUsers()
      setAcctMsg({ ok: true, text: '✓' })
    } catch (e) {
      setAcctMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setAcctBusy(false)
    }
  }

  async function changeRole(username: string, r: UserRole) {
    setAcctMsg(null)
    setAcctBusy(true)
    try {
      await api(`/admin/users/${encodeURIComponent(username)}`, {
        method: 'PUT',
        token: sessionToken ?? '',
        body: { role: r },
      })
      await loadUsers()
      setAcctMsg({ ok: true, text: '✓' })
    } catch (e) {
      setAcctMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setAcctBusy(false)
    }
  }

  // ===== 双因素验证（TOTP）=====
  const [twofaEnabled, setTwofaEnabled] = useState(false)
  const [twofaSetup, setTwofaSetup] = useState<{ secret: string; uri: string } | null>(null)
  const [twofaCode, setTwofaCode] = useState('')
  const [twofaMsg, setTwofaMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [twofaBusy, setTwofaBusy] = useState(false)

  useEffect(() => {
    if (!sessionToken) return
    void api<{ enabled: boolean }>('/auth/2fa/status', { token: sessionToken ?? '' })
      .then((r) => setTwofaEnabled(r.enabled))
      .catch(() => { /* ignore */ })
  }, [sessionToken])

  async function startTwofaSetup() {
    setTwofaMsg(null)
    setTwofaBusy(true)
    try {
      const r = await api<{ secret: string; uri: string }>('/auth/2fa/setup', { method: 'POST', token: sessionToken ?? '' })
      setTwofaSetup({ secret: r.secret, uri: r.uri })
      setTwofaCode('')
    } catch (e) {
      setTwofaMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setTwofaBusy(false)
    }
  }

  async function enableTwofa() {
    if (!twofaSetup) return
    setTwofaMsg(null)
    setTwofaBusy(true)
    try {
      await api('/auth/2fa/enable', {
        method: 'POST', token: sessionToken ?? '',
        body: { secret: twofaSetup.secret, code: twofaCode.trim() },
      })
      setTwofaEnabled(true)
      setTwofaSetup(null)
      setTwofaMsg({ ok: true, text: '✓' })
    } catch (e) {
      setTwofaMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setTwofaBusy(false)
    }
  }

  async function disableTwofa() {
    setTwofaMsg(null)
    setTwofaBusy(true)
    try {
      await api('/auth/2fa/disable', {
        method: 'POST', token: sessionToken ?? '', body: { code: twofaCode.trim() },
      })
      setTwofaEnabled(false)
      setTwofaMsg({ ok: true, text: '✓' })
    } catch (e) {
      setTwofaMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setTwofaBusy(false)
    }
  }

  function savePoll() {
    if (!active) return
    const v = Math.max(1000, Number(interval) || 5000)
    void update(active.id, { refetchInterval: v })
    setInterval(String(v))
    setSavedMsg(true)
    setTimeout(() => setSavedMsg(false), 1500)
  }

  return (
    <PageStub code="M-14" title={t('nav.settings')}>
      <div className="max-w-2xl space-y-3">
        <p className="font-mono text-[10px] text-ink-mute">{t('settings.localOnly')}</p>

        {/* 语言 */}
        <section className="border border-ink-border bg-ink-deep p-4">
          <SectionLabel>{t('settings.language')}</SectionLabel>
          <div className="mt-3 flex items-center gap-2">
            {(['zh-CN', 'en'] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                  lang === l
                    ? 'border-inverse bg-inverse text-ink'
                    : 'border-ink-border text-ink-mute hover:border-inverse hover:text-foreground'
                }`}
              >
                {l === 'zh-CN' ? '中文' : 'EN'}
              </button>
            ))}
          </div>
        </section>

        {/* 主题 */}
        <section className="border border-ink-border bg-ink-deep p-4">
          <SectionLabel>{t('settings.theme')}</SectionLabel>
          <div className="mt-3 flex items-center gap-2">
            {(['dark', 'light', 'anime'] as const).map((th) => (
              <button
                key={th}
                onClick={() => setTheme(th)}
                className={`border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                  theme === th
                    ? 'border-inverse bg-inverse text-ink'
                    : 'border-ink-border text-ink-mute hover:border-inverse hover:text-foreground'
                }`}
              >
                {th === 'dark' ? t('settings.theme.dark') : th === 'light' ? t('settings.theme.light') : t('settings.theme.anime')}
              </button>
            ))}
          </div>
        </section>

        {/* 背景（按用户保存在本地；anime 主题下生效） */}
        <section className="border border-ink-border bg-ink-deep p-4">
          <SectionLabel>{t('settings.bg')}</SectionLabel>
          <p className="mt-2 font-mono text-[9px] text-ink-mute">{t('settings.bgHint')}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(['default', 'aurora', 'dusk', 'ember', 'url', 'upload'] as const).map((m) => (
              <button
                key={m}
                onClick={() => bgSet(bgUser, { mode: m })}
                className={`border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  bg.mode === m
                    ? 'border-inverse bg-inverse text-ink'
                    : 'border-ink-border text-ink-mute hover:border-inverse hover:text-foreground'
                }`}
              >
                {t(`settings.bg.${m}` as const)}
              </button>
            ))}
          </div>

          {bg.mode === 'url' && (
            <div className="mt-3 flex items-center gap-2">
              <input
                value={bgUrlInput}
                onChange={(e) => setBgUrlInput(e.target.value)}
                placeholder="https://example.com/bg.jpg"
                className="flex-1 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
              />
              <button
                onClick={applyBgUrl}
                className="border border-inverse px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink"
              >
                {t('settings.bg.apply')}
              </button>
            </div>
          )}

          {bg.mode === 'upload' && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                ref={bgFileRef}
                type="file"
                accept="image/*"
                onChange={(e) => onBgUploadFile(e.target.files?.[0])}
                className="hidden"
              />
              <button
                onClick={() => bgFileRef.current?.click()}
                className="border border-ink-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground"
              >
                <ImageIcon size={11} className="mr-1 inline" /> {t('settings.bg.pickFile')}
              </button>
              <span className="font-mono text-[9px] text-ink-mute">{t('settings.bg.uploadHint')}</span>
              {bg.hasImage && (
                <button
                  onClick={() => { setBgImage(bgUser, null); bgSet(bgUser, { mode: 'upload', hasImage: false }) }}
                  className="border border-ink-border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-scp-err hover:text-scp-err"
                >
                  {t('settings.bg.clearUpload')}
                </button>
              )}
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 font-mono text-[10px] text-ink-mute">
              <span className="w-20 shrink-0">{t('settings.bg.dim')}</span>
              <input
                type="range"
                min={0}
                max={85}
                value={bg.dim}
                onChange={(e) => bgSet(bgUser, { dim: Number(e.target.value) })}
                className="flex-1 accent-foreground"
              />
              <span className="w-10 text-right text-foreground">{bg.dim}%</span>
            </label>
            <label className="flex items-center gap-2 font-mono text-[10px] text-ink-mute">
              <span className="w-20 shrink-0">{t('settings.bg.blur')}</span>
              <input
                type="range"
                min={0}
                max={16}
                value={bg.blur}
                onChange={(e) => bgSet(bgUser, { blur: Number(e.target.value) })}
                className="flex-1 accent-foreground"
              />
              <span className="w-10 text-right text-foreground">{bg.blur}px</span>
            </label>
          </div>

          {bgMsg && <p className="mt-2 font-mono text-[10px] text-scp-err">{bgMsg}</p>}
        </section>

        {/* 轮询间隔（作用于当前激活服务器） */}
        <section className="border border-ink-border bg-ink-deep p-4">
          <SectionLabel>{t('settings.poll')}</SectionLabel>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="number"
              min={1000}
              step={500}
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              disabled={!active}
              className="w-40 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse disabled:opacity-40"
            />
            <button
              onClick={savePoll}
              disabled={!active}
              className="flex items-center gap-1.5 border border-inverse px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink disabled:opacity-40"
            >
              <Save size={11} /> {t('common.confirm')}
            </button>
            {savedMsg && <span className="font-mono text-[10px] text-scp-safe">✓</span>}
            {active && (
              <span className="ml-auto font-mono text-[10px] text-ink-mute">
                {serverLabel(active)}
              </span>
            )}
          </div>
        </section>

        {/* 双因素验证（TOTP） */}
        <section className="border border-ink-border bg-ink-deep p-4">
          <SectionLabel>{t('settings.twofa')}</SectionLabel>
          <p className="mt-2 font-mono text-[9px] text-ink-mute">
            {twofaEnabled ? '// ✓ ' + t('settings.twofaOn') : '// ' + t('settings.twofaOff')}
          </p>

          {twofaSetup ? (
            <div className="mt-3 space-y-2">
              <p className="font-mono text-[9px] text-ink-mute">{t('settings.twofaSetupHint')}</p>
              <div className="border border-ink-border bg-ink p-2">
                <p className="break-all font-mono text-[10px] leading-relaxed text-foreground">{twofaSetup.uri}</p>
              </div>
              <input
                value={twofaCode}
                onChange={(e) => setTwofaCode(e.target.value)}
                placeholder="••••••"
                maxLength={6}
                inputMode="numeric"
                className="w-40 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => void enableTwofa()}
                  disabled={twofaBusy || twofaCode.trim().length !== 6}
                  className="border border-inverse px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink disabled:opacity-40"
                >
                  {t('settings.twofaEnable')}
                </button>
                <button
                  onClick={() => setTwofaSetup(null)}
                  disabled={twofaBusy}
                  className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:text-foreground disabled:opacity-40"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={twofaCode}
                onChange={(e) => setTwofaCode(e.target.value)}
                placeholder={twofaEnabled ? t('settings.twofaCodeToDisable') : t('settings.twofaCodeToEnable')}
                maxLength={6}
                inputMode="numeric"
                className="w-40 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
              />
              {twofaEnabled ? (
                <button
                  onClick={() => void disableTwofa()}
                  disabled={twofaBusy || twofaCode.trim().length !== 6}
                  className="border border-scp-err px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-scp-err transition-colors hover:bg-scp-err hover:text-foreground disabled:opacity-40"
                >
                  {t('settings.twofaDisable')}
                </button>
              ) : (
                <button
                  onClick={() => void startTwofaSetup()}
                  disabled={twofaBusy}
                  className="border border-inverse px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink disabled:opacity-40"
                >
                  {t('settings.twofaEnable')}
                </button>
              )}
            </div>
          )}

          {twofaMsg && (
            <div className={`mt-2 border px-3 py-2 font-mono text-[10px] ${twofaMsg.ok ? 'border-scp-safe/40 bg-scp-safe/10 text-scp-safe' : 'border-scp-err/40 bg-scp-err/10 text-scp-err'}`}>
              {twofaMsg.text}
            </div>
          )}
        </section>

        {/* 危险操作确认 */}
        <section className="border border-ink-border bg-ink-deep p-4">
          <SectionLabel>{t('settings.confirmDanger')}</SectionLabel>
          <label className="mt-3 flex items-center gap-2 font-mono text-[11px] text-foreground">
            <input
              type="checkbox"
              checked={confirmDanger}
              onChange={(e) => {
                const v = e.target.checked
                setConfirmDanger(v)
                try {
                  localStorage.setItem(CONFIRM_DANGER_KEY, v ? '1' : '0')
                } catch { /* ignore */ }
              }}
              className="accent-foreground"
            />
            {t('settings.confirmDanger')}
          </label>
        </section>

        {/* 邮箱配置（仅管理员） */}
        {isAdmin && (
          <section className="border border-ink-border bg-ink-deep p-4">
            <SectionLabel>{t('settings.smtp')}</SectionLabel>
            <p className="mt-2 font-mono text-[9px] text-ink-mute">
              {smtpConfigured ? '// ✓ ' + t('settings.smtpConfigured') : '// ' + t('settings.smtpHint')}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <select
                value={smtp.authMode}
                onChange={(e) => setSmtp((s) => ({ ...s, authMode: e.target.value as 'password' | 'oauth2' }))}
                className="col-span-2 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse"
              >
                <option value="password">{t('settings.smtpAuthPassword')}</option>
                <option value="oauth2">{t('settings.smtpAuthOauth')}</option>
              </select>
              <input
                value={smtp.host}
                onChange={(e) => setSmtp((s) => ({ ...s, host: e.target.value }))}
                placeholder={smtp.authMode === 'oauth2' ? 'smtp.office365.com' : 'smtp.qq.com'}
                className="col-span-1 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
              />
              <input
                type="number"
                value={smtp.port}
                onChange={(e) => setSmtp((s) => ({ ...s, port: Number(e.target.value) }))}
                placeholder={smtp.authMode === 'oauth2' ? '587' : '465'}
                className="col-span-1 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
              />
              <input
                value={smtp.user}
                onChange={(e) => setSmtp((s) => ({ ...s, user: e.target.value }))}
                placeholder={t('settings.smtpUser')}
                className="col-span-1 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
              />
              {smtp.authMode === 'password' ? (
                <>
                  <input
                    type="password"
                    value={smtp.pass}
                    onChange={(e) => setSmtp((s) => ({ ...s, pass: e.target.value }))}
                    placeholder={secretConfigured ? t('settings.smtpPassKeep') : t('settings.smtpPass')}
                    className="col-span-1 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
                  />
                  {secretConfigured && (
                    <label className="col-span-1 flex items-center gap-1.5 font-mono text-[9px] text-ink-mute">
                      <input
                        type="checkbox"
                        checked={clearPass}
                        onChange={(e) => setClearPass(e.target.checked)}
                        className="accent-foreground"
                      />
                      {t('settings.smtpClearSecret')}
                    </label>
                  )}
                </>
              ) : (
                <div className="col-span-1 flex items-center font-mono text-[9px] leading-relaxed text-ink-mute">
                  {t('settings.msAutoHost')}:{' '}
                  <span className="ml-1 text-foreground">
                    {ms?.tid?.toLowerCase() === MS_PERSONAL_TENANT ? 'smtp-mail.outlook.com:587' : 'smtp.office365.com:587'}
                  </span>
                </div>
              )}
              {/* Microsoft OAuth（XOAUTH2）：设备代码流为主，跳转授权可选；连接/断开即时生效，无需再点保存 */}
              {smtp.authMode === 'oauth2' && ms && (
                <div className="col-span-2 border border-ink-border bg-ink p-2.5">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
                    {ms.refreshTokenConfigured ? (
                      <>
                        <span className="text-scp-safe">
                          ✓ {t('settings.msLinked')}{ms.accountEmail ? ` · ${ms.accountEmail}` : ''}
                        </span>
                        {ms.needsReauth && <span className="text-scp-err">{t('settings.msNeedsReauth')}</span>}
                        <span className="ml-auto" />
                        <button
                          onClick={() => void disconnectMicrosoft()}
                          disabled={oauthBusy}
                          className="border border-ink-border px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-ink-mute transition-colors hover:border-scp-err hover:text-scp-err disabled:opacity-40"
                        >
                          {t('settings.msDisconnect')}
                        </button>
                      </>
                    ) : (
                      <span className="text-ink-mute">{t('settings.msNotLinked')}</span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => void connectMicrosoftDevice()}
                      disabled={oauthBusy}
                      className="flex items-center gap-1.5 border border-ink-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground disabled:opacity-40"
                    >
                      {oauthBusy ? <Loader2 size={11} className="animate-spin" /> : <ExternalLink size={11} />}
                      {t('settings.msDeviceConnect')}
                    </button>
                    {ms.redirectFlowAvailable && (
                      <button
                        onClick={() => void connectMicrosoftRedirect()}
                        disabled={oauthBusy}
                        className="flex items-center gap-1.5 border border-ink-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground disabled:opacity-40"
                      >
                        {t('settings.msRedirectConnect')}
                      </button>
                    )}
                  </div>
                  {device && (
                    <div className="mt-2 border border-ink-border bg-ink-deep p-2">
                      <p className="font-mono text-[9px] leading-relaxed text-ink-mute">
                        {t('settings.msDeviceHint').replace('{uri}', device.verificationUri)}
                      </p>
                      <p className="mt-1 select-all font-mono text-[16px] tracking-[0.3em] text-foreground">{device.userCode}</p>
                      <p className="mt-1 flex items-center gap-1.5 font-mono text-[9px] text-ink-mute">
                        <Loader2 size={10} className="animate-spin" /> {t('settings.msWaiting')}
                      </p>
                    </div>
                  )}
                  <p className="mt-2 font-mono text-[8px] leading-relaxed text-ink-mute">{t('settings.msScopeHint')}</p>
                </div>
              )}
              <input
                value={smtp.from}
                onChange={(e) => setSmtp((s) => ({ ...s, from: e.target.value }))}
                placeholder={t('settings.smtpFrom')}
                className="col-span-2 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
              />
            </div>
            {smtpMsg && (
              <div className={`mt-2 border px-3 py-2 font-mono text-[10px] ${smtpMsg.ok ? 'border-scp-safe/40 bg-scp-safe/10 text-scp-safe' : 'border-scp-err/40 bg-scp-err/10 text-scp-err'}`}>
                {smtpMsg.text}
              </div>
            )}
            {smtpTestMsg && (
              <div className={`mt-2 border px-3 py-2 font-mono text-[10px] ${smtpTestMsg.ok ? 'border-scp-safe/40 bg-scp-safe/10 text-scp-safe' : 'border-scp-err/40 bg-scp-err/10 text-scp-err'}`}>
                {smtpTestMsg.text}
              </div>
            )}
            {oauthMsg && (
              <div className={`mt-2 border px-3 py-2 font-mono text-[10px] ${oauthMsg.ok ? 'border-scp-safe/40 bg-scp-safe/10 text-scp-safe' : 'border-scp-err/40 bg-scp-err/10 text-scp-err'}`}>
                {oauthMsg.text}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void saveSmtp()}
                disabled={
                  smtpBusy ||
                  !smtp.user ||
                  (smtp.authMode === 'password' && !secretConfigured && !smtp.pass)
                }
                className="flex flex-1 items-center justify-center gap-1.5 border border-inverse px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink disabled:opacity-40"
              >
                {smtpBusy ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />}
                {t('settings.saveSmtp')}
              </button>
              <button
                onClick={() => void testSmtp()}
                disabled={smtpTesting || smtpBusy || !smtp.user || !smtpConfigured}
                title={t('settings.smtpTestHint')}
                className="flex items-center justify-center gap-1.5 border border-ink-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground disabled:opacity-40"
              >
                {smtpTesting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                {t('settings.smtpTest')}
              </button>
            </div>
            <p className="mt-2 font-mono text-[9px] text-ink-mute">{t('settings.smtpTestUsesSaved')}</p>
          </section>
        )}

        {/* Steam API Key（仅管理员） */}
        {isAdmin && (
          <section className="border border-ink-border bg-ink-deep p-4">
            <SectionLabel>{t('settings.steam')}</SectionLabel>
            <p className="mt-2 font-mono text-[10px] text-ink-mute">
              {steamConfigured ? `// ✓ ${t('settings.steamConfigured')}` : `// ${t('settings.steamHint')}`}
            </p>
            {steamMsg && (
              <div className={`mt-2 border px-3 py-2 font-mono text-[10px] ${steamMsg.ok ? 'border-scp-safe/40 bg-scp-safe/10 text-scp-safe' : 'border-scp-err/40 bg-scp-err/10 text-scp-err'}`}>
                {steamMsg.text}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <input
                type="password"
                value={steamKey}
                onChange={(e) => setSteamKeyInput(e.target.value)}
                placeholder={t('settings.steamKeyPh')}
                className="flex-1 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
              />
              <button
                onClick={() => void saveSteam()}
                disabled={steamBusy}
                className="flex items-center justify-center gap-1.5 border border-inverse px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink disabled:opacity-40"
              >
                {steamBusy ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                {t('settings.saveSteam')}
              </button>
            </div>
          </section>
        )}

        {/* 公告配置（仅管理员） */}
        {isAdmin && (
          <section className="border border-ink-border bg-ink-deep p-4">
            <SectionLabel>{t('settings.announcementSection')}</SectionLabel>
            <p className="mt-2 font-mono text-[9px] text-ink-mute">{t('settings.announcementHint')}</p>
            {annMsg && (
              <div className={`mt-2 border px-3 py-2 font-mono text-[10px] ${annMsg.ok ? 'border-scp-safe/40 bg-scp-safe/10 text-scp-safe' : 'border-scp-err/40 bg-scp-err/10 text-scp-err'}`}>
                {annMsg.text}
              </div>
            )}
            {ann && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex cursor-pointer select-none items-center gap-2">
                    <input
                      type="checkbox"
                      checked={ann.enabled}
                      onChange={(e) => setAnn((s) => (s ? { ...s, enabled: e.target.checked } : s))}
                      className="h-3.5 w-3.5 accent-scp-safe"
                    />
                    <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                      {t('settings.announcementEnable')}
                    </span>
                  </label>
                  <label className="flex cursor-pointer select-none items-center gap-2">
                    <input
                      type="checkbox"
                      checked={ann.popupEnabled}
                      onChange={(e) => setAnn((s) => (s ? { ...s, popupEnabled: e.target.checked } : s))}
                      className="h-3.5 w-3.5 accent-scp-safe"
                    />
                    <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                      {t('settings.announcementPopupEnable')}
                    </span>
                  </label>
                  <span className="ml-auto font-mono text-[9px] text-ink-mute">
                    {t('settings.announcementVersion')} v{ann.version}
                  </span>
                </div>
                <input
                  value={ann.title.zh}
                  onChange={(e) => setAnn((s) => (s ? { ...s, title: { ...s.title, zh: e.target.value } } : s))}
                  placeholder={t('settings.announcementTitleZh')}
                  className="w-full border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
                />
                <textarea
                  value={ann.content.zh}
                  onChange={(e) => setAnn((s) => (s ? { ...s, content: { ...s.content, zh: e.target.value } } : s))}
                  placeholder={t('settings.announcementContentZh')}
                  rows={5}
                  className="w-full resize-y border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
                />
                <input
                  value={ann.title.en}
                  onChange={(e) => setAnn((s) => (s ? { ...s, title: { ...s.title, en: e.target.value } } : s))}
                  placeholder={t('settings.announcementTitleEn')}
                  className="w-full border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
                />
                <textarea
                  value={ann.content.en}
                  onChange={(e) => setAnn((s) => (s ? { ...s, content: { ...s.content, en: e.target.value } } : s))}
                  placeholder={t('settings.announcementContentEn')}
                  rows={5}
                  className="w-full resize-y border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
                />
                <button
                  onClick={() => void saveAnnouncementCfg()}
                  disabled={annBusy}
                  className="flex items-center gap-1.5 border border-inverse px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink disabled:opacity-40"
                >
                  {annBusy ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                  {t('settings.announcementSave')}
                </button>
              </div>
            )}
          </section>
        )}

        {/* 账号管理（仅管理员） */}
        {isAdmin && (
          <section className="border border-ink-border bg-ink-deep p-4">
            <SectionLabel>{t('settings.accounts')}</SectionLabel>

            {acctMsg && (
              <div className={`mt-3 border px-3 py-2 font-mono text-[10px] ${acctMsg.ok ? 'border-scp-safe/40 bg-scp-safe/10 text-scp-safe' : 'border-scp-err/40 bg-scp-err/10 text-scp-err'}`}>
                {acctMsg.text}
              </div>
            )}

            {/* 用户列表 */}
            <div className="mt-3 max-h-56 space-y-1 overflow-auto">
              {users.map((u) => (
                <div key={u.username} className="flex items-center justify-between gap-2 border-b border-ink-border/60 py-1.5">
                  <span className="min-w-0 truncate font-mono text-[11px] text-foreground">
                    {u.username}
                    {u.username === useAuthStore.getState().session?.username && (
                      <span className="ml-2 text-ink-mute">({t('settings.me')})</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="hidden font-mono text-[9px] text-ink-mute sm:inline">{u.email}</span>
                    <select
                      value={u.role}
                      onChange={(e) => void changeRole(u.username, e.target.value as UserRole)}
                      disabled={acctBusy || (u.role === 'admin' && users.filter((x) => x.role === 'admin').length <= 1)}
                      className="border border-ink-border bg-ink px-1.5 py-1 font-mono text-[10px] text-foreground focus:outline-none disabled:opacity-40"
                    >
                      <option value="admin">{t('settings.role.admin')}</option>
                      <option value="user">{t('settings.role.user')}</option>
                      <option value="guest">{t('settings.role.guest')}</option>
                    </select>
                    <button
                      onClick={() => void removeUser(u.username)}
                      disabled={acctBusy || (u.role === 'admin' && users.filter((x) => x.role === 'admin').length <= 1)}
                      className="font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:text-scp-err disabled:opacity-40"
                    >
                      {t('settings.delUser')}
                    </button>
                  </span>
                </div>
              ))}
            </div>

            {/* 创建用户 */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-border pt-3">
              <input
                value={newUser.email}
                onChange={(e) => setNewUser((s) => ({ ...s, email: e.target.value }))}
                placeholder={t('register.email')}
                className="w-36 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
              />
              <input
                value={newUser.username}
                onChange={(e) => setNewUser((s) => ({ ...s, username: e.target.value }))}
                placeholder={t('settings.newUser')}
                className="w-32 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
              />
              <input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser((s) => ({ ...s, password: e.target.value }))}
                placeholder={t('settings.newPassword')}
                className="w-32 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
              />
              <select
                value={newUser.role}
                onChange={(e) => setNewUser((s) => ({ ...s, role: e.target.value as UserRole }))}
                className="border border-ink-border bg-ink px-1.5 py-1.5 font-mono text-[10px] text-foreground focus:outline-none"
              >
                <option value="guest">{t('settings.role.guest')}</option>
                <option value="user">{t('settings.role.user')}</option>
                <option value="admin">{t('settings.role.admin')}</option>
              </select>
              <button
                onClick={() => void createUser()}
                disabled={acctBusy || !newUser.email.trim() || !newUser.username.trim() || newUser.password.length < 8}
                className="flex items-center gap-1.5 border border-inverse px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink disabled:opacity-40"
              >
                {acctBusy ? <Loader2 size={11} className="animate-spin" /> : <UsersIcon size={11} />}
                {t('settings.createUser')}
              </button>
            </div>
          </section>
        )}
      </div>
    </PageStub>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
      <SettingsIcon size={12} className="text-scp-safe" /> {children}
    </span>
  )
}
