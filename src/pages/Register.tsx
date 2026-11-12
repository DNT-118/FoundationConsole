import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Loader2, Mail, Rocket } from 'lucide-react'
import { motion } from 'framer-motion'
import { api } from '@/api/platform'
import { useAuthStore } from '@/store/authStore'
import { useServersStore } from '@/store/serversStore'
import { useT } from '@/i18n'
import LangSwitch from '@/components/LangSwitch'
import AnimeVideoBg from '@/components/AnimeVideoBg'
import { useThemeStore } from '@/store/themeStore'

interface FormValues {
  email: string
  code: string
  username: string
  password: string
  confirm: string
}

const QQ_RE = /^[A-Za-z0-9._%+-]+@qq\.com$/i

export default function Register() {
  const t = useT()
  const theme = useThemeStore((s) => s.theme)
  const navigate = useNavigate()
  const establish = useAuthStore((s) => s.establish)
  const resetServers = useServersStore((s) => s.reset)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  // 首次安装：首个账户自动成为管理员
  const [firstRun, setFirstRun] = useState(false)

  useEffect(() => {
    void api<{ firstRun: boolean }>('/auth/status')
      .then((r) => setFirstRun(r.firstRun))
      .catch(() => { /* ignore */ })
  }, [])

  const {
    register: reg, handleSubmit, watch, getValues, formState: { errors },
  } = useForm<FormValues>()
  const password = watch('password')

  // 验证码倒计时
  useEffect(() => {
    if (cooldown <= 0) return
    const h = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(h)
  }, [cooldown])

  async function sendCode() {
    const email = getValues('email')?.trim() ?? ''
    if (!QQ_RE.test(email)) {
      setErr(t('register.emailOnly'))
      return
    }
    setErr(null)
    setSending(true)
    try {
      await api('/auth/send-code', { method: 'POST', body: { email } })
      setCooldown(60)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  async function onSubmit(v: FormValues) {
    setErr(null)
    setBusy(true)
    try {
      const r = await api<{ token: string; user: { username: string; role: 'admin' | 'user' | 'guest'; email?: string } }>(
        '/auth/register',
        { method: 'POST', body: { email: v.email.trim(), username: v.username.trim(), password: v.password, code: v.code?.trim() ?? '' } },
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
      className={`relative flex min-h-screen w-full items-center justify-center overflow-hidden ${theme === 'anime' ? '' : 'bg-ink'}`}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {theme === 'anime' && <AnimeVideoBg />}
      <div className={`absolute inset-0 grid-bg ${theme === 'anime' ? 'opacity-20' : 'opacity-60'}`} />
      <LangSwitch />

      <motion.div
        className="relative w-full max-w-sm border border-ink-border bg-ink-deep/80 p-8 backdrop-blur-[8px]"
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
              QQ · SMTP · scrypt
            </div>
          </div>
        </div>

        <div className="mb-5 font-mono text-[13px] uppercase tracking-[0.15em] text-foreground">
          <Mail size={14} className="mr-2 inline" /> {t('register.title')}
        </div>

        {firstRun && (
          <div className="mb-4 flex items-start gap-2 border border-scp-safe/40 bg-scp-safe/10 px-3 py-2 font-mono text-[10px] leading-relaxed text-scp-safe">
            <Rocket size={13} className="mt-0.5 shrink-0" />
            {t('register.firstRunHint')}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* 邮箱（首个账户免验证码：SMTP 未配置也能完成初始化） */}
          {firstRun && (
            <div className="border border-scp-safe/40 bg-scp-safe/10 px-3 py-2 font-mono text-[10px] leading-relaxed text-scp-safe">
              {t('register.noCodeFirst')}
            </div>
          )}
          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-ink-mute">
              {t('register.email')}
            </span>
            <input
              {...reg('email', {
                required: t('addServer.required'),
                pattern: { value: QQ_RE, message: t('register.emailOnly') },
              })}
              placeholder="xxx@qq.com"
              className={inputCls(!!errors.email)}
            />
            {errors.email && (
              <span className="mt-1 block font-mono text-[10px] text-scp-err">{errors.email.message}</span>
            )}
          </label>

          {!firstRun && (
            <>
              {/* 邮箱 + 验证码 */}
              <div className="flex gap-2">
                <label className="block flex-1">
                  <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                    {t('register.code')}
                  </span>
                  <input
                    {...reg('code', { required: t('addServer.required') })}
                    placeholder="••••••"
                    className={inputCls(!!errors.code)}
                  />
                  {errors.code && (
                    <span className="mt-1 block font-mono text-[10px] text-scp-err">{errors.code.message}</span>
                  )}
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => void sendCode()}
                    disabled={sending || cooldown > 0}
                    className="whitespace-nowrap border border-inverse px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink disabled:opacity-40"
                  >
                    {sending ? <Loader2 size={11} className="animate-spin" /> : cooldown > 0 ? `${cooldown}s` : t('register.sendCode')}
                  </button>
                </div>
              </div>
            </>
          )}

          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-ink-mute">
              {t('register.username')}
            </span>
            <input
              {...reg('username', {
                required: t('addServer.required'),
                pattern: { value: /^[A-Za-z0-9_\u4e00-\u9fa5]{2,20}$/, message: t('register.usernameInvalid') },
              })}
              className={inputCls(!!errors.username)}
            />
            {errors.username && (
              <span className="mt-1 block font-mono text-[10px] text-scp-err">{errors.username.message}</span>
            )}
          </label>

          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-ink-mute">
              {t('register.password')}
            </span>
            <input
              type="password"
              {...reg('password', {
                required: t('addServer.required'),
                minLength: { value: 8, message: t('register.passwordShort') },
              })}
              className={inputCls(!!errors.password)}
            />
            {errors.password && (
              <span className="mt-1 block font-mono text-[10px] text-scp-err">{errors.password.message}</span>
            )}
          </label>

          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-ink-mute">
              {t('setup.confirm')}
            </span>
            <input
              type="password"
              {...reg('confirm', {
                required: t('addServer.required'),
                validate: (v) => v === password || t('setup.mismatch'),
              })}
              className={inputCls(!!errors.confirm)}
            />
            {errors.confirm && (
              <span className="mt-1 block font-mono text-[10px] text-scp-err">{errors.confirm.message}</span>
            )}
          </label>

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
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
            {t('register.submit')}
          </button>
        </form>

        <p className="mt-4 text-center font-mono text-[10px] text-ink-mute">
          {t('register.haveAccount')}{' '}
          <Link to="/login" className="text-foreground underline-offset-2 hover:underline">{t('login.title')}</Link>
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
