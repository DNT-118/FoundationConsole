import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Loader2, ShieldCheck, KeyRound } from 'lucide-react'
import { motion } from 'framer-motion'
import { registerUser, hasVault } from '@/lib/vault'
import { useAuthStore } from '@/store/authStore'
import { useServersStore } from '@/store/serversStore'
import { useT } from '@/i18n'
import LangSwitch from '@/components/LangSwitch'
import BackgroundLayer from '@/components/BackgroundLayer'
import { useThemeStore } from '@/store/themeStore'

interface FormValues {
  username: string
  password: string
  confirm: string
}

export default function Setup() {
  const t = useT()
  const theme = useThemeStore((s) => s.theme)
  const navigate = useNavigate()
  const signIn = useAuthStore((s) => s.signIn)
  const resetServers = useServersStore((s) => s.reset)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    hasVault().then((exists) => {
      if (exists) navigate('/login', { replace: true })
    })
  }, [navigate])

  const {
    register, handleSubmit, watch,
    formState: { errors },
  } = useForm<FormValues>()

  async function onSubmit(v: FormValues) {
    setErr(null); setBusy(true)
    try {
      await registerUser(v.username, v.password)
      await signIn(v.username, v.password)
      resetServers()
      navigate('/dashboard', { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown error')
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
      {theme === 'anime' && <BackgroundLayer />}
      <div className={`absolute inset-0 grid-bg ${theme === 'anime' ? 'opacity-20' : 'opacity-60'}`} />
      <LangSwitch />

      <motion.div
        className="relative w-full max-w-sm border border-ink-border bg-ink-deep/80 p-8 backdrop-blur-[8px]"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -16, scale: 0.98 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="mb-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center">
              <img src="/logo.png" alt="SCP" className="h-6 w-6 object-contain" draggable={false} />
            </div>
            <div className="font-sans text-[12px] tracking-wide text-foreground">{t('app.title')}</div>
          </div>
          <div className="flex items-center gap-2 font-mono text-[13px] uppercase tracking-[0.15em] text-foreground">
            <ShieldCheck size={15} /> {t('setup.title')}
          </div>
          <p className="mt-2 whitespace-pre-line font-mono text-[10px] leading-relaxed text-ink-mute">
            // {t('setup.hint')}
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label={t('setup.username')} error={errors.username?.message}>
            <input
              {...register('username', {
                required: t('addServer.required'),
                minLength: { value: 2, message: 'min 2' },
              })}
              autoComplete="username"
              className={inputCls(!!errors.username)}
            />
          </Field>

          <Field label={t('setup.password')} error={errors.password?.message}>
            <input
              type="password"
              {...register('password', {
                required: t('addServer.required'),
                minLength: { value: 8, message: 'min 8' },
              })}
              autoComplete="new-password"
              className={inputCls(!!errors.password)}
            />
          </Field>

          <Field label={t('setup.confirm')} error={errors.confirm?.message}>
            <input
              type="password"
              {...register('confirm', {
                required: t('addServer.required'),
                validate: (v) => v === watch('password') || t('setup.mismatch'),
              })}
              autoComplete="new-password"
              className={inputCls(!!errors.confirm)}
            />
          </Field>

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
            {busy ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
            {t('setup.init')}
          </button>
        </form>
      </motion.div>
    </motion.div>
  )
}

function Field({
  label, error, children,
}: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-ink-mute">
        {label}
      </span>
      {children}
      {error && <span className="mt-1 block font-mono text-[10px] text-scp-err">{error}</span>}
    </label>
  )
}

function inputCls(hasError: boolean): string {
  return [
    'w-full bg-ink border px-3 py-2 font-mono text-[12px] text-foreground',
    'placeholder:text-ink-mute focus:outline-none transition-colors',
    hasError ? 'border-scp-err' : 'border-ink-border focus:border-inverse',
  ].join(' ')
}
