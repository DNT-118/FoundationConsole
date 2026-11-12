/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Github, HeartHandshake, Share2, X, Pencil } from 'lucide-react'
import PageStub from '@/components/PageStub'
import { useT } from '@/i18n'
import { getAbout, saveAbout, type AboutData } from '@/api/platform'
import { useAuthStore } from '@/store/authStore'

const AUTHOR = 'DNT_OF'
const LINKS = [
  { label: 'GitHub', url: 'https://github.com/DNTOF/SLDataAPI', icon: Github },
  { label: '爱发电', url: 'https://afdian.com/a/DNT_OF', icon: HeartHandshake },
  { label: '哔哩哔哩', url: 'https://space.bilibili.com/3493125592975851', icon: Share2 },
]

export default function About() {
  const t = useT()
  const session = useAuthStore((s) => s.session)
  const isAdmin = session?.role === 'admin'
  const token = session?.token ?? ''
  const [about, setAbout] = useState<AboutData | null>(null)
  const [editing, setEditing] = useState(false)
  const [thanks, setThanks] = useState('')
  const [sponsors, setSponsors] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    getAbout(token).then(setAbout).catch(() => setAbout(null))
  }, [token])

  function openEdit() {
    setThanks((about?.thanks ?? []).join('\n'))
    setSponsors((about?.sponsors ?? []).join('\n'))
    setMsg(null)
    setEditing(true)
  }

  async function submit() {
    setBusy(true); setMsg(null)
    try {
      const split = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean)
      const saved = await saveAbout({ thanks: split(thanks), sponsors: split(sponsors) }, token)
      setAbout(saved)
      setEditing(false)
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageStub
      code="M-15"
      title={t('nav.about')}
      action={
        isAdmin ? (
          <button
            onClick={openEdit}
            className="flex items-center gap-1.5 border border-inverse px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink"
          >
            <Pencil size={12} /> {t('about.edit')}
          </button>
        ) : undefined
      }
    >
      <div className="max-w-2xl space-y-3">
        {/* 作者（Anthropic 风格：Lora 衬线大标题 + 橙色强调） */}
        <section className="border border-ink-border bg-ink-deep p-6">
          <div className="flex flex-wrap gap-2">
            {LINKS.map(({ label, url, icon: Icon }) => (
              <a
                key={label}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 border border-ink-border px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground"
              >
                <Icon size={13} /> {label}
              </a>
            ))}
          </div>
          <div className="mt-7 border-t border-ink-border/60 pt-6">
            <p className="font-['Lora',Georgia,serif] text-[38px] leading-none tracking-[0.04em] text-foreground">
              {AUTHOR}
            </p>
            <div className="mt-4 h-[2px] w-12 bg-accent" />
            <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.35em] text-ink-mute">
              {t('about.creator')}
            </p>
          </div>
        </section>

        {/* 平台概况（模糊描述，不暴露实现细节） */}
        <section className="border border-ink-border bg-ink-deep p-4">
          <SectionLabel>{t('about.platform')}</SectionLabel>
          <div className="mt-3 space-y-1.5 font-mono text-[11px]">
            <Row k={t('about.front')} v={t('about.frontVal')} />
            <Row k={t('about.back')} v={t('about.backVal')} />
            <Row k={t('about.realtime')} v={t('about.realtimeVal')} />
            <Row k={t('about.security')} v={t('about.securityVal')} />
          </div>
        </section>

        {/* 特别鸣谢 */}
        <section className="border border-ink-border bg-ink-deep p-4">
          <SectionLabel>{t('about.thanks')}</SectionLabel>
          {about && about.thanks.length > 0 ? (
            <ul className="mt-3 space-y-1.5 font-mono text-[11px] text-foreground/90">
              {about.thanks.map((x, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-ink-mute">·</span> {x}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 font-mono text-[10px] text-ink-mute">// —</p>
          )}
        </section>

        {/* 赞助 */}
        <section className="border border-ink-border bg-ink-deep p-4">
          <SectionLabel>{t('about.sponsors')}</SectionLabel>
          {about && about.sponsors.length > 0 ? (
            <ul className="mt-3 space-y-1.5 font-mono text-[11px] text-foreground/90">
              {about.sponsors.map((x, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-scp-warn">✦</span> {x}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 font-mono text-[10px] text-ink-mute">// —</p>
          )}
        </section>
      </div>

      {/* 管理员编辑弹窗 */}
      <AnimatePresence>
        {editing && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/70 p-4 backdrop-blur-[2px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div
              className="relative w-full max-w-xl border border-ink-border bg-ink-deep p-6 shadow-2xl"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.98 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-sans text-[15px] font-medium tracking-wide text-foreground">
                  {t('about.editTitle')}
                </h2>
                <button onClick={() => setEditing(false)} className="text-ink-mute transition-colors hover:text-foreground">
                  <X size={16} />
                </button>
              </div>
              {msg && (
                <div className="mb-3 border border-scp-err/40 bg-scp-err/10 px-3 py-2 font-mono text-[10px] text-scp-err">
                  {msg.text}
                </div>
              )}
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                {t('about.thanks')}
              </span>
              <textarea
                value={thanks}
                onChange={(e) => setThanks(e.target.value)}
                placeholder={t('about.thanksPh')}
                rows={5}
                className="mt-1 w-full resize-y border border-ink-border bg-ink px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
              />
              <span className="mt-3 block font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                {t('about.sponsors')}
              </span>
              <textarea
                value={sponsors}
                onChange={(e) => setSponsors(e.target.value)}
                placeholder={t('about.sponsorsPh')}
                rows={5}
                className="mt-1 w-full resize-y border border-ink-border bg-ink px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse"
              />
              <p className="mt-1 font-mono text-[9px] text-ink-mute">{t('about.lineHint')}</p>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => setEditing(false)}
                  className="border border-ink-border px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={() => void submit()}
                  disabled={busy}
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
      {children}
    </span>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <p className="flex gap-2">
      <span className="w-24 shrink-0 text-ink-mute">{k}</span>
      <span className="break-all text-foreground/90">{v}</span>
    </p>
  )
}
