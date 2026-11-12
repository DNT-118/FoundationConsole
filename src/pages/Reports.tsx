import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import PageStub from '@/components/PageStub'
import ControlNotice from '@/components/ControlNotice'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useT } from '@/i18n'
import { useI18nStore } from '@/i18n/store'
import { makeControlQueryFn, useControlMutation, useControlSource } from '@/hooks/useControl'
import type { ReportRecord } from '@/types/api'

function formatReportTime(value: string, lang: 'zh-CN' | 'en'): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '—'
  return new Intl.DateTimeFormat(lang === 'zh-CN' ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date)
}

export default function Reports() {
  const t = useT()
  const lang = useI18nStore((state) => state.lang)
  const queryClient = useQueryClient()
  const { server, control, tokenConfigured } = useControlSource()
  const mutation = useControlMutation()
  const [pending, setPending] = useState<ReportRecord | null>(null)
  const canRun = !!control

  const queryKey = ['control', 'reports', server?.id ?? 'none']
  const query = useQuery({
    queryKey,
    enabled: canRun,
    refetchInterval: 15_000,
    queryFn: makeControlQueryFn<ReportRecord[]>(control!, '/control/reports', { action: 'list' }),
  })

  const reports = query.data ?? []

  function handleReport() {
    if (!pending) return
    const id = pending.id
    void mutation.mutateAsync({ path: '/control/reports', body: { action: 'handle', id } })
      .then(async () => {
        setPending(null)
        await queryClient.invalidateQueries({ queryKey })
      }).catch(() => { /* mutation.error is rendered below */ })
  }

  return (
    <PageStub
      code="M-15"
      title={t('nav.reports')}
      action={(
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={!canRun || query.isFetching}
          className="flex items-center gap-1.5 border border-ink-border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw size={11} className={query.isFetching ? 'animate-spin' : ''} />
          {t('reports.refresh')}
        </button>
      )}
    >
      <div className="flex h-full flex-col gap-3">
        <ControlNotice show={!tokenConfigured} />

        <div className="flex flex-wrap items-center justify-between gap-3 border border-ink-border bg-ink-deep px-3 py-2.5">
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} className="text-scp-warn" />
            <span className="font-mono text-[11px] text-foreground">{t('reports.pending')}</span>
            <span className="font-mono text-[11px] text-scp-warn">{reports.length}</span>
          </div>
          <span className="font-mono text-[10px] text-ink-mute">{t('reports.autoRefresh')}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto border border-ink-border bg-ink-deep">
          {query.isLoading && (
            <div className="flex items-center gap-2 p-4 font-mono text-[11px] text-ink-mute">
              <Loader2 size={12} className="animate-spin" /> {t('common.loading')}
            </div>
          )}

          {query.isError && (
            <div className="m-3 border border-scp-err/40 bg-scp-err/5 px-3 py-2 font-mono text-[10px] leading-relaxed text-scp-err">
              {query.error instanceof Error ? query.error.message : String(query.error)}
            </div>
          )}

          {mutation.isError && (
            <div className="m-3 border border-scp-err/40 bg-scp-err/5 px-3 py-2 font-mono text-[10px] leading-relaxed text-scp-err">
              {mutation.error instanceof Error ? mutation.error.message : String(mutation.error)}
            </div>
          )}

          {!query.isLoading && !query.isError && reports.length === 0 && (
            <div className="flex min-h-44 flex-col items-center justify-center gap-2 p-6 text-center">
              <Check size={20} className="text-scp-safe" />
              <p className="font-mono text-[11px] text-foreground">{t('reports.empty')}</p>
              <p className="max-w-[64ch] font-mono text-[10px] leading-relaxed text-ink-mute">
                {t('reports.emptyHint')}
              </p>
            </div>
          )}

          {reports.map((report) => (
            <article
              key={report.id}
              className="grid gap-3 border-b border-ink-border px-3 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(220px,1.4fr)_auto] md:items-center"
            >
              <div className="min-w-0">
                <p className="font-mono text-[9px] uppercase tracking-wider text-ink-mute">{t('reports.reporter')}</p>
                <p className="mt-1 truncate text-[12px] text-foreground" title={report.reporter_name}>{report.reporter_name || '—'}</p>
                <p className="mt-0.5 break-all font-mono text-[9px] text-ink-mute">{report.reporter_steam64 || '—'}</p>
                <p className="break-all font-mono text-[9px] text-ink-mute">{report.reporter_ip || '—'}</p>
              </div>

              <div className="min-w-0">
                <p className="font-mono text-[9px] uppercase tracking-wider text-ink-mute">{t('reports.target')}</p>
                <p className="mt-1 truncate text-[12px] text-foreground" title={report.target_name}>{report.target_name || '—'}</p>
                <p className="mt-0.5 break-all font-mono text-[9px] text-ink-mute">{report.target_steam64 || '—'}</p>
              </div>

              <div className="min-w-0">
                <p className="font-mono text-[9px] uppercase tracking-wider text-ink-mute">{t('reports.reason')}</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground">{report.reason || '—'}</p>
                <p className="mt-1 font-mono text-[9px] text-ink-mute">{formatReportTime(report.reported_at, lang)}</p>
              </div>

              <button
                type="button"
                onClick={() => setPending(report)}
                disabled={mutation.isPending}
                className="flex items-center justify-center gap-1.5 border border-scp-safe px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-scp-safe transition-colors hover:bg-scp-safe hover:text-ink disabled:opacity-40"
              >
                <Check size={12} /> {t('reports.handle')}
              </button>
            </article>
          ))}
        </div>

        <ConfirmDialog
          open={pending !== null}
          title={t('reports.handleTitle')}
          message={pending ? `${t('reports.handleConfirm')} ${pending.target_name || pending.target_steam64}` : ''}
          busy={mutation.isPending}
          danger={false}
          onCancel={() => setPending(null)}
          onConfirm={handleReport}
        />
      </div>
    </PageStub>
  )
}
