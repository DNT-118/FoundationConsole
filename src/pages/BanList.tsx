import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Loader2, RefreshCw } from 'lucide-react'
import PageStub from '@/components/PageStub'
import ControlNotice from '@/components/ControlNotice'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useT } from '@/i18n'
import { useControlMutation, useControlSource, makeControlQueryFn } from '@/hooks/useControl'
import type { BanEntry } from '@/types/api'

interface BanListData {
  count: number
  bans: BanEntry[]
}

/** unix 秒 → 本地时间字符串；0 = 永久。 */
function fmtTime(t: ReturnType<typeof useT>, unixSec: number): string {
  if (!unixSec) return t('banlist.permanent')
  return new Date(unixSec * 1000).toLocaleString()
}

export default function BanList() {
  const t = useT()
  const { server, control, tokenConfigured } = useControlSource()
  const mutation = useControlMutation()
  const queryClient = useQueryClient()

  const [revokeTarget, setRevokeTarget] = useState<BanEntry | null>(null)
  const [addConfirm, setAddConfirm] = useState(false)
  const [form, setForm] = useState({ target: '', reason: '', duration: 60, type: 'steam' as 'steam' | 'ip' })

  const canRun = !!control
  const busy = mutation.isPending

  const query = useQuery({
    queryKey: ['control', server?.id, 'ban_list'],
    enabled: canRun,
    queryFn: makeControlQueryFn<BanListData>(control!, '/control/moderation/ban_list', {}),
  })

  const bans = query.data?.bans ?? []

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['control', server?.id, 'ban_list'] })
  }

  function doRevoke() {
    if (!revokeTarget) return
    setRevokeTarget(null)
    void mutation.mutateAsync({
      path: '/control/moderation/ban/revoke',
      body: { user_id: revokeTarget.user_id, ban_type: revokeTarget.ban_type, reason: 'WebUI revoke' },
    }).then(() => refresh()).catch(() => undefined)
  }

  function doAdd() {
    setAddConfirm(false)
    if (!form.target.trim()) return
    void mutation.mutateAsync({
      path: '/control/moderation/ban/add',
      body: {
        user_id: form.target.trim(),
        original_name: '',
        reason: form.reason.trim(),
        duration: form.duration,
        ban_type: form.type,
      },
    }).then(() => {
      setForm((f) => ({ ...f, target: '', reason: '' }))
      return refresh()
    }).catch(() => undefined)
  }

  return (
    <PageStub code="M-11" title={t('nav.banlist')}>
      <div className="flex h-full flex-col space-y-3">
        <ControlNotice show={!tokenConfigured} />

        {/* 新增封禁 */}
        <div className="flex flex-wrap items-end gap-2 border border-ink-border bg-ink-deep p-3">
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
            <Ban size={12} className="text-scp-err" /> {t('banlist.banNew')}
          </span>
          <input
            value={form.target}
            onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
            disabled={!canRun || busy}
            placeholder={t('banlist.newTarget')}
            className="w-64 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
          />
          <input
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            disabled={!canRun || busy}
            placeholder={t('banlist.newReason')}
            className="w-48 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
          />
          <input
            type="number"
            min={0}
            value={form.duration}
            onChange={(e) => setForm((f) => ({ ...f, duration: Number(e.target.value) }))}
            disabled={!canRun || busy}
            placeholder={t('banlist.newDuration')}
            className="w-36 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
          />
          <select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as 'steam' | 'ip' }))}
            disabled={!canRun || busy}
            className="border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse disabled:opacity-40"
          >
            <option value="steam">{t('banlist.typeSteam')}</option>
            <option value="ip">{t('banlist.typeIp')}</option>
          </select>
          <button
            onClick={() => setAddConfirm(true)}
            disabled={!canRun || busy || !form.target.trim()}
            className="border border-scp-err px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-scp-err transition-colors hover:bg-scp-err hover:text-foreground disabled:opacity-40"
          >
            {t('banlist.add')}
          </button>
          {busy && <Loader2 size={13} className="animate-spin text-ink-mute" />}
        </div>

        {/* 列表 */}
        <div className="flex min-h-0 flex-1 flex-col border border-ink-border bg-ink-deep">
          <div className="flex items-center justify-between border-b border-ink-border px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
              {t('banlist.count')} — {bans.length}
            </span>
            <button
              onClick={() => void refresh()}
              disabled={!canRun || query.isFetching}
              className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:text-foreground disabled:opacity-40"
            >
              <RefreshCw size={11} className={query.isFetching ? 'animate-spin' : ''} /> {t('logs.refresh')}
            </button>
          </div>

          {query.isLoading && (
            <div className="flex items-center gap-2 p-4 font-mono text-[11px] text-ink-mute">
              <Loader2 size={12} className="animate-spin" /> {t('common.loading')}
            </div>
          )}
          {query.isError && (
            <div className="m-3 border-l-2 border-scp-err/60 bg-scp-err/5 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-scp-err">
              {query.error instanceof Error ? query.error.message : String(query.error)}
            </div>
          )}
          {!query.isLoading && !query.isError && bans.length === 0 && (
            <p className="p-4 font-mono text-[11px] text-ink-mute">{t('banlist.empty')}</p>
          )}

          {bans.length > 0 && (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full border-collapse font-mono text-[11px]">
                <thead>
                  <tr className="border-b border-ink-border text-left text-[9px] uppercase tracking-wider text-ink-mute">
                    <th className="px-3 py-2 font-normal">{t('banlist.userId')}</th>
                    <th className="px-3 py-2 font-normal">{t('banlist.name')}</th>
                    <th className="px-3 py-2 font-normal">{t('banlist.reason')}</th>
                    <th className="px-3 py-2 font-normal">{t('banlist.issuer')}</th>
                    <th className="px-3 py-2 font-normal">{t('banlist.type')}</th>
                    <th className="px-3 py-2 font-normal">{t('banlist.issuedAt')}</th>
                    <th className="px-3 py-2 font-normal">{t('banlist.expires')}</th>
                    <th className="px-3 py-2 font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {bans.map((b) => {
                    const expired = b.expires > 0 && b.expires * 1000 < Date.now()
                    return (
                      <tr key={`${b.ban_type}:${b.user_id}`} className="border-b border-ink-border/60 hover:bg-ink">
                        <td className="px-3 py-2 break-all text-foreground">{b.user_id}</td>
                        <td className="px-3 py-2 text-ink-mute">{b.original_name || '—'}</td>
                        <td className="max-w-[220px] truncate px-3 py-2 text-ink-mute">{b.reason || '—'}</td>
                        <td className="px-3 py-2 text-ink-mute">{b.issuer || '—'}</td>
                        <td className="px-3 py-2 text-ink-mute">
                          {b.ban_type === 'ip' ? t('banlist.typeIp') : t('banlist.typeSteam')}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-ink-mute">{fmtTime(t, b.issuance_time)}</td>
                        <td className={`px-3 py-2 whitespace-nowrap ${expired ? 'text-ink-mute' : 'text-foreground'}`}>
                          {expired ? t('banlist.expired') : fmtTime(t, b.expires)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => setRevokeTarget(b)}
                            disabled={!canRun || busy}
                            className="font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:text-scp-err disabled:opacity-40"
                          >
                            {t('banlist.revoke')}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <ConfirmDialog
          open={revokeTarget !== null || addConfirm}
          message={addConfirm
            ? t('banlist.confirmBanNew').replace('{id}', form.target.trim()).replace('{duration}', String(form.duration))
            : revokeTarget
              ? t('banlist.confirmRevoke').replace('{id}', revokeTarget.user_id)
              : ''}
          busy={busy}
          onCancel={() => { setRevokeTarget(null); setAddConfirm(false) }}
          onConfirm={() => (addConfirm ? doAdd() : doRevoke())}
        />
      </div>
    </PageStub>
  )
}
