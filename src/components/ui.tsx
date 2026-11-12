import { useThemeStore } from '@/store/themeStore'
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

/**
 * 公共 UI 组件库（主题感知）。
 * anime 主题下控件二次元化（圆角 + 柔和渐变 + 微光）；dark/light 保持工业直角风。
 * 替换散落各页的内联控件样式，统一维护。
 */

const isAnime = () => useThemeStore.getState().theme === 'anime'

/* ---------- 按钮 ---------- */

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'icon'

export function Btn({
  variant = 'primary',
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const anime = isAnime()
  const base = anime
    ? {
        primary:
          'inline-flex items-center justify-center gap-2 rounded-[10px] border-0 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-white transition-all duration-200 hover:brightness-110 disabled:opacity-40 shadow-[0_2px_10px_rgba(139,124,246,0.35)]',
        ghost:
          'inline-flex items-center justify-center gap-2 rounded-[10px] border border-ink-border bg-ink-mid/30 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-all duration-200 hover:border-accent hover:text-accent disabled:opacity-40',
        danger:
          'inline-flex items-center justify-center gap-2 rounded-[10px] border border-scp-err/60 bg-scp-err/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-scp-err transition-all duration-200 hover:bg-scp-err hover:text-foreground disabled:opacity-40',
        icon: 'text-ink-mute transition-colors hover:text-accent',
      }[variant]
    : {
        primary:
          'flex items-center justify-center gap-2 border border-inverse px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink disabled:opacity-40',
        ghost:
          'border border-ink-border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground disabled:opacity-40',
        danger:
          'border border-scp-err px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-scp-err transition-colors hover:bg-scp-err hover:text-foreground disabled:opacity-40',
        icon: 'text-ink-mute transition-colors hover:text-foreground',
      }[variant]

  // anime primary 用渐变底
  const animeStyle = anime && variant === 'primary'
    ? { background: 'linear-gradient(135deg, #8b7cf6 0%, #c98bf6 55%, #ff9ecf 100%)' }
    : undefined

  return (
    <button
      type={type}
      style={animeStyle}
      className={`${base} ${className}`}
      {...rest}
    />
  )
}

/* ---------- 输入框 ---------- */

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  textarea?: boolean
  rows?: number
}

export function Field({ textarea, className = '', ...rest }: FieldProps) {
  const anime = isAnime()
  const base = anime
    ? 'w-full rounded-[8px] border border-ink-border bg-ink-mid/30 px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-ink-mute transition-all duration-200 focus:outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(255,158,207,0.2)]'
    : 'w-full bg-ink border px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-ink-mute focus:outline-none transition-colors focus:border-inverse'

  if (textarea) {
    const { rows = 3, ...ta } = rest as TextareaHTMLAttributes<HTMLTextAreaElement>
    return <textarea rows={rows} className={`${base} resize-y ${className}`} {...ta} />
  }
  return <input className={`${base} ${className}`} {...rest} />
}

/* ---------- 卡片 ---------- */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  const anime = isAnime()
  const base = anime
    ? 'rounded-[14px] border border-ink-border/50 bg-gradient-to-br from-ink-deep via-ink-mid/40 to-ink-deep p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
    : 'border border-ink-border bg-ink-deep p-4'
  return <div className={`${base} ${className}`}>{children}</div>
}

/* ---------- 弹窗遮罩 + 容器 ---------- */

export function ModalOverlay({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  const anime = isAnime()
  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 ${
        anime ? 'bg-ink/60 backdrop-blur-[6px]' : 'bg-ink/70 backdrop-blur-[2px]'
      }`}
      onClick={onClose}
    >
      {children}
    </div>
  )
}

export function ModalPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  const anime = isAnime()
  const base = anime
    ? 'relative w-full max-w-md rounded-[16px] border border-ink-border/60 bg-ink-deep/90 p-6 shadow-2xl backdrop-blur-[8px]'
    : 'relative w-full max-w-md border border-ink-border bg-ink-deep p-6 shadow-2xl'
  return <div className={`${base} ${className}`} onClick={(e) => e.stopPropagation()}>{children}</div>
}

/* ---------- 分段控件（选中态） ---------- */

export function SegBtn({
  active, children, onClick, className = '',
}: { active: boolean; children: ReactNode; onClick: () => void; className?: string }) {
  const anime = isAnime()
  const base = anime
    ? active
      ? 'rounded-[8px] border border-0 bg-gradient-to-br from-[#8b7cf6] to-[#ff9ecf] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-white transition-all duration-200'
      : 'rounded-[8px] border border-ink-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-mute transition-colors hover:border-accent hover:text-accent'
    : active
      ? 'border border-inverse bg-inverse text-ink px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors'
      : 'border border-ink-border text-ink-mute px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors hover:border-inverse hover:text-foreground'
  return (
    <button type="button" onClick={onClick} className={`${base} ${className}`}>
      {children}
    </button>
  )
}
