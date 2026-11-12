import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUp, Folder, File, RefreshCw, Save, ArrowLeft, Loader2, Download, Upload,
} from 'lucide-react'
import PageStub from '@/components/PageStub'
import ControlNotice from '@/components/ControlNotice'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useT } from '@/i18n'
import { useControlMutation, useControlSource, makeControlQueryFn } from '@/hooks/useControl'
import { useServersStore } from '@/store/serversStore'
import { betaKnown, useUpstreamStore } from '@/ws/upstreamStore'
import { chunkedRead, chunkedWrite, ChunkCancelled, FILE_MAX_WRITE_BYTES, sha256Hex } from '@/api/filesChunk'
import { describeControlError } from '@/utils/controlHint'
import type { FileListResult, FileReadResult } from '@/types/api'

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function joinPath(base: string, name: string): string {
  return base ? `${base}/${name}` : name
}

function parentPath(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx <= 0 ? '' : p.slice(0, idx)
}

export default function Files() {
  const t = useT()
  const { server, control, tokenConfigured } = useControlSource()
  const mutation = useControlMutation()
  const queryClient = useQueryClient()

  const [path, setPath] = useState('')
  const [editing, setEditing] = useState<{ path: string; content: string } | null>(null)
  const [saveConfirm, setSaveConfirm] = useState(false)

  // [内测 beta_file_root_ws] 分块读写：仅当 WS hello 报告 file_chunks 能力时提供 UI；
  // 能力未知（HTTP 回退）时显示"需要 WS"提示，已确认未开启时显示"上游未开启"提示。
  const serverId = useServersStore((s) => s.activeId)
  const upstream = useUpstreamStore((s) => (serverId ? s.byServer[serverId] : undefined))
  const chunksOn = betaKnown(upstream) && upstream.beta.includes('file_chunks')
  const chunksOff = betaKnown(upstream) && !upstream.beta.includes('file_chunks')

  // 分块操作状态 + 取消标志
  const [chunkOp, setChunkOp] = useState<{ kind: 'read' | 'write'; done: number; total: number } | null>(null)
  const [chunkMsg, setChunkMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const cancelRef = useRef(false)

  const canRun = !!control
  const busy = mutation.isPending || chunkOp !== null

  // 目录列表
  const listQuery = useQuery({
    queryKey: ['control', server?.id, 'files', 'list', path],
    enabled: canRun,
    queryFn: makeControlQueryFn<FileListResult>(control!, '/control/files/list', { path }),
  })

  // 编辑中的文件内容
  const readQuery = useQuery({
    queryKey: ['control', server?.id, 'files', 'read', editing?.path ?? ''],
    enabled: canRun && editing !== null,
    queryFn: makeControlQueryFn<FileReadResult>(control!, '/control/files/read', {
      path: editing?.path ?? '',
    }),
  })

  // 载入成功后把内容同步进 editing —— 之后输入以 editing.content 为准
  // （受控组件若一直读 readQuery.data.content，用户输入会被每次渲染打回原形）
  useEffect(() => {
    if (readQuery.data) {
      setEditing((ed) => (ed ? { ...ed, content: readQuery.data!.content } : ed))
    }
  }, [readQuery.data])

  const entries = listQuery.data?.entries ?? []

  async function refreshList() {
    await queryClient.invalidateQueries({ queryKey: ['control', server?.id, 'files', 'list', path] })
  }

  function openDir(name: string) {
    setEditing(null)
    setPath((p) => joinPath(p, name))
  }

  function openFile(name: string) {
    setEditing({ path: joinPath(path, name), content: '' })
  }

  function doSave() {
    setSaveConfirm(false)
    if (!editing) return
    // mutate（非 mutateAsync）：失败时错误落到 mutation.error，由下方错误框展示
    mutation.mutate(
      {
        path: '/control/files/write',
        body: { path: editing.path, content: editing.content },
      },
      {
        onSuccess: () => {
          setEditing(null)
          void refreshList()
        },
      },
    )
  }

  // ===== [内测] 分块读取（大文件/精确校验）：read_chunk 循环 + 整文件 sha256 校验 =====
  async function doChunkRead() {
    if (!control || !editing) return
    cancelRef.current = false
    setChunkMsg(null)
    setChunkOp({ kind: 'read', done: 0, total: 0 })
    try {
      const r = await chunkedRead(control, editing.path, {
        onProgress: (done, total) => setChunkOp({ kind: 'read', done, total }),
        shouldCancel: () => cancelRef.current,
      })
      setEditing((ed) => (ed ? { ...ed, content: r.text } : ed))
      setChunkMsg({ ok: true, text: `✓ ${t('files.chunkReadDone').replace('{size}', String(r.size))}${r.sha256 ? ` · sha256 ${r.sha256.slice(0, 12)}…` : ''}` })
    } catch (e) {
      setChunkMsg({
        ok: false,
        text: e instanceof ChunkCancelled
          ? `✗ ${t('files.chunkCancelled')}`
          : `✗ ${describeControlError(e, t)}`,
      })
    } finally {
      setChunkOp(null)
    }
  }

  // ===== [内测] 分块上传（write_chunk append/final + sha256 端到端校验） =====
  async function doChunkSave() {
    if (!control || !editing) return
    const totalBytes = new TextEncoder().encode(editing.content).length
    if (totalBytes > FILE_MAX_WRITE_BYTES) {
      setChunkMsg({ ok: false, text: `✗ ${t('files.chunkTooLarge').replace('{limit}', String(FILE_MAX_WRITE_BYTES))}` })
      return
    }
    cancelRef.current = false
    setChunkMsg(null)
    setChunkOp({ kind: 'write', done: 0, total: totalBytes })
    try {
      const r = await chunkedWrite(control, editing.path, editing.content, {
        onProgress: (done, total) => setChunkOp({ kind: 'write', done, total }),
        shouldCancel: () => cancelRef.current,
      })
      setChunkMsg({ ok: true, text: `✓ ${t('files.chunkWriteDone').replace('{bytes}', String(r.bytes))} · sha256 ${r.sha256.slice(0, 12)}…` })
      void refreshList()
    } catch (e) {
      setChunkMsg({
        ok: false,
        text: e instanceof ChunkCancelled
          ? `✗ ${t('files.chunkCancelled')}`
          : `✗ ${describeControlError(e, t)}`,
      })
    } finally {
      setChunkOp(null)
    }
  }

  // 本地内容指纹（写入前后一致性提示）
  const localSha = useMemo(() => {
    try { return sha256Hex(new TextEncoder().encode(editing?.content ?? '')) } catch { return null }
  }, [editing?.content])

  return (
    <PageStub code="M-12" title={t('nav.files')}>
      <div className="flex h-full flex-col space-y-3">
        <ControlNotice show={!tokenConfigured} />

        <div className="flex flex-wrap items-center gap-2 border border-ink-border bg-ink-deep px-3 py-2">
          <button
            onClick={() => { setEditing(null); setPath('') }}
            disabled={!canRun}
            className="font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:text-foreground disabled:opacity-40"
          >
            {t('files.root')}
          </button>
          {path.split('/').map((seg, i, arr) => {
            const segPath = arr.slice(0, i + 1).join('/')
            return (
              <span key={segPath} className="flex items-center gap-2 font-mono text-[11px]">
                <span className="text-ink-mute">/</span>
                <button
                  onClick={() => { setEditing(null); setPath(segPath) }}
                  disabled={!canRun}
                  className="text-ink-mute transition-colors hover:text-foreground disabled:opacity-40"
                >
                  {seg}
                </button>
              </span>
            )
          })}
          <div className="flex-1" />
          <button
            onClick={() => { setEditing(null); setPath((p) => parentPath(p)) }}
            disabled={!canRun || path === ''}
            className="flex items-center gap-1 border border-ink-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground disabled:opacity-40"
          >
            <ArrowUp size={11} /> {t('files.up')}
          </button>
          <button
            onClick={() => void refreshList()}
            disabled={!canRun || listQuery.isFetching}
            className="flex items-center gap-1 border border-ink-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground disabled:opacity-40"
          >
            <RefreshCw size={11} className={listQuery.isFetching ? 'animate-spin' : ''} />
            {t('files.refresh')}
          </button>
        </div>

        {listQuery.isError && (
          <div className="border-l-2 border-scp-err/60 bg-scp-err/5 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-scp-err">
            {listQuery.error instanceof Error ? listQuery.error.message : String(listQuery.error)}
          </div>
        )}

        {!editing && (
          <div className="flex min-h-0 flex-1 flex-col border border-ink-border bg-ink-deep">
            {listQuery.isLoading && (
              <div className="flex items-center gap-2 p-4 font-mono text-[11px] text-ink-mute">
                <Loader2 size={12} className="animate-spin" /> {t('common.loading')}
              </div>
            )}
            {!listQuery.isLoading && !listQuery.isError && entries.length === 0 && (
              <p className="p-4 font-mono text-[11px] text-ink-mute">{t('files.empty')}</p>
            )}

            {entries.length > 0 && (
              <div className="min-h-0 flex-1 overflow-auto">
                {entries.map((e) => (
                  <button
                    key={e.name}
                    onClick={() => {
                      // 顶级防线：受保护条目（SLDataAPI 自身配置目录）禁止打开
                      if (e.protected) return
                      if (e.type === 'dir') openDir(e.name)
                      else openFile(e.name)
                    }}
                    disabled={e.protected}
                    title={e.protected ? t('files.protected') : undefined}
                    className={`flex w-full items-center gap-2 border-b border-ink-border/60 px-3 py-2 text-left transition-colors ${
                      e.protected ? 'cursor-not-allowed bg-scp-warn/5 hover:bg-scp-warn/10' : 'hover:bg-ink'
                    }`}
                  >
                    {e.type === 'dir'
                      ? <Folder size={13} className={`shrink-0 ${e.protected ? 'text-scp-warn' : 'text-scp-warn'}`} />
                      : <File size={13} className={`shrink-0 ${e.protected ? 'text-scp-warn' : 'text-ink-mute'}`} />}
                    <span className={`min-w-0 flex-1 truncate font-mono text-[11px] ${e.protected ? 'text-scp-warn' : 'text-foreground'}`}>
                      {e.name}
                      {e.type === 'dir' ? '/' : ''}
                    </span>
                    {e.protected && (
                      <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-scp-warn">
                        {t('files.protected')}
                      </span>
                    )}
                    {e.type === 'file' && (
                      <span className="shrink-0 font-mono text-[10px] text-ink-mute">{fmtSize(e.size)}</span>
                    )}
                    <span className="shrink-0 font-mono text-[9px] text-ink-mute">{e.modified}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {editing && (
          <div className="flex min-h-0 flex-1 flex-col border border-ink-border bg-ink-deep">
            <div className="flex items-center justify-between border-b border-ink-border px-3 py-2">
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
                <File size={12} /> {t('files.editTitle')} — <span className="break-all text-foreground">{editing.path}</span>
              </span>
              <div className="flex items-center gap-1">
                {readQuery.isFetching && <Loader2 size={11} className="animate-spin text-ink-mute" />}
                <button
                  onClick={() => setEditing(null)}
                  disabled={busy}
                  className="flex items-center gap-1 border border-ink-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground disabled:opacity-40"
                >
                  <ArrowLeft size={11} /> {t('files.back')}
                </button>
                <button
                  onClick={() => setSaveConfirm(true)}
                  disabled={busy}
                  className="flex items-center gap-1 border border-inverse px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:bg-inverse hover:text-ink disabled:opacity-40"
                >
                  <Save size={11} /> {t('files.save')}
                </button>
                {/* [内测] 分块读写（beta_file_root_ws）：仅在 hello 报告能力时提供 */}
                {chunksOn && (
                  <>
                    <button
                      onClick={() => void doChunkRead()}
                      disabled={busy || !editing}
                      title={t('files.chunkRead')}
                      className="flex items-center gap-1 border border-ink-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground disabled:opacity-40"
                    >
                      <Download size={11} /> {t('files.chunkRead')}
                    </button>
                    <button
                      onClick={() => void doChunkSave()}
                      disabled={busy || !editing}
                      title={t('files.chunkWrite')}
                      className="flex items-center gap-1 border border-ink-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute transition-colors hover:border-inverse hover:text-foreground disabled:opacity-40"
                    >
                      <Upload size={11} /> {t('files.chunkWrite')}
                    </button>
                  </>
                )}
              </div>
            </div>

            {chunksOn && chunkOp && (
              <div className="flex items-center gap-2 border-b border-ink-border bg-ink px-3 py-1.5 font-mono text-[10px] text-ink-mute">
                <Loader2 size={11} className="animate-spin" />
                <span>{chunkOp.kind === 'read' ? t('files.chunkReading') : t('files.chunkWriting')}</span>
                <div className="h-[3px] min-w-0 flex-1 bg-ink-deep">
                  <div
                    className="h-[3px] bg-scp-safe"
                    style={{ width: chunkOp.total > 0 ? `${Math.min(100, (chunkOp.done / chunkOp.total) * 100)}%` : '0%' }}
                  />
                </div>
                <span className="shrink-0">{chunkOp.done}/{chunkOp.total || '?'}</span>
                <button
                  onClick={() => { cancelRef.current = true }}
                  className="shrink-0 border border-ink-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-mute transition-colors hover:border-scp-err hover:text-scp-err"
                >
                  {t('files.chunkCancel')}
                </button>
              </div>
            )}
            {chunksOn && chunkMsg && (
              <div className={`border-b px-3 py-1.5 font-mono text-[10px] ${chunkMsg.ok ? 'border-b-scp-safe/40 bg-scp-safe/10 text-scp-safe' : 'border-b-scp-err/40 bg-scp-err/10 text-scp-err'}`}>
                {chunkMsg.text}
              </div>
            )}
            {!chunksOn && !chunksOff && editing && (
              <div className="border-b border-ink-border bg-ink px-3 py-1.5 font-mono text-[9px] text-ink-mute">
                {t('files.chunksNeedWs')}
              </div>
            )}
            {chunksOff && editing && (
              <div className="border-b border-ink-border bg-ink px-3 py-1.5 font-mono text-[9px] text-scp-warn">
                {t('files.chunksBetaOff')}
              </div>
            )}

            {readQuery.isError && (
              <div className="m-3 border-l-2 border-scp-err/60 bg-scp-err/5 px-2 py-1.5 font-mono text-[10px] text-scp-err">
                {readQuery.error instanceof Error ? readQuery.error.message : String(readQuery.error)}
              </div>
            )}
            <textarea
              value={editing.content}
              onChange={(e) => setEditing((ed) => (ed ? { ...ed, content: e.target.value } : ed))}
              disabled={readQuery.isLoading || busy}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none bg-ink p-3 font-mono text-[11px] leading-relaxed text-foreground focus:outline-none disabled:opacity-60"
              placeholder="…"
            />
            {mutation.isError && (
              <div className="m-3 border-l-2 border-scp-err/60 bg-scp-err/5 px-2 py-1.5 font-mono text-[10px] text-scp-err">
                {mutation.error instanceof Error ? mutation.error.message : String(mutation.error)}
              </div>
            )}
            <div className="border-t border-ink-border px-3 py-1.5 font-mono text-[9px] text-ink-mute">
              {readQuery.data ? `${readQuery.data.size} ${t('files.size').toLowerCase()}` : ' '}
              {chunksOn && localSha && (
                <span className="ml-3" title={localSha}>sha256 {localSha.slice(0, 12)}…</span>
              )}
            </div>
          </div>
        )}

        <ConfirmDialog
          open={saveConfirm}
          message={t('files.confirmSave').replace('{path}', editing?.path ?? '')}
          busy={busy}
          onCancel={() => setSaveConfirm(false)}
          onConfirm={doSave}
        />
      </div>
    </PageStub>
  )
}
