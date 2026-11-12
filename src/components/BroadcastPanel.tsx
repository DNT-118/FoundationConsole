import { useState } from 'react'
import { useControlMutation, useControlSource } from '@/hooks/useControl'
import { useI18nStore } from '@/i18n/store'
import ConfirmDialog from './ConfirmDialog'

export default function BroadcastPanel() {
  const zh = useI18nStore(s => s.lang) === 'zh-CN'
  const { control } = useControlSource()
  const mutation = useControlMutation()
  const [mode, setMode] = useState<'broadcast' | 'staffchat'>('broadcast')
  const [message, setMessage] = useState('')
  const [duration, setDuration] = useState(5)
  const [clear, setClear] = useState(false)
  const [silent, setSilent] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const valid = !!control && !!message.trim() && message.length <= 500 && Number.isInteger(duration) && duration >= 1 && duration <= 60
  function send() {
    if (!valid || mutation.isPending) return
    mutation.mutate({ path: `/control/${mode}`, body: mode === 'broadcast'
      ? { message: message.trim(), duration_seconds: duration, clear_previous: clear }
      : { message: message.trim(), is_silent: silent } }, { onSettled: () => setConfirm(false) })
  }
  return <section className="col-span-12 space-y-3 border border-ink-border bg-ink-deep p-4">
    <h2 className="text-sm font-semibold">{zh ? '广播与管理聊天' : 'Broadcast & staff chat'}</h2>
    <p className="text-xs text-ink-mute">{zh ? '广播发送给全体玩家；管理聊天仅向拥有 AdminChat 权限的管理员显示。duty Key 默认不开放这两项操作。' : 'Broadcasts reach all players. Staff chat is visible to admins with AdminChat permission. Both actions are disabled for duty keys by default.'}</p>
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <select aria-label={zh ? '消息范围' : 'Message audience'} disabled={mutation.isPending} value={mode} onChange={e => { setMode(e.target.value as typeof mode); mutation.reset() }} className="border border-ink-border bg-ink px-3 py-2">
        <option value="broadcast">{zh ? '全服广播' : 'Server broadcast'}</option><option value="staffchat">{zh ? '管理聊天' : 'Staff chat'}</option>
      </select>
      {mode === 'broadcast' ? <>
        <label className="flex items-center gap-2">{zh ? '时长（秒）' : 'Duration (s)'}<input type="number" min={1} max={60} value={duration} onChange={e => setDuration(Number(e.target.value))} className="w-20 border border-ink-border bg-ink px-2 py-2" /></label>
        <label><input type="checkbox" checked={clear} onChange={e => setClear(e.target.checked)} className="mr-2" />{zh ? '清除此前广播' : 'Clear previous broadcasts'}</label>
      </> : <label><input type="checkbox" checked={silent} onChange={e => setSilent(e.target.checked)} className="mr-2" />{zh ? '静默发送（无屏幕提示）' : 'Silent (no screen notification)'}</label>}
    </div>
    <textarea aria-label={zh ? '消息内容' : 'Message text'} maxLength={500} rows={3} disabled={mutation.isPending || !control} value={message} onChange={e => { setMessage(e.target.value); mutation.reset() }} placeholder={zh ? '输入消息内容，最多 500 字符' : 'Message, up to 500 characters'} className="w-full resize-y border border-ink-border bg-ink p-3 text-sm disabled:opacity-40" />
    <div className="flex items-center justify-between text-sm"><span className="text-ink-mute">{message.length} / 500</span><button disabled={!valid || mutation.isPending} onClick={() => setConfirm(true)} className="border border-ink-border px-4 py-2 disabled:opacity-40">{zh ? '发送消息' : 'Send message'}</button></div>
    {mutation.isSuccess && <p role="status" className="text-sm text-scp-safe">{mutation.data.message || (zh ? '消息已发送' : 'Message sent')}</p>}
    {mutation.isError && <p role="alert" className="text-sm text-scp-err">{mutation.error.message}</p>}
    <ConfirmDialog open={confirm} busy={mutation.isPending} message={`${zh ? '确认发送至' : 'Send to'} ${mode === 'broadcast' ? (zh ? '全体玩家' : 'all players') : (zh ? '管理聊天' : 'staff chat')}：${message}`} onConfirm={send} onCancel={() => setConfirm(false)} />
  </section>
}
