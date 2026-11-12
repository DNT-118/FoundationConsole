import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Puzzle, Loader2, RefreshCw, Power, Save, X } from 'lucide-react'
import PageStub from '@/components/PageStub'
import ControlNotice from '@/components/ControlNotice'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useT } from '@/i18n'
import { useControlSource, makeControlQueryFn } from '@/hooks/useControl'
import { useServerQuery } from '@/hooks/useServerQuery'
import { dataSourceFor } from '@/api/registry'
import { describeControlError } from '@/utils/controlHint'
import type { PluginInfo } from '@/types/api'

interface PluginsData {
  count: number
  plugins: PluginInfo[]
}

export default function Plugins() {
  const t = useT()
  const { server, control, tokenConfigured } = useControlSource()
  const { data: serverData } = useServerQuery()
  const dntof = serverData?.dntof ?? null
  const adapted = serverData?.adaptedPlugins ?? []
  const queryClient = useQueryClient()
  const [busyName, setBusyName] = useState<string | null>(null)
  const [applyConfirm, setApplyConfirm] = useState(false)
  const [resultMsg, setResultMsg] = useState<string | null>(null)
  const [routeBusy, setRouteBusy] = useState<string | null>(null)
  const [routeView, setRouteView] = useState<{ key: string; text: string } | null>(null)
  // [内测] 适配插件写/动作路由（POST /control/adapted/<id>/<action>）
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [actionView, setActionView] = useState<{ key: string; text: string } | null>(null)
  const [actionBodies, setActionBodies] = useState<Record<string, string>>({})

  const canRun = !!control
  const canReadRoute = !!(server && dataSourceFor(server).fetchReadOnly)

  /** 适配插件只读路由查询（GET /plugins/<id>/<route>，平台白名单转发）；再次点击同一按钮收起。 */
  async function openRoute(pluginId: string, route: string) {
    const key = `${pluginId}/${route}`
    if (routeView?.key === key) {
      setRouteView(null)
      return
    }
    if (!server) return
    const ds = dataSourceFor(server)
    if (!ds.fetchReadOnly) return
    setRouteBusy(key)
    try {
      const data = await ds.fetchReadOnly(
        `/plugins/${encodeURIComponent(pluginId)}/${encodeURIComponent(route)}`,
      )
      setRouteView({ key, text: JSON.stringify(data, null, 2) })
    } catch (e) {
      setRouteView({ key, text: `⚠ ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setRouteBusy(null)
    }
  }

  /**
   * [内测] 适配插件动作（POST /control/adapted/<plugin_id>/<action>，随 control_transport 走 HTTP/WS）。
   * 可选 JSON 请求体（按插件暂存于 actionBodies）；ACL 默认拒绝，需 Key 的 endpoints_override 显式放开。
   */
  async function runAdaptedAction(pluginId: string, action: string) {
    if (!control) return
    const key = `${pluginId}/${action}`
    const raw = (actionBodies[pluginId] ?? '').trim()
    let body: unknown = {}
    if (raw) {
      try {
        body = JSON.parse(raw)
      } catch {
        setActionView({ key, text: `⚠ ${t('plugins.actionInvalidJson')}` })
        return
      }
    }
    setActionBusy(key)
    setActionView(null)
    try {
      const r = await control(
        `/control/adapted/${encodeURIComponent(pluginId)}/${encodeURIComponent(action)}`,
        body,
      )
      setActionView({ key, text: `${r.message || 'ok'}\n${JSON.stringify(r.data ?? {}, null, 2)}` })
    } catch (e) {
      setActionView({ key, text: `⚠ ${describeControlError(e, t)}` })
    } finally {
      setActionBusy(null)
    }
  }

  const query = useQuery({
    queryKey: ['control', server?.id, 'plugins'],
    enabled: canRun,
    refetchInterval: 30_000,
    queryFn: makeControlQueryFn<PluginsData>(control!, '/control/plugins', {}),
  })

  const plugins = query.data?.plugins ?? []
  const stagedCount = plugins.filter((p) => p.staged != null).length

  /** 插件操作统一入口（stage/apply/clear/reload）：失败弹窗提示。 */
  async function runPluginAction(action: 'stage' | 'apply' | 'clear' | 'reload', name?: string, enabled?: boolean) {
    if (!control) return
    setBusyName(action === 'stage' ? (name ?? '') : `__${action}__`)
    try {
      const r = await control('/control/plugins', {
        action,
        ...(name !== undefined ? { name } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
      })
      if (!r.success) throw new Error(r.message)
      setResultMsg(r.message)   // apply 的结果含“LabAPI 需重启生效”等后端提示，直接展示
      await queryClient.invalidateQueries({ queryKey: ['control', server?.id, 'plugins'] })
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyName(null)
      setApplyConfirm(false)
    }
  }

  return (
    <PageStub code="M-05" title={t('nav.plugins')}>
      <div className="flex h-full flex-col space-y-3">
        <ControlNotice show={!tokenConfigured} />

        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-12 space-y-3 xl:col-span-4">
          {/* DNT_OF 探测 */}
          <section className="border border-ink-border bg-ink-deep p-4">
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
              <Puzzle size={12} className="text-scp-safe" /> {t('plugins.dntof')}
            </span>

            <div className="mt-3 space-y-3">
              <DetectCard
                label={t('plugins.slplayer')}
                present={!!dntof?.sl_player}
                presentText={t('plugins.present')}
                absentText={t('plugins.absent')}
              >
                {dntof?.sl_player?.present && (
                  <>
                    <Meta label={`${t('plugins.sourceMode')}:`}>
                      {dntof.sl_player.source_mode === 'remote'
                        ? t('plugins.remote')
                        : t('plugins.local')}
                    </Meta>
                    {dntof.sl_player.remote_url && (
                      <Meta label="url:"><span className="break-all">{dntof.sl_player.remote_url}</span></Meta>
                    )}
                    <Meta label={`${t('plugins.nowPlaying')}:`}>
                      {dntof.sl_player.now_playing || t('plugins.none')}
                    </Meta>
                  </>
                )}
              </DetectCard>

              <DetectCard
                label={t('plugins.omega')}
                present={!!dntof?.omega_warhead}
                presentText={t('plugins.present')}
                absentText={t('plugins.absent')}
              >
                {dntof?.omega_warhead?.present && (
                  <>
                    <Meta label={`${t('plugins.phase')}:`}>{dntof.omega_warhead.phase}</Meta>
                    {dntof.omega_warhead.controller_holder && (
                      <Meta label={`${t('plugins.holder')}:`}>{dntof.omega_warhead.controller_holder}</Meta>
                    )}
                    {dntof.omega_warhead.countdown != null && (
                      <Meta label={`${t('plugins.countdown')}:`}>{dntof.omega_warhead.countdown}s</Meta>
                    )}
                    {dntof.omega_warhead.coin_holders.length > 0 && (
                      <Meta label={`${t('plugins.coinHolders')}:`}>
                        {dntof.omega_warhead.coin_holders
                          .map((c) => `${c.nickname}(${c.count})`)
                          .join(', ')}
                      </Meta>
                    )}
                  </>
                )}
              </DetectCard>
            </div>
          </section>

          {/* 适配插件发现（SLDataAPI v2.5.5+，verify_token 只读通道） */}
          <section className="border border-ink-border bg-ink-deep p-4">
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
              <Puzzle size={12} className="text-scp-safe" /> {t('plugins.adapted')}
              <span className="text-ink-mute/60">v2.5.5+</span>
            </span>

            {adapted.length === 0 ? (
              <p className="mt-3 font-mono text-[11px] text-ink-mute">{t('plugins.adaptedEmpty')}</p>
            ) : (
              <div className="mt-3 space-y-2">
                {adapted.map((p) => (
                  <div key={p.id} className="border border-ink-border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-foreground">{p.name || p.id}</span>
                      {p.version && (
                        <span className="font-mono text-[9px] text-ink-mute">v{p.version}</span>
                      )}
                    </div>
                    <p className="break-all font-mono text-[9px] text-ink-mute">{p.id}</p>
                    {p.capabilities.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {p.capabilities.map((c) => (
                          <span key={c} className="border border-ink-border px-1 py-0.5 font-mono text-[8px] text-ink-mute">
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                    {p.routes.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {p.routes.map((r) => {
                          const key = `${p.id}/${r}`
                          return (
                            <button
                              key={r}
                              onClick={() => void openRoute(p.id, r)}
                              disabled={!canReadRoute || routeBusy !== null}
                              className="border border-scp-safe/40 px-1.5 py-0.5 font-mono text-[9px] text-scp-safe transition-colors hover:bg-scp-safe hover:text-ink disabled:opacity-40"
                            >
                              {routeBusy === key ? '…' : `/${r}`}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {routeView && routeView.key.startsWith(`${p.id}/`) && (
                      <pre className="mt-1.5 max-h-40 overflow-auto border border-ink-border/60 bg-ink p-1.5 font-mono text-[9px] leading-relaxed text-ink-mute">
                        {routeView.text}
                      </pre>
                    )}
                    {/* [内测] 写/动作路由：POST /control/adapted/<id>/<action> */}
                    {p.actions && p.actions.length > 0 && (
                      <div className="mt-2 border-t border-ink-border/60 pt-2">
                        <div className="flex flex-wrap gap-1">
                          {p.actions.map((a) => {
                            const key = `${p.id}/${a}`
                            return (
                              <button
                                key={a}
                                onClick={() => void runAdaptedAction(p.id, a)}
                                disabled={!canRun || actionBusy !== null}
                                className="border border-scp-warn/40 px-1.5 py-0.5 font-mono text-[9px] text-scp-warn transition-colors hover:bg-scp-warn hover:text-ink disabled:opacity-40"
                              >
                                {actionBusy === key ? '…' : `${a} ▸`}
                              </button>
                            )
                          })}
                        </div>
                        <input
                          value={actionBodies[p.id] ?? ''}
                          onChange={(e) => setActionBodies((m) => ({ ...m, [p.id]: e.target.value }))}
                          placeholder={t('plugins.actionBody')}
                          className="mt-1.5 w-full border border-ink-border bg-ink px-2 py-1 font-mono text-[9px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
                        />
                        <p className="mt-1 font-mono text-[8px] leading-relaxed text-ink-mute">
                          {t('plugins.actionsBeta')}
                        </p>
                      </div>
                    )}
                    {actionView && actionView.key.startsWith(`${p.id}/`) && (
                      <pre className="mt-1.5 max-h-40 overflow-auto border border-ink-border/60 bg-ink p-1.5 font-mono text-[9px] leading-relaxed text-ink-mute">
                        {actionView.text}
                      </pre>
                    )}
                    {p.status != null && (
                      <pre className="mt-1.5 max-h-24 overflow-auto border border-ink-border/60 bg-ink p-1.5 font-mono text-[9px] leading-relaxed text-ink-mute">
                        {JSON.stringify(p.status, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
          </div>

          {/* 插件列表（暂存模式：点击启停只暂存，保存并重载后统一生效） */}
          <section className="col-span-12 xl:col-span-8 flex min-h-0 flex-col border border-ink-border bg-ink-deep">
            <div className="flex items-center justify-between border-b border-ink-border px-3 py-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
                {t('plugins.count')} — {query.data?.count ?? '…'}
                {stagedCount > 0 && (
                  <span className="ml-2 text-scp-warn">· {stagedCount} {t('plugins.staged')}</span>
                )}
              </span>
              <div className="flex items-center gap-2">
                {query.isFetching && <Loader2 size={11} className="animate-spin text-ink-mute" />}
                {stagedCount > 0 && (
                  <button
                    onClick={() => void runPluginAction('clear')}
                    disabled={!canRun || busyName !== null}
                    className="flex items-center gap-1 border border-ink-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-scp-err hover:text-scp-err disabled:opacity-40"
                  >
                    <X size={11} />
                    {t('plugins.clearStaged')}
                  </button>
                )}
                <button
                  onClick={() => setApplyConfirm(true)}
                  disabled={!canRun || busyName !== null || stagedCount === 0}
                  className={`flex items-center gap-1 border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors disabled:opacity-40 ${
                    stagedCount > 0
                      ? 'border-scp-warn text-scp-warn hover:bg-scp-warn hover:text-ink'
                      : 'border-ink-border text-ink-mute'
                  }`}
                >
                  {busyName === '__apply__' ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                  {t('plugins.saveReload')}
                </button>
                <button
                  onClick={() => void runPluginAction('reload')}
                  disabled={!canRun || busyName !== null}
                  className="flex items-center gap-1 border border-ink-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground disabled:opacity-40"
                >
                  {busyName === '__reload__' ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  {t('plugins.reload')}
                </button>
              </div>
            </div>

            {resultMsg && (
              <div className="border-b border-scp-safe/30 bg-scp-safe/5 px-3 py-1.5 font-mono text-[10px] text-scp-safe">
                ✓ {resultMsg}
              </div>
            )}

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
            {!query.isLoading && !query.isError && plugins.length === 0 && (
              <p className="p-4 font-mono text-[11px] text-ink-mute">{t('plugins.empty')}</p>
            )}

            {plugins.length > 0 && (
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full border-collapse font-mono text-[11px]">
                  <thead>
                    <tr className="border-b border-ink-border text-left text-[9px] uppercase tracking-wider text-ink-mute">
                      <th className="px-3 py-2 font-normal">{t('plugins.name')}</th>
                      <th className="px-3 py-2 font-normal">{t('plugins.author')}</th>
                      <th className="px-3 py-2 font-normal">{t('plugins.version')}</th>
                      <th className="px-3 py-2 font-normal">{t('plugins.prefix')}</th>
                      <th className="px-3 py-2 font-normal">{t('plugins.enabled')}</th>
                      <th className="px-3 py-2 font-normal" />
                    </tr>
                  </thead>
                  <tbody>
                    {plugins.map((p) => {
                      // 有效状态：有暂存以暂存为准，否则读配置文件状态
                      const effective = p.staged != null ? p.staged : p.enabled
                      const self = p.self === true
                      return (
                        <tr key={p.name} className={`border-b border-ink-border/60 hover:bg-ink ${p.staged != null ? 'bg-scp-warn/5' : ''}`}>
                          <td className="px-3 py-2 text-foreground">
                            {p.name}
                            {p.source && (
                              <span className={`ml-2 border px-1 py-0.5 font-mono text-[8px] uppercase tracking-wider ${
                                p.source === 'labapi'
                                  ? 'border-scp-safe/50 text-scp-safe'
                                  : 'border-ink-mute text-ink-mute'
                              }`}>
                                {p.source === 'labapi' ? t('plugins.sourceLabapi') : t('plugins.sourceExiled')}
                              </span>
                            )}
                            {self && (
                              <span className="ml-2 border border-scp-warn/50 px-1 py-0.5 font-mono text-[8px] uppercase tracking-wider text-scp-warn">
                                {t('plugins.self')}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-ink-mute">{p.author}</td>
                          <td className="px-3 py-2 text-ink-mute">{p.version}</td>
                          <td className="px-3 py-2 text-ink-mute">{p.prefix}</td>
                          <td className="px-3 py-2">
                            <span className={effective ? 'text-scp-safe' : 'text-scp-err'}>
                              {effective ? t('plugins.enabled') : t('plugins.disabled')}
                            </span>
                            {p.staged != null && p.staged !== p.enabled && (
                              <span className="ml-2 font-mono text-[9px] text-scp-warn">
                                → {t('plugins.staged')}: {p.staged ? t('plugins.enable') : t('plugins.disable')}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => {
                                const target = p.staged != null ? !p.staged : !p.enabled
                                void runPluginAction('stage', p.name, target)
                              }}
                              disabled={!canRun || busyName !== null || self}
                              title={self ? t('plugins.selfHint') : undefined}
                              className={`inline-flex items-center gap-1 border px-2 py-1 font-mono text-[9px] uppercase tracking-wider transition-colors disabled:opacity-40 ${
                                effective
                                  ? 'border-scp-err/50 text-scp-err hover:bg-scp-err hover:text-foreground'
                                  : 'border-scp-safe/50 text-scp-safe hover:bg-scp-safe hover:text-foreground'
                              }`}
                            >
                              {busyName === p.name ? (
                                <Loader2 size={10} className="animate-spin" />
                              ) : (
                                <Power size={10} />
                              )}
                              {effective ? t('plugins.disable') : t('plugins.enable')}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={applyConfirm}
        message={`${t('plugins.confirmApply').replace('{count}', String(stagedCount))} ${t('plugins.applyHint')}`}
        busy={busyName !== null}
        onCancel={() => setApplyConfirm(false)}
        onConfirm={() => void runPluginAction('apply')}
      />
    </PageStub>
  )
}

function DetectCard({
  label, present, presentText, absentText, children,
}: { label: string; present: boolean; presentText: string; absentText: string; children?: React.ReactNode }) {
  return (
    <div className={`border px-3 py-2.5 ${present ? 'border-scp-safe/30' : 'border-ink-border'}`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-foreground">{label}</span>
        <span className={`font-mono text-[9px] uppercase tracking-wider ${present ? 'text-scp-safe' : 'text-ink-mute'}`}>
          {present ? `● ${presentText}` : `○ ${absentText}`}
        </span>
      </div>
      {present && <div className="mt-2 space-y-0.5">{children}</div>}
    </div>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] text-ink-mute">
      <span className="text-ink-mute">{label} </span>
      <span className="text-foreground">{children}</span>
    </p>
  )
}
