import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Megaphone } from 'lucide-react'
import { getAnnouncement, type AnnouncementData } from '@/api/platform'
import { useT } from '@/i18n'
import { useI18nStore } from '@/i18n/store'
import { useAuthStore } from '@/store/authStore'

/** 登录通知弹窗（挂载于 AppShell）：登录后按公告版本判断是否提醒，可勾选「下次不再提醒」。 */
const DISMISSED_KEY = 'pfc.ann.dismissed'

export default function AnnouncementPopup() {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const session = useAuthStore((s) => s.session)
  const [ann, setAnn] = useState<AnnouncementData | null>(null)
  const [dontShow, setDontShow] = useState(false)

  useEffect(() => {
    if (!session) return
    let alive = true
    getAnnouncement(session.token ?? '')
      .then((a) => {
        if (!alive) return
        if (!a.enabled || !a.popupEnabled) return
        let dismissed = 0
        try { dismissed = Number(localStorage.getItem(DISMISSED_KEY) || '0') || 0 } catch { /* ignore */ }
        if (a.version > dismissed) setAnn(a)
      })
      .catch(() => { /* ignore */ })
    return () => { alive = false }
  }, [session])

  if (!ann) return null
  const lk = lang === 'en' ? 'en' : 'zh'
  const title = ann.title[lk] || ann.title.zh || t('announcement.popupTitle')
  const content = ann.content[lk] || ann.content.zh || ''
  const annVersion = ann.version

  function close() {
    if (dontShow) {
      try { localStorage.setItem(DISMISSED_KEY, String(annVersion)) } catch { /* ignore */ }
    }
    setAnn(null)
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/70 p-4 backdrop-blur-[2px]"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      >
        <motion.div
          className="relative w-full max-w-md border border-ink-border bg-ink-deep p-6 shadow-2xl"
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: 0.98 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="mb-4 flex items-center gap-3">
            <Megaphone size={18} className="text-scp-safe" />
            <h2 className="font-sans text-[15px] font-medium tracking-wide text-foreground">{title}</h2>
          </div>
          <div className="max-h-[40vh] overflow-auto whitespace-pre-wrap border border-ink-border bg-ink/60 p-4 font-mono text-[12px] leading-relaxed text-foreground/90">
            {content || t('announcement.popupEmpty')}
          </div>
          <label className="mt-4 flex cursor-pointer select-none items-center gap-2">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="h-3.5 w-3.5 accent-scp-safe"
            />
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
              {t('announcement.dontShowAgain')}
            </span>
          </label>
          <button
            onClick={close}
            className="mt-4 w-full border border-inverse py-2.5 font-mono text-[11px] uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-inverse hover:text-ink"
          >
            {t('announcement.close')}
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
