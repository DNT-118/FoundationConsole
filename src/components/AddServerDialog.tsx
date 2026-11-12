import { useEffect, useRef, useState } from 'react'
import { X, Plus, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { AnimatePresence, motion } from 'framer-motion'
import { useServersStore, DEFAULT_PORT } from '@/store/serversStore'
import { useAuthStore } from '@/store/authStore'
import { useT } from '@/i18n'
import type { TKey } from '@/i18n/dict'

export interface AddServerDialogProps {
  open: boolean
  onClose: () => void
}

interface FormValues {
  host: string
  port: number
  token: string
  apiKey: string
  controlTransport: 'http' | 'ws'
  refetchInterval: number
}

const defaults: FormValues = {
  host: '',
  port: DEFAULT_PORT,
  token: '',
  apiKey: '',
  controlTransport: 'http',
  refetchInterval: 5000,
}

export default function AddServerDialog({ open, onClose }: AddServerDialogProps) {
  const t = useT()
  const add = useServersStore((s) => s.add)
  const role = useAuthStore((s) => s.session?.role)
  const firstFieldRef = useRef<HTMLInputElement>(null)

  // 访客只能绑定基本 token（控制接口需要更高权限）
  const canControl = role === 'admin' || role === 'user'

  const {
    register, handleSubmit, reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: defaults })

  useEffect(() => {
    if (open) {
      reset(defaults)
      setTimeout(() => firstFieldRef.current?.focus(), 50)
    }
  }, [open, reset])

  const [saveErr, setSaveErr] = useState<string | null>(null)

  async function onSubmit(values: FormValues) {
    setSaveErr(null)
    try {
      await add({
        host: values.host.trim(),
        port: Number(values.port) || DEFAULT_PORT,
        token: values.token.trim(),
        apiKey: values.apiKey?.trim() || undefined,
        controlTransport: values.controlTransport === 'ws' ? 'ws' : 'http',
        refetchInterval: Math.max(1000, Number(values.refetchInterval) || 5000),
      })
      onClose()
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e))
    }
  }

  const err = (k?: TKey) => (k ? t(k) : undefined)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="absolute inset-0 bg-ink/70 backdrop-blur-[2px]" onClick={onClose} />

          <motion.div
            className="relative w-full max-w-md border border-ink-border bg-ink-deep"
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 12, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="flex items-center justify-between border-b border-ink-border px-5 py-3">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-foreground">
                <Plus size={13} /> {t('addServer.title')}
              </div>
              <button onClick={onClose} className="text-ink-mute transition-colors hover:text-foreground">
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 p-5">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Field label={t('addServer.host')} error={err(errors.host ? 'addServer.invalid' : undefined)}>
                    <input
                      {...register('host', {
                        required: 'addServer.required' as const,
                        validate: (v) => {
                          const stripped = v.trim().replace(/^https?:\/\//i, '')
                          return stripped.length > 0 || 'addServer.invalid'
                        },
                      })}
                      ref={(el) => {
                        firstFieldRef.current = el
                        register('host').ref(el)
                      }}
                      placeholder="127.0.0.1 / example.com"
                      className={inputCls(!!errors.host)}
                    />
                  </Field>
                </div>
                <div>
                  <Field label={t('addServer.port')} error={err(errors.port ? 'addServer.invalid' : undefined)}>
                    <input
                      type="number"
                      {...register('port', {
                        required: 'addServer.required' as const,
                        min: { value: 1, message: 'addServer.invalid' },
                        max: { value: 65535, message: 'addServer.invalid' },
                      })}
                      className={inputCls(!!errors.port)}
                    />
                  </Field>
                </div>
              </div>
              <p className="-mt-2 font-mono text-[9px] text-ink-mute">
                // {t('addServer.portHint')}
              </p>

              <Field label={t('addServer.token')} error={err(errors.token ? 'addServer.required' : undefined)}>
                <input
                  {...register('token', { required: 'addServer.required' as const })}
                  type="password"
                  placeholder="••••••"
                  className={inputCls(!!errors.token)}
                />
              </Field>

              {canControl && (
                <>
                  <Field label={t('addServer.apiKey')}>
                    <input
                      {...register('apiKey')}
                      type="password"
                      placeholder="••••••"
                      className={inputCls(false)}
                    />
                  </Field>
                  <p className="-mt-2 font-mono text-[9px] text-ink-mute">
                    // {t('addServer.apiKeyHint')}
                  </p>
                </>
              )}

              <Field label={t('addServer.connMode')}>
                <select
                  {...register('controlTransport')}
                  className={inputCls(false)}
                >
                  <option value="http">{t('addServer.connHttp')}</option>
                  <option value="ws">{t('addServer.connWs')}</option>
                </select>
              </Field>
              <p className="-mt-2 font-mono text-[9px] text-ink-mute">
                // {t('addServer.connModeHint')}
              </p>

              <Field label={t('addServer.poll')} error={err(errors.refetchInterval ? 'addServer.invalid' : undefined)}>
                <input
                  type="number"
                  step={500}
                  min={1000}
                  {...register('refetchInterval', {
                    required: 'addServer.required' as const,
                    min: { value: 1000, message: 'addServer.invalid' },
                  })}
                  className={inputCls(!!errors.refetchInterval)}
                />
              </Field>

              <div className="flex justify-end gap-2 pt-2">
                {saveErr && (
                  <span className="mr-auto break-words font-mono text-[10px] leading-relaxed text-scp-err">{saveErr}</span>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-mute transition-colors hover:text-foreground"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 border border-inverse px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  {t('addServer.add')}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
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
