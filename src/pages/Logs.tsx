import AuditLog from '@/components/AuditLog'
import { useI18nStore } from '@/i18n/store'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ScrollText, RefreshCw, Loader2 } from 'lucide-react'
import PageStub from '@/components/PageStub'
import ControlNotice from '@/components/ControlNotice'
import { useT } from '@/i18n'
import { useControlSource, makeControlQueryFn } from '@/hooks/useControl'
import type { LogTailResult, LogListResult } from '@/types/api'

const LINE_OPTIONS = [200, 500, 1000, 2000]

export default function Logs() {
  const [tab, setTab] = useState<'server' | 'audit'>('server')
  const zh = useI18nStore(s => s.lang) === 'zh-CN'
  return <div className="flex h-full flex-col gap-3">
    <div className="flex gap-2 px-4 pt-3" role="group" aria-label={zh ? '日志类型' : 'Log type'}>
      {(['server', 'audit'] as const).map(value => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)} className={`border px-4 py-2 text-sm ${tab === value ? 'border-inverse text-foreground' : 'border-ink-border text-ink-mute'}`}>{value === 'server' ? (zh ? '服务器日志' : 'Server logs') : (zh ? '控制审计' : 'Control audit')}</button>)}
    </div>
    <div className="min-h-0 flex-1">{tab === 'server' ? <ServerLogs /> : <PageStub code="M-10" title={zh ? '控制审计' : 'Control audit'}><AuditLog /></PageStub>}</div>
  </div>
}

function ServerLogs() {
  const t = useT()
  const { server, control, tokenConfigured } = useControlSource()

  const [lines, setLines] = useState(500)
  const [filterInput, setFilterInput] = useState('')
  const [filter, setFilter] = useState('')
  const [auto, setAuto] = useState(true)
  const [selectedPath, setSelectedPath] = useState('')

  // 过滤输入 300ms debounce，避免每敲一个键就发一次请求
  useEffect(() => {
    const h = setTimeout(() => setFilter(filterInput), 300)
    return () => clearTimeout(h)
  }, [filterInput])

  const canRun = !!control

  // 可用日志文件列表（30s 刷新；服务端只返回日志目录内的 .log/.txt，读取同样受限）
  const filesQuery = useQuery({
    queryKey: ['control', server?.id, 'logs', 'list'],
    enabled: canRun,
    refetchInterval: 30_000,
    queryFn: makeControlQueryFn<LogListResult>(control!, '/control/logs', { action: 'list' }),
  })
  const logFiles = filesQuery.data?.files ?? []

  // 默认选中最新日志（列表按修改时间倒序，第一个即最新）
  useEffect(() => {
    if (!selectedPath && logFiles.length > 0) {
      setSelectedPath(logFiles[0].path)
    }
  }, [logFiles, selectedPath])

  const query = useQuery({
    queryKey: ['control', server?.id, 'logs', lines, filter, selectedPath],
    enabled: canRun,
    refetchInterval: auto ? 5000 : false,
    queryFn: makeControlQueryFn<LogTailResult>(control!, '/control/logs', {
      lines,
      filter: filter.trim(),
      path: selectedPath,
    }),
  })

  const logLines = query.data?.lines ?? []

  return (
    <PageStub code="M-10" title={t('nav.logs')}>
      <div className="flex h-full flex-col space-y-3">
        <ControlNotice show={!tokenConfigured} />

        <div className="flex flex-wrap items-center gap-2 border border-ink-border bg-ink-deep px-3 py-2">
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
            <ScrollText size={12} /> {t('logs.file')}
          </span>
          <select
            value={selectedPath}
            onChange={(e) => setSelectedPath(e.target.value)}
            disabled={!canRun || logFiles.length === 0}
            className="max-w-72 border border-ink-border bg-ink px-2 py-1 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse disabled:opacity-40"
          >
            {logFiles.length === 0 && <option value="">{t('logs.none')}</option>}
            {logFiles.map((f) => (
              <option key={f.path} value={f.path}>
                {f.name}
              </option>
            ))}
          </select>
          {filesQuery.isFetching && <Loader2 size={11} className="animate-spin text-ink-mute" />}
          <span className="font-mono text-[10px] text-ink-mute">{query.data?.path ?? ''}</span>

          <div className="flex-1" />

          <input
            value={filterInput}
            onChange={(e) => setFilterInput(e.target.value)}
            disabled={!canRun}
            placeholder={t('logs.filter')}
            className="w-48 border border-ink-border bg-ink px-2 py-1 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
          />
          <select
            value={lines}
            onChange={(e) => setLines(Number(e.target.value))}
            disabled={!canRun}
            className="border border-ink-border bg-ink px-2 py-1 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse disabled:opacity-40"
          >
            {LINE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
              disabled={!canRun}
              className="accent-foreground"
            />
            {t('logs.auto')}
          </label>
          <button
            onClick={() => void query.refetch()}
            disabled={!canRun || query.isFetching}
            className="flex items-center gap-1 border border-ink-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground disabled:opacity-40"
          >
            <RefreshCw size={11} className={query.isFetching ? 'animate-spin' : ''} />
            {t('logs.refresh')}
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col border border-ink-border bg-ink-deep">
          <div className="flex items-center justify-between border-b border-ink-border px-3 py-1.5">
            <span className="font-mono text-[9px] uppercase tracking-wider text-ink-mute">
              {query.isLoading ? '…' : `${query.data?.total ?? 0} ${t('logs.lines')}`}
            </span>
            {query.isFetching && <Loader2 size={11} className="animate-spin text-ink-mute" />}
          </div>

          {query.isLoading && (
            <div className="flex items-center gap-2 p-4 font-mono text-[11px] text-ink-mute">
              <Loader2 size={12} className="animate-spin" /> {t('common.loading')}
            </div>
          )}
          {(query.isError || filesQuery.isError) && (
            <div className="m-3 border-l-2 border-scp-err/60 bg-scp-err/5 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-scp-err">
              {(query.error || filesQuery.error)?.message}
            </div>
          )}
          {!query.isLoading && !query.isError && logLines.length === 0 && (
            <p className="p-4 font-mono text-[11px] text-ink-mute">{t('logs.empty')}</p>
          )}

          {logLines.length > 0 && (
            <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
              {logLines.map((line, i) => (
                <p
                  key={`${query.data?.file}-${i}`}
                  className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink-mute"
                >
                  {line || ' '}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageStub>
  )
}
