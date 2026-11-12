/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
import { useEffect, useState } from 'react'
import { Settings as SettingsIcon, Save, Users as UsersIcon, Loader2, Mail, Send, ExternalLink } from 'lucide-react'
import PageStub from '@/components/PageStub'
import { useT } from '@/i18n'
import { useI18nStore, type Lang } from '@/i18n/store'
import { useThemeStore } from '@/store/themeStore'
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

export default function Settings() {
  const t = useT()
  const { lang, setLang } = useI18nStore()
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const [animeVideo, setAnimeVideo] = useState(() => {
    try { return localStorage.getItem('pfc.animeVideo') !== '0' } catch { return true }
  })
  function toggleAnimeVideo() {
    const next = !animeVideo
    setAnimeVideo(next)
    try { localStorage.setItem('pfc.animeVideo', next ? '1' : '0') } catch { /* ignore */ }
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
    host: 'smtp.qq.com', port: 465, user: '', pass: '', from: '',
    clientId: '', clientSecret: '', refreshToken: '',
  })
  const [smtpConfigured, setSmtpConfigured] = useState(false)
  const [smtpMsg, setSmtpMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [smtpBusy, setSmtpBusy] = useState(false)
  const [smtpTesting, setSmtpTesting] = useState(false)
  const [smtpTestMsg, setSmtpTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [oauthBusy, setOauthBusy] = useState(false)
  const [oauthMsg, setOauthMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // ===== 管理员：Steam API Key =====
  const [steamKey, setSteamKeyInput] = useState('')
  const [steamConfigured, setSteamConfigured] = useState(false)
  const [steamMsg, setSteamMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [steamBusy, setSteamBusy] = useState(false)

  // ===== 管理员：公告配置 =====
  const [ann, setAnn] = useState<AnnouncementData | null>(null)
  const [annBusy, setAnnBusy] = useState(false)
  const [annMsg, setAnnMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // 微软 OAuth2 在线授权回调结果（/settings?oauth=ok|error&msg=...）
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('oauth') === 'ok') {
      setOauthMsg({ ok: true, text: '✓ ' + t('settings.smtpOauthOk') })
    } else if (q.get('oauth') === 'error') {
      setOauthMsg({ ok: false, text: '✗ ' + (q.get('msg') ?? t('common.err')) })
    }
    if (q.has('oauth')) window.history.replaceState({}, '', window.location.pathname)
  }, [])

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
    void api<{ smtp: { authMode: string; host: string; port: number; user: string; from: string; clientId: string; configured: boolean } }>(
      '/admin/smtp', { token: sessionToken ?? '' },
    ).then((r) => {
      setSmtpConfigured(r.smtp.configured)
      if (r.smtp.configured) {
        setSmtp({
          authMode: r.smtp.authMode === 'oauth2' ? 'oauth2' : 'password',
          host: r.smtp.host, port: r.smtp.port, user: r.smtp.user, from: r.smtp.from,
          pass: '', clientId: r.smtp.clientId, clientSecret: '', refreshToken: '',
        })
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
      await api('/admin/smtp', {
        method: 'PUT',
        token: sessionToken ?? '',
        body: smtp,
      })
      setSmtpConfigured(true)
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
      const r = await api<{ success: boolean; message?: string; host?: string; port?: number; ip?: string }>(
        '/admin/smtp/test',
        // 测试邮件发给发信邮箱自己（user 一定是合法地址，from 可能是显示名）
        { method: 'POST', token: sessionToken ?? '', body: { ...smtp, to: smtp.user || smtp.from } },
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

  async function connectMicrosoft() {
    setOauthMsg(null)
    setOauthBusy(true)
    try {
      const r = await api<{ success: boolean; url?: string; message?: string }>(
        '/admin/smtp/oauth2/start', { token: sessionToken ?? '' },
      )
      if (r.success && r.url) {
        window.location.href = r.url   // 跳转微软登录页，授权后自动回跳 /settings
        return
      }
      setOauthMsg({ ok: false, text: `✗ ${r.message ?? t('common.err')}` })
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
          <label className="mt-3 flex cursor-pointer select-none items-center gap-2">
            <input
              type="checkbox"
              checked={animeVideo}
              onChange={toggleAnimeVideo}
              className="h-3.5 w-3.5 accent-foreground"
            />
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
              {t('settings.theme.animeVideo')}
            </span>
          </label>
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
                <input
                  type="password"
                  value={smtp.pass}
                  onChange={(e) => setSmtp((s) => ({ ...s, pass: e.target.value }))}
                  placeholder={t('settings.smtpPass')}
                  className="col-span-1 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
                />
              ) : (
                <input
                  value={smtp.clientId}
                  onChange={(e) => setSmtp((s) => ({ ...s, clientId: e.target.value }))}
                  placeholder={t('settings.smtpClientId')}
                  className="col-span-1 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
                />
              )}
              {smtp.authMode === 'oauth2' && (
                <>
                  <input
                    type="password"
                    value={smtp.clientSecret}
                    onChange={(e) => setSmtp((s) => ({ ...s, clientSecret: e.target.value }))}
                    placeholder={t('settings.smtpClientSecret')}
                    className="col-span-1 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
                  />
                  <input
                    type="password"
                    value={smtp.refreshToken}
                    onChange={(e) => setSmtp((s) => ({ ...s, refreshToken: e.target.value }))}
                    placeholder={t('settings.smtpRefreshToken')}
                    className="col-span-1 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
                  />
                  <div className="col-span-2 mt-1 flex items-center gap-2">
                    <button
                      onClick={() => void connectMicrosoft()}
                      disabled={oauthBusy || !smtp.clientId || !smtp.clientSecret}
                      className="flex items-center gap-1.5 border border-ink-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground disabled:opacity-40"
                    >
                      {oauthBusy ? <Loader2 size={11} className="animate-spin" /> : <ExternalLink size={11} />}
                      {t('settings.smtpOauthConnect')}
                    </button>
                    <span className="font-mono text-[9px] text-ink-mute">{t('settings.smtpOauthHint')}</span>
                  </div>
                </>
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
                (smtp.authMode === 'password'
                  ? !smtp.pass
                  : !smtp.clientId || !smtp.clientSecret)
              }
                className="flex flex-1 items-center justify-center gap-1.5 border border-inverse px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink disabled:opacity-40"
              >
                {smtpBusy ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />}
                {t('settings.saveSmtp')}
              </button>
              <button
                onClick={() => void testSmtp()}
                disabled={smtpTesting || smtpBusy || !smtp.user}
                title={t('settings.smtpTestHint')}
                className="flex items-center justify-center gap-1.5 border border-ink-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground disabled:opacity-40"
              >
                {smtpTesting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                {t('settings.smtpTest')}
              </button>
            </div>
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
