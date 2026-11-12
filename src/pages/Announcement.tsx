import DOMPurify from 'dompurify'
import { useEffect, useState } from 'react'
import { marked } from 'marked'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Trash2, X } from 'lucide-react'
import PageStub from '@/components/PageStub'
import { useT } from '@/i18n'
import { useI18nStore } from '@/i18n/store'
import {
  getAnnouncements, addAnnouncement, deleteAnnouncement,
  type AnnouncementItem,
} from '@/api/platform'
import { useAuthStore } from '@/store/authStore'

/** 正式公告页（M-02）：多公告列表，管理员右上角添加（弹窗撰写，支持 markdown），可删除。 */
export default function Announcement() {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const session = useAuthStore((s) => s.session)
  const isAdmin = session?.role === 'admin'
  const token = session?.token ?? ''
  const [items, setItems] = useState<AnnouncementItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // 撰写弹窗
  const [writing, setWriting] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  async function load() {
    try {
      const list = await getAnnouncements(token)
      setItems(list)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally {
      setLoaded(true)
    }
  }
  useEffect(() => { void load() }, [token])

  async function submit() {
    if (!title.trim()) return
    setBusy(true); setErr(null)
    try {
      await addAnnouncement({ title: title.trim(), content }, token)
      setTitle(''); setContent('')
      setWriting(false)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true); setErr(null)
    try {
      await deleteAnnouncement(id, token)
      setItems((list) => list.filter((i) => i.id !== id))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function renderMd(text: string): string {
    try { return DOMPurify.sanitize(marked.parse(text, { async: false }), { USE_PROFILES: { html: true } }) } catch { return DOMPurify.sanitize(text, { ALLOWED_TAGS: [] }) }
  }

  const fmt = (ts: number) =>
    new Date(ts).toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN')

  return (
    <PageStub
      code="M-02"
      title={t('announcement.title')}
      action={
        isAdmin ? (
          <button
            onClick={() => setWriting(true)}
            className="flex items-center gap-1.5 border border-inverse px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink"
          >
            <Plus size={12} /> {t('announcement.add')}
          </button>
        ) : undefined
      }
    >
      {err && (
        <div className="mb-3 border border-scp-err/40 bg-scp-err/10 px-3 py-2 font-mono text-[10px] text-scp-err">
          {err}
        </div>
      )}

      {loaded && items.length === 0 ? (
        <p className="font-mono text-[12px] text-ink-mute">{t('announcement.empty')}</p>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <article key={item.id} className="border border-ink-border bg-ink-deep/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-sans text-[15px] font-medium tracking-wide text-foreground">{item.title}</h2>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                    {fmt(item.createdAt)}
                    {item.author ? ` · ${item.author}` : ''}
                  </p>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => void remove(item.id)}
                    disabled={busy}
                    className="shrink-0 text-ink-mute transition-colors hover:text-scp-err disabled:opacity-40"
                    title={t('announcement.delete')}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              {item.content && (
                <div
                  className="ann-md mt-3 whitespace-pre-wrap border-t border-ink-border/60 pt-3 font-mono text-[12px] leading-relaxed text-foreground/90"
                  dangerouslySetInnerHTML={{ __html: renderMd(item.content) }}
                />
              )}
            </article>
          ))}
        </div>
      )}

      {/* 撰写弹窗（管理员） */}
      <AnimatePresence>
        {writing && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/70 p-4 backdrop-blur-[2px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div
              className="relative w-full max-w-2xl border border-ink-border bg-ink-deep p-6 shadow-2xl"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.98 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-sans text-[15px] font-medium tracking-wide text-foreground">
                  {t('announcement.compose')}
                </h2>
                <button onClick={() => setWriting(false)} className="text-ink-mute transition-colors hover:text-foreground">
                  <X size={16} />
                </button>
              </div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('announcement.titlePh')}
                maxLength={300}
                autoFocus
                className="w-full border border-ink-border bg-ink px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
              />
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t('announcement.contentPh')}
                rows={10}
                className="mt-3 w-full resize-y border border-ink-border bg-ink px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
              />
              <p className="mt-1 font-mono text-[9px] text-ink-mute">{t('announcement.mdHint')}</p>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => setWriting(false)}
                  className="border border-ink-border px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={() => void submit()}
                  disabled={busy || !title.trim()}
                  className="border border-inverse px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink disabled:opacity-40"
                >
                  {t('common.confirm')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </PageStub>
  )
}
