import { useRef, useState } from 'react'
import { Terminal, Trash2, Loader2 } from 'lucide-react'
import PageStub from '@/components/PageStub'
import ControlNotice from '@/components/ControlNotice'
import { useT } from '@/i18n'
import { useControlMutation, useControlSource } from '@/hooks/useControl'
import type { CommandResult } from '@/types/api'

interface LogEntry {
  id: number
  kind: 'cmd' | 'out' | 'console' | 'mute' | 'err'
  text: string
}

export default function Console() {
  const t = useT()
  const { control, tokenConfigured } = useControlSource()
  const mutation = useControlMutation()

  const [input, setInput] = useState('')
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [history, setHistory] = useState<string[]>([])
  const idRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const canRun = !!control
  const running = mutation.isPending

  async function run(raw: string) {
    const cmd = raw.trim()
    if (!cmd || !canRun || running) return
    setInput('')
    setHistory((h) => (h[0] === cmd ? h : [cmd, ...h].slice(0, 20)))
    setEntries((e) => [...e, { id: ++idRef.current, kind: 'cmd', text: `> ${cmd}` }])
    try {
      const result = await mutation.mutateAsync({ path: '/control/console/command', body: { command: cmd } })
      const data = result.data as CommandResult | undefined
      // 命令回显：output（点命令 .m 等）与 console（普通命令）都可能有值；
      // 普通命令两字段内容通常一致，去重后拼接
      const combined = [...new Set([data?.output?.trim(), data?.console?.trim()].filter(Boolean))].join('\n')
      if (combined) {
        setEntries((e) => [...e, { id: ++idRef.current, kind: 'out', text: combined }])
      } else {
        setEntries((e) => [...e, { id: ++idRef.current, kind: 'mute', text: '(无输出)' }])
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setEntries((prev) => [...prev, { id: ++idRef.current, kind: 'err', text: `! ${msg}` }])
    }
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    })
  }

  return (
    <PageStub code="M-07" title={t('nav.console')}>
      <div className="flex h-full flex-col space-y-3">
        <ControlNotice show={!tokenConfigured} />
        <p className="font-mono text-[10px] text-ink-mute">{t('console.hint')}</p>

        <div className="flex min-h-0 flex-1 flex-col border border-ink-border bg-ink-deep">
          <div className="flex items-center justify-between border-b border-ink-border px-3 py-2">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
              <Terminal size={12} /> {t('nav.console')}
            </div>
            <button
              onClick={() => setEntries([])}
              disabled={entries.length === 0}
              className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:text-scp-err disabled:opacity-40"
            >
              <Trash2 size={11} /> {t('console.clear')}
            </button>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {entries.length === 0 && (
              <p className="font-mono text-[11px] text-ink-mute">{t('console.empty')}</p>
            )}
            {entries.map((e) => (
              <p
                key={e.id}
                className={`whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed ${
                  e.kind === 'cmd'
                    ? 'text-foreground'
                    : e.kind === 'err'
                      ? 'text-scp-err'
                      : e.kind === 'console'
                        ? 'text-scp-warn/80'
                        : e.kind === 'mute'
                          ? 'text-ink-mute'
                          : 'text-ink-mute'
                }`}
              >
                {e.text}
              </p>
            ))}
          </div>

          <form
            onSubmit={(ev) => { ev.preventDefault(); void run(input) }}
            className="flex items-center gap-2 border-t border-ink-border px-3 py-2"
          >
            <span className="font-mono text-[12px] text-scp-safe">{'>'}</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={!canRun || running}
              placeholder={canRun ? t('console.prompt') : t('control.unavailable')}
              className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-foreground placeholder:text-ink-mute focus:outline-none"
            />
            {running && <Loader2 size={13} className="shrink-0 animate-spin text-ink-mute" />}
            <button
              type="submit"
              disabled={!canRun || running || input.trim() === ''}
              className="shrink-0 border border-inverse px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink disabled:opacity-40"
            >
              {t('console.run')}
            </button>
          </form>
        </div>

        {history.length > 0 && (
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
              {t('console.history')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {history.map((h) => (
                <button
                  key={h}
                  onClick={() => void run(h)}
                  disabled={!canRun || running}
                  className="border border-ink-border bg-ink-deep px-2 py-1 font-mono text-[10px] text-ink-mute transition-colors hover:border-inverse hover:text-foreground disabled:opacity-40"
                >
                  {h}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </PageStub>
  )
}
