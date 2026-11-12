/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Loader2, Lock } from 'lucide-react'
import { motion } from 'framer-motion'
import { api } from '@/api/platform'
import { useAuthStore } from '@/store/authStore'
import { useServersStore } from '@/store/serversStore'
import { useT } from '@/i18n'
import LangSwitch from '@/components/LangSwitch'
import BackgroundLayer from '@/components/BackgroundLayer'
import { useThemeStore } from '@/store/themeStore'

interface FormValues { username: string; password: string }

export default function Login() {
  const t = useT()
  const theme = useThemeStore((s) => s.theme)
  const navigate = useNavigate()
  const signIn = useAuthStore((s) => s.signIn)
  const establish = useAuthStore((s) => s.establish)
  const expiredAt = useAuthStore((s) => s.expiredAt)
  const resetServers = useServersStore((s) => s.reset)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 首次安装引导：true=确认首次，null=无法确认（旧后端/请求失败），false=已有用户
  const [firstRun, setFirstRun] = useState<boolean | null>(null)
  const [smtpConfigured, setSmtpConfigured] = useState(true)
  // 2FA 两步登录
  const [step, setStep] = useState<'password' | '2fa'>('password')
  const [pendingUsername, setPendingUsername] = useState('')
  const [twofaCode, setTwofaCode] = useState('')

  // 查询平台状态（尽力而为：旧后端无此端点时回退为"显示引导"而非静默失败）
  useEffect(() => {
    api<{ firstRun: boolean; smtpConfigured: boolean }>('/auth/status')
      .then((r) => {
        setFirstRun(r.firstRun)
        setSmtpConfigured(r.smtpConfigured)
      })
      .catch(() => setFirstRun(null))
  }, [])

  const {
    register, handleSubmit, formState: { errors },
  } = useForm<FormValues>()

  async function onSubmit(v: FormValues) {
    setErr(null); setBusy(true)
    try {
      const r = await signIn(v.username, v.password)
      if (r.pending2fa) {
        setPendingUsername(r.username ?? v.username)
        setStep('2fa')
        return
      }
      resetServers()
      navigate('/dashboard', { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('login.invalid'))
    } finally {
      setBusy(false)
    }
  }

  async function submit2fa() {
    setErr(null); setBusy(true)
    try {
      const r = await api<{ token: string; user: { username: string; role: 'admin' | 'user' | 'guest'; email?: string } }>(
        '/auth/2fa/verify', { method: 'POST', body: { username: pendingUsername, code: twofaCode.trim() } },
      )
      establish(r.token, r.user)
      resetServers()
      navigate('/dashboard', { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      className={`relative z-10 flex min-h-screen w-full items-center justify-center overflow-hidden ${theme === 'anime' ? '' : 'bg-ink'}`}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {theme === 'anime' && <BackgroundLayer />}
      <div className={`absolute inset-0 grid-bg ${theme === 'anime' ? 'opacity-20' : 'opacity-60'}`} />
      <LangSwitch />

      {/* 登录面板：anime 下靠右（ml-auto + 右侧边距），露出视频主体；暗/亮保持居中 */}
      <motion.div
        className={`relative w-full max-w-sm border border-ink-border bg-ink-deep/80 p-8 backdrop-blur-[8px] ${
          theme === 'anime' ? 'ml-auto mr-6 md:mr-16' : ''
        }`}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -16, scale: 0.98 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center">
            <img src="/logo.png" alt="SCP" className="h-6 w-6 object-contain" draggable={false} />
          </div>
          <div>
            <div className="font-sans text-[12px] tracking-wide text-foreground">{t('app.title')}</div>
            <div className="font-mono text-[9px] uppercase tracking-wider text-ink-mute">
              AES-256 GCM · PBKDF2
            </div>
            <div className="font-mono text-[8px] text-ink-mute/70">
              © 2026 DNT_OF
            </div>
          </div>
        </div>

        <div className="mb-5 font-mono text-[13px] uppercase tracking-[0.15em] text-foreground">
          <Lock size={14} className="mr-2 inline" /> {step === '2fa' ? t('login.twofa') : t('login.title')}
        </div>

        {firstRun !== false && (
          <div className="mb-4 border border-scp-safe/40 bg-scp-safe/10 px-3 py-2.5">
            <p className="font-mono text-[10px] leading-relaxed text-scp-safe">
              {firstRun === true
                ? t('login.firstRunHint')
                : t('login.registerHint')}
            </p>
            <Link
              to="/register"
              className="mt-1.5 inline-block border border-scp-safe px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-scp-safe transition-colors hover:bg-scp-safe hover:text-foreground"
            >
              {t('register.title')} →
            </Link>
          </div>
        )}

        {!firstRun && !smtpConfigured && (
          <div className="mb-4 border border-scp-warn/40 bg-scp-warn/10 px-3 py-2 font-mono text-[10px] leading-relaxed text-scp-warn">
            {t('login.smtpNotConfigured')}
          </div>
        )}

        {step === '2fa' ? (
          <div className="space-y-4">
            <p className="break-words font-mono text-[11px] leading-relaxed text-ink-mute">
              {t('login.twofaHint')} <span className="text-foreground">{pendingUsername}</span>
            </p>
            <input
              value={twofaCode}
              onChange={(e) => setTwofaCode(e.target.value)}
              placeholder="••••••"
              maxLength={6}
              inputMode="numeric"
              autoFocus
              className={inputCls(false)}
            />
            {err && (
              <div className="border border-scp-err/40 bg-scp-err/10 px-3 py-2 font-mono text-[10px] text-scp-err">
                {err}
              </div>
            )}
            <button
              onClick={() => void submit2fa()}
              disabled={busy || twofaCode.trim().length !== 6}
              className="flex w-full items-center justify-center gap-2 border border-inverse py-2.5 font-mono text-[11px] uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-inverse hover:text-ink disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
              {t('login.verify')}
            </button>
            <button
              onClick={() => { setStep('password'); setTwofaCode(''); setErr(null) }}
              className="w-full text-center font-mono text-[10px] text-ink-mute transition-colors hover:text-foreground"
            >
              ← {t('common.cancel')}
            </button>
          </div>
        ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-ink-mute">
              {t('login.username')}
            </span>
            <input
              {...register('username', { required: t('addServer.required') })}
              autoComplete="username"
              className={inputCls(!!errors.username)}
            />
            {errors.username && (
              <span className="mt-1 block font-mono text-[10px] text-scp-err">{errors.username.message}</span>
            )}
          </label>

          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-ink-mute">
              {t('login.password')}
            </span>
            <input
              type="password"
              {...register('password', { required: t('addServer.required') })}
              autoComplete="current-password"
              className={inputCls(!!errors.password)}
            />
            {errors.password && (
              <span className="mt-1 block font-mono text-[10px] text-scp-err">{errors.password.message}</span>
            )}
          </label>

          {expiredAt && (
            <div className="border border-scp-warn/40 bg-scp-warn/10 px-3 py-2 font-mono text-[10px] text-scp-warn">
              {t('login.expired')}
            </div>
          )}

          {err && (
            <div className="border border-scp-err/40 bg-scp-err/10 px-3 py-2 font-mono text-[10px] text-scp-err">
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 border border-inverse py-2.5 font-mono text-[11px] uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-inverse hover:text-ink disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
            {t('login.authenticate')}
          </button>
        </form>
        )}

        <p className="mt-4 text-center font-mono text-[10px] text-ink-mute">
          {t('login.noAccount')}{' '}
          <Link to="/register" className="text-foreground underline-offset-2 hover:underline">{t('register.title')}</Link>
        </p>
      </motion.div>
    </motion.div>
  )
}

function inputCls(hasError: boolean): string {
  return [
    'w-full bg-ink border px-3 py-2 font-mono text-[12px] text-foreground',
    'placeholder:text-ink-mute focus:outline-none transition-colors',
    hasError ? 'border-scp-err' : 'border-ink-border focus:border-inverse',
  ].join(' ')
}
