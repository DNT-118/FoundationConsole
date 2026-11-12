import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useControlSource, makeControlQueryFn } from '@/hooks/useControl'
import { useI18nStore } from '@/i18n/store'
import ControlNotice from './ControlNotice'

interface AuditEntry { time: string; actor: string; endpoint: string; body: string; success: boolean; message: string }

export default function AuditLog() {
  const zh = useI18nStore(s => s.lang) === 'zh-CN'
  const { server, control, tokenConfigured } = useControlSource()
  const [limit, setLimit] = useState(100)
  const [filter, setFilter] = useState('')
  const query = useQuery({
    queryKey: ['control', server?.id, 'audit', limit],
    enabled: !!control,
    retry: false,
    queryFn: makeControlQueryFn<{ count: number; entries: AuditEntry[] }>(control!, '/control/audit/list', { limit }),
  })
  const entries = (query.data?.entries ?? []).filter(e => `${e.actor} ${e.endpoint} ${e.message}`.toLowerCase().includes(filter.toLowerCase()))
  return <section className="space-y-3">
    <ControlNotice show={!tokenConfigured} />
    <p className="text-sm text-ink-mute">{zh ? '查看最近的控制操作。API Key 的权限决定可见范围；duty 默认无权读取全量审计，请在游戏服本地调整授权。' : 'Recent control operations. Visibility follows API Key permissions; duty keys cannot read full audit logs by default.'}</p>
    <div className="flex flex-wrap items-center gap-3">
      <input aria-label={zh ? '筛选审计记录' : 'Filter audit records'} placeholder={zh ? '按操作者、接口或结果筛选' : 'Filter actor, endpoint or result'} value={filter} onChange={e => setFilter(e.target.value)} className="min-w-0 flex-1 border border-ink-border bg-ink-deep px-3 py-2 text-sm" />
      <select aria-label={zh ? '审计条数' : 'Audit limit'} value={limit} onChange={e => setLimit(Number(e.target.value))} className="border border-ink-border bg-ink-deep px-3 py-2 text-sm">
        {[50, 100, 250, 500].map(n => <option key={n} value={n}>{n}</option>)}
      </select>
      <button disabled={!control || query.isFetching} onClick={() => void query.refetch()} className="flex items-center gap-2 border border-ink-border px-3 py-2 text-sm disabled:opacity-40"><RefreshCw size={14} />{zh ? '刷新' : 'Refresh'}</button>
    </div>
    {query.isFetching && <p role="status" className="text-sm text-ink-mute">{zh ? '正在读取审计记录…' : 'Loading audit records…'}</p>}
    {query.isError && <p role="alert" className="border border-scp-err/40 p-3 text-sm text-scp-err">{query.error.message}</p>}
    {!query.isError && !query.isPending && entries.length === 0 && <p className="p-4 text-sm text-ink-mute">{zh ? '没有匹配的审计记录。' : 'No matching audit records.'}</p>}
    <div className="divide-y divide-ink-border border border-ink-border">
      {entries.map((e, i) => <details key={`${e.time}-${i}`} className="p-3">
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <time dateTime={e.time} className="text-ink-mute">{new Date(e.time).toLocaleString()}</time>
          <span className="break-all font-mono">{e.actor || '—'}</span>
          <span className="min-w-0 flex-1 break-all font-mono">{e.endpoint}</span>
          <span className={e.success ? 'text-scp-safe' : 'text-scp-err'}>{e.success ? (zh ? '成功' : 'Success') : (zh ? '失败' : 'Failed')}</span>
        </summary>
        <p className="mt-3 break-words text-sm">{e.message}</p>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all bg-ink-deep p-3 text-xs">{e.body || (zh ? '无请求内容或当前权限不可见' : 'Empty or restricted request body')}</pre>
      </details>)}
    </div>
  </section>
}
