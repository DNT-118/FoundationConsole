import { useEffect, useRef, useId } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useT } from '@/i18n'

export interface ConfirmDialogProps {
  open: boolean
  /** 弹窗标题（默认 t('control.confirm')）。 */
  title?: string
  /** 具体操作描述，如"确认踢出 xxx？"。 */
  message: string
  busy?: boolean
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 危险操作二次确认弹窗。风格与 AddServerDialog 保持一致：
 * 深色遮罩 + 边框面板 + mono 大写按钮。
 * 若用户在设置中关闭了"危险操作确认"，则 open 时直接执行 onConfirm 不再弹窗。
 */
export default function ConfirmDialog({
  open, title, message, busy, danger = true, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const t = useT()
  const handledRef = useRef(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const messageId = useId()
  useEffect(() => {
    if (!open) { handledRef.current = false; dialog.current?.close(); return }
    let skip = false
    try { skip = localStorage.getItem('pfc.confirmDanger') === '0' } catch { /* confirmation remains enabled */ }
    if (skip) {
      if (!handledRef.current) { handledRef.current = true; onConfirm() }
      return
    }
    if (!dialog.current?.open) dialog.current?.showModal()
  }, [open, onConfirm])
  return createPortal(
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={messageId}
      onCancel={event => { event.preventDefault(); if (!busy) onCancel() }}
      onClick={event => { if (event.target === event.currentTarget && !busy) onCancel() }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm border border-ink-border bg-ink-deep p-0 text-foreground backdrop:bg-black/70">
      <div className="flex items-center gap-2 border-b border-ink-border px-5 py-3">
        {danger && <AlertTriangle size={16} className="text-scp-err" />}
        <h2 id={titleId} className="text-sm font-semibold">{title ?? t('control.confirm')}</h2>
      </div>
      <p id={messageId} className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-5 py-4 text-sm leading-relaxed">{message}</p>
      <div className="flex justify-end gap-2 border-t border-ink-border px-5 py-3">
        <button autoFocus onClick={onCancel} disabled={busy} className="px-3 py-2 text-sm text-ink-mute disabled:opacity-50">{t('common.cancel')}</button>
        <button onClick={onConfirm} disabled={busy} className="flex items-center gap-2 border border-scp-err px-3 py-2 text-sm text-scp-err disabled:opacity-50">
          {busy && <Loader2 size={14} className="animate-spin" />}{t('common.confirm')}
        </button>
      </div>
    </dialog>, document.body,
  )
}
