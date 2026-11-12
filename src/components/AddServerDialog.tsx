import { useEffect, useRef } from 'react'
import { X, Plus, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { AnimatePresence, motion } from 'framer-motion'
import { useServersStore, type ServerConfig } from '@/store/serversStore'
import { IS_DEMO } from '@/demo/mode'
import { demoBlockReason, isDemoUrl } from '@/demo/demoSource'

export interface AddServerDialogProps {
  open: boolean
  onClose: () => void
}

interface FormValues {
  label: string
  baseUrl: string
  token: string
  refetchInterval: number
}

const defaults: FormValues = {
  label: '',
  baseUrl: 'http://',
  token: '',
  refetchInterval: 5000,
}

export default function AddServerDialog({ open, onClose }: AddServerDialogProps) {
  const add = useServersStore((s) => s.add)
  const firstFieldRef = useRef<HTMLInputElement>(null)

  const {
    register, handleSubmit, reset, watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: defaults })

  useEffect(() => {
    if (open) {
      reset(defaults)
      setTimeout(() => firstFieldRef.current?.focus(), 50)
    }
  }, [open, reset])

  // 演示版：提前提示 http:// 远程地址会被浏览器拦截（仍允许保存）
  const baseUrlValue = IS_DEMO ? watch('baseUrl') : ''
  const demoHint =
    IS_DEMO && baseUrlValue && !isDemoUrl(baseUrlValue) && /^https?:\/\/.+/.test(baseUrlValue)
      ? demoBlockReason(baseUrlValue)
      : null

  async function onSubmit(values: FormValues) {
    // 同步触达：先 add 再 onClose。React Hook Form 的 isSubmitting 控制按钮态。
    const cfg: Omit<ServerConfig, 'id' | 'createdAt'> = {
      label: values.label.trim(),
      baseUrl: values.baseUrl.trim(),
      token: values.token.trim(),
      refetchInterval: Math.max(1000, Number(values.refetchInterval) || 5000),
    }
    add(cfg)
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* 遮罩 */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
            onClick={onClose}
          />

          {/* 面板 */}
          <motion.div
            className="relative w-full max-w-md border border-ink-border bg-ink-deep"
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 12, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            {/* 头 */}
            <div className="flex items-center justify-between border-b border-ink-border px-5 py-3">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-white">
                <Plus size={13} /> Add Server
              </div>
              <button
                onClick={onClose}
                className="text-ink-mute transition-colors hover:text-white"
              >
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 p-5">
              <Field label="Label" error={errors.label?.message}>
                <input
                  {...register('label', {
                    required: 'required',
                    validate: (v) => v.trim().length > 0 || 'required',
                  })}
                  ref={(el) => {
                    firstFieldRef.current = el
                    // React Hook Form 内部 ref 在 register 返回的对象上，这里合并
                    register('label').ref(el)
                  }}
                  placeholder="Primary Node"
                  className={inputCls(!!errors.label)}
                />
              </Field>

              <Field label="SLDataAPI Base URL" error={errors.baseUrl?.message}>
                <input
                  {...register('baseUrl', {
                    required: 'required',
                    pattern: IS_DEMO
                      ? {
                          value: /^(https?|demo):\/\/.+/,
                          message: '需以 http(s):// 开头，或填 demo://sample 使用模拟数据',
                        }
                      : {
                          value: /^https?:\/\/.+/,
                          message: 'must start with http(s)://',
                        },
                  })}
                  placeholder={IS_DEMO ? 'https://your-host:8443 或 demo://sample' : 'http://127.0.0.1:8081'}
                  className={inputCls(!!errors.baseUrl)}
                />
                {demoHint && (
                  <span className="mt-1 block font-mono text-[10px] text-scp-warn">{demoHint}</span>
                )}
              </Field>

              <Field label="Token" error={errors.token?.message}>
                <input
                  {...register('token', { required: 'required' })}
                  type="password"
                  placeholder="••••••"
                  className={inputCls(!!errors.token)}
                />
              </Field>

              <Field label="Poll Interval (ms)" error={errors.refetchInterval?.message}>
                <input
                  type="number"
                  step={500}
                  min={1000}
                  {...register('refetchInterval', {
                    required: 'required',
                    min: { value: 1000, message: 'min 1000ms' },
                  })}
                  className={inputCls(!!errors.refetchInterval)}
                />
              </Field>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-mute transition-colors hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 border border-white px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-white transition-colors hover:bg-white hover:text-ink disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Add
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
      {error && (
        <span className="mt-1 block font-mono text-[10px] text-scp-err">{error}</span>
      )}
    </label>
  )
}

function inputCls(hasError: boolean): string {
  return [
    'w-full bg-ink border px-3 py-2 font-mono text-[12px] text-white',
    'placeholder:text-ink-mute focus:outline-none transition-colors',
    hasError ? 'border-scp-err' : 'border-ink-border focus:border-white',
  ].join(' ')
}
