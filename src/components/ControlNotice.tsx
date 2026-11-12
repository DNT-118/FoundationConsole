import { ShieldAlert } from 'lucide-react'
import { useT } from '@/i18n'
import { useAuthStore } from '@/store/authStore'

/**
 * 控制接口不可用提示条：show=true 时显示提示。
 * 访客账号无法配置 API Key，显示专属说明。
 */
export default function ControlNotice({ show }: { show: boolean }) {
  const t = useT()
  const role = useAuthStore((s) => s.session?.role)
  if (!show) return null
  return (
    <div className="flex items-start gap-2 border border-scp-warn/30 bg-scp-warn/5 px-3 py-2.5">
      <ShieldAlert size={14} className="mt-0.5 shrink-0 text-scp-warn" />
      <span className="break-words font-mono text-[11px] leading-relaxed text-scp-warn">
        {role === 'guest' ? t('control.guestLimited') : t('control.tokenMissing')}
      </span>
    </div>
  )
}
