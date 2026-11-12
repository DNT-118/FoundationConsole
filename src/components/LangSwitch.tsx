import { Languages } from 'lucide-react'
import { useI18nStore } from '@/i18n/store'

/** 浮在右上角的语言切换按钮。 */
export default function LangSwitch({ className = '' }: { className?: string }) {
  const lang = useI18nStore((s) => s.lang)
  const toggle = useI18nStore((s) => s.toggle)
  return (
    <button
      onClick={toggle}
      className={[
        'absolute right-4 top-4 z-10 flex items-center gap-1.5',
        'border border-ink-border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider',
        'text-ink-mute transition-colors hover:text-foreground hover:border-ink-mute',
        className,
      ].join(' ')}
      title="切换语言 / Toggle language"
    >
      <Languages size={12} />
      {lang === 'zh-CN' ? '简体中文' : 'English'}
    </button>
  )
}
