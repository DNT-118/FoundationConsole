import BroadcastPanel from '@/components/BroadcastPanel'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import PageStub from '@/components/PageStub'
import ControlNotice from '@/components/ControlNotice'
import ConfirmDialog from '@/components/ConfirmDialog'
import { nukeText, phaseText } from '@/utils/serverDisplay'
import { describeControlError, fill, holidayLabel } from '@/utils/controlHint'
import { useT } from '@/i18n'
import { useControlMutation, useControlSource, makeControlQueryFn, type ControlCall } from '@/hooks/useControl'
import { useServerQuery } from '@/hooks/useServerQuery'
import type {
  DummiesListResult,
  SlPlayerStatus,
  WaveStatusResult,
} from '@/types/api'

interface PendingConfirm {
  message: string
  /** 执行成功后的绿框提示（与确认弹窗文案分离）。 */
  okText: string
  call: ControlCall
}

function fmtDur(s: number): string {
  if (!s || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

/** EXILED EffectType 常用列表：[枚举名, 中文名]。 */
const EFFECTS: [string, string][] = [
  ['Invigorated', '活力'], ['Flashed', '闪光'], ['Bleeding', '流血'], ['Poisoned', '中毒'],
  ['Hemorrhage', '大出血'], ['Burned', '灼烧'], ['Corroding', '腐蚀'], ['Hypothermia', '低温'],
  ['Deafened', '失聪'], ['Concussed', '脑震荡'], ['Exhausted', '疲惫'], ['Ensnared', '缠绕'],
  ['SinkHole', '沉洞'], ['Amnesia', '失忆'], ['Asphyxiated', '窒息'], ['MovementBoost', '移动加速'],
  ['StaminaBoost', '耐力'], ['Scp207', 'SCP-207'], ['AntiScp207', '抗207'], ['Scp1853', 'SCP-1853'],
  ['Traumatized', '创伤'], ['Vitality', '活力'], ['Invisible', '隐形'], ['SpawnProtected', '出生保护'],
  ['Jailbird', '牢笼鸟'], ['SeveredHands', '断手'], ['Stained', '染色'], ['VisualsBlur', '视觉模糊'],
  ['Zombified', '僵尸化'], ['Ghostly', '幽灵'], ['Paralyzed', '瘫痪'], ['CardiacArrest', '心脏骤停'],
  ['SoundInjection', '声音注入'], ['DamageReduction', '减伤'], ['BodyshotReduction', '躯干减伤'],
  ['Disabled', '禁用'], ['StatBypass', '属性绕过'], ['TemperatureChange', '温度变化'],
  ['InvertedControl', '反向控制'], ['Shove', '推挤'], ['ForcedCrossHair', '强制准星'],
]

export default function RemoteAdmin() {
  const t = useT()
  const { server, control, tokenConfigured } = useControlSource()
  const mutation = useControlMutation()
  const queryClient = useQueryClient()
  const { data: serverData } = useServerQuery()

  const onlinePlayers = serverData?.players ?? []
  const [target, setTarget] = useState('')
  const [reason, setReason] = useState('')
  const [banDur, setBanDur] = useState(60)
  const [role, setRole] = useState('')
  const [pos, setPos] = useState({ x: '0', y: '1000', z: '0' })
  const [msgText, setMsgText] = useState('')
  const [msgType, setMsgType] = useState<'hint' | 'broadcast'>('hint')
  const [msgDur, setMsgDur] = useState(5)
  const [cassieText, setCassieText] = useState('')
  const [cassieSub, setCassieSub] = useState(false)
  const [cassieTrans, setCassieTrans] = useState('')
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [slpVolume, setSlpVolume] = useState('')
  const [slpFetchUrl, setSlpFetchUrl] = useState('')
  const [effect, setEffect] = useState('Invigorated')
  const [effectDur, setEffectDur] = useState(10)
  const [stateVals, setStateVals] = useState({ godmode: false, bypass: false, intercom: false })
  const [health, setHealth] = useState('')
  // 重生波次（/control/round/wave）
  const [waveFaction, setWaveFaction] = useState<'mtf' | 'chaos'>('mtf')
  const [waveSeconds, setWaveSeconds] = useState('30')
  const [waveTokens, setWaveTokens] = useState('')
  // 假人（/control/dummies）
  const [dummyNickname, setDummyNickname] = useState('')
  const [dummyRole, setDummyRole] = useState('')
  // 物品栏 / 糖果
  const [itemName, setItemName] = useState('Medkit')
  const [itemAmount, setItemAmount] = useState(1)
  const [clearAmmo, setClearAmmo] = useState(false)
  const [candyName, setCandyName] = useState('random')
  const [candyAmount, setCandyAmount] = useState(1)

  const canRun = !!control
  const busy = mutation.isPending
  const targetName = target.trim() || '(未指定)'

  // SLPlayer 播放状态（5s 轮询，驱动进度条）
  const slpQuery = useQuery({
    queryKey: ['control', server?.id, 'slplayer', 'status'],
    enabled: canRun,
    refetchInterval: 5000,
    queryFn: makeControlQueryFn<SlPlayerStatus>(control!, '/control/plugins/slplayer', { action: 'status' }),
  })
  const slp = Array.isArray(slpQuery.data?.playlist) ? slpQuery.data : undefined

  // 假人列表（10s 轮询；action=list 为只读）
  const dummiesQuery = useQuery({
    queryKey: ['control', server?.id, 'dummies'],
    enabled: canRun,
    refetchInterval: 10000,
    queryFn: makeControlQueryFn<DummiesListResult>(control!, '/control/dummies', { action: 'list' }),
  })
  const dummies = dummiesQuery.data

  // 重生波次状态（切换阵营时重新查询）
  const waveQuery = useQuery({
    queryKey: ['control', server?.id, 'wave', waveFaction],
    enabled: canRun,
    queryFn: makeControlQueryFn<WaveStatusResult>(control!, '/control/round/wave', { action: 'status', faction: waveFaction }),
  })
  const wave = waveQuery.data

  function exec(call: ControlCall, okText: string) {
    setConfirm(null)
    setResult(null)
    void mutation.mutateAsync(call)
      .then(() => {
        setResult({ ok: true, text: okText })
        return queryClient.invalidateQueries({ queryKey: ['control', server?.id] })
      })
      .catch((e: unknown) => {
        setResult({ ok: false, text: describeControlError(e, t) })
      })
  }

  function needTarget(call: ControlCall, message: string, okText?: string) {
    if (!target.trim()) {
      setResult({ ok: false, text: '// target required' })
      return
    }
    setConfirm({ message, okText: okText ?? message, call })
  }

  function slpAction(body: unknown, okText: string) {
    setResult(null)
    void mutation.mutateAsync({ path: '/control/plugins/slplayer', body })
      .then(() => {
        setResult({ ok: true, text: okText })
        return queryClient.invalidateQueries({ queryKey: ['control', server?.id, 'slplayer'] })
      })
      .catch((e: unknown) => {
        setResult({ ok: false, text: describeControlError(e, t) })
      })
  }

  return (
    <PageStub code="M-06" title={t('nav.remoteadmin')}>
      <div className="flex h-full flex-col space-y-3">
        <ControlNotice show={!tokenConfigured} />

        {result && (
          <div
            className={`border px-3 py-2 font-mono text-[11px] ${
              result.ok
                ? 'border-scp-safe/40 bg-scp-safe/10 text-scp-safe'
                : 'border-scp-err/40 bg-scp-err/10 text-scp-err'
            }`}
          >
            {result.ok ? '✓ ' : '✗ '}{result.text}
          </div>
        )}

        <div className="grid grid-cols-12 gap-3">
          <BroadcastPanel />
          {/* ================= 玩家操作 ================= */}
          <section className="col-span-12 xl:col-span-7 border border-ink-border bg-ink-deep p-4">
            <CardLabel icon="◎">{t('ra.playerOps')}</CardLabel>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={!canRun}
                className="border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse disabled:opacity-40"
              >
                <option value="">{t('ra.selectPlayer')}</option>
                {onlinePlayers.map((p) => (
                  <option key={p.nickname} value={p.nickname}>
                    {p.nickname} — {p.role}
                  </option>
                ))}
              </select>
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={!canRun}
                placeholder={t('ra.target')}
                className="w-56 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
              />
              <span className="font-mono text-[9px] text-ink-mute">// {t('ra.targetHint')}</span>
            </div>

            {/* kick / ban */}
            <div className="mt-4 grid grid-cols-12 gap-2">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={!canRun}
                placeholder={t('ra.reason')}
                className="col-span-12 sm:col-span-5 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
              />
              <input
                type="number"
                min={0}
                value={banDur}
                onChange={(e) => setBanDur(Number(e.target.value))}
                disabled={!canRun}
                placeholder={t('ra.banDuration')}
                className="col-span-6 sm:col-span-3 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
              />
              <div className="col-span-6 sm:col-span-2 flex gap-2">
                <ActionBtn
                  danger
                  disabled={!canRun || busy}
                  onClick={() => needTarget(
                    { path: '/control/moderation/kick', body: { target: target.trim(), reason: reason.trim() } },
                    t('ra.confirmKick').replace('{name}', targetName),
                    t('ra.doneKick').replace('{name}', targetName),
                  )}
                >
                  {t('ra.kick')}
                </ActionBtn>
                <ActionBtn
                  danger
                  disabled={!canRun || busy}
                  onClick={() => needTarget(
                    { path: '/control/moderation/ban', body: { target: target.trim(), reason: reason.trim(), duration: banDur } },
                    t('ra.confirmBan').replace('{name}', targetName).replace('{duration}', String(banDur)),
                    t('ra.doneBan').replace('{name}', targetName).replace('{duration}', String(banDur)),
                  )}
                >
                  {t('ra.ban')}
                </ActionBtn>
              </div>
            </div>

            {/* role / teleport */}
            <div className="mt-2 grid grid-cols-12 gap-2">
              <input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={!canRun}
                placeholder={t('ra.rolePlaceholder')}
                className="col-span-12 sm:col-span-4 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
              />
              <div className="col-span-6 sm:col-span-2">
                <ActionBtn
                  danger
                  disabled={!canRun || busy || !role.trim()}
                  onClick={() => needTarget(
                    { path: '/control/player/role', body: { target: target.trim(), role: role.trim() } },
                    t('ra.confirmRole').replace('{name}', targetName).replace('{role}', role.trim()),
                    t('ra.doneRole').replace('{name}', targetName).replace('{role}', role.trim()),
                  )}
                >
                  {t('ra.role')}
                </ActionBtn>
              </div>
              <div className="col-span-12 sm:col-span-4 flex items-center gap-1.5">
                {(['x', 'y', 'z'] as const).map((axis) => (
                  <input
                    key={axis}
                    value={pos[axis]}
                    onChange={(e) => setPos((p) => ({ ...p, [axis]: e.target.value }))}
                    disabled={!canRun}
                    placeholder={axis.toUpperCase()}
                    className="w-full border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
                  />
                ))}
              </div>
              <div className="col-span-6 sm:col-span-2">
                <ActionBtn
                  danger
                  disabled={!canRun || busy}
                  onClick={() => needTarget(
                    {
                      path: '/control/admin/teleport',
                      body: { target: target.trim(), x: Number(pos.x), y: Number(pos.y), z: Number(pos.z) },
                    },
                    t('ra.confirmTeleport')
                      .replace('{name}', targetName)
                      .replace('{x}', pos.x).replace('{y}', pos.y).replace('{z}', pos.z),
                    t('ra.doneTeleport')
                      .replace('{name}', targetName)
                      .replace('{x}', pos.x).replace('{y}', pos.y).replace('{z}', pos.z),
                  )}
                >
                  {t('ra.teleport')}
                </ActionBtn>
              </div>
            </div>

            {/* mute / msg */}
            <div className="mt-2 grid grid-cols-12 gap-2">
              <div className="col-span-6 sm:col-span-2 flex gap-2">
                <ActionBtn
                  danger
                  disabled={!canRun || busy}
                  onClick={() => needTarget(
                    { path: '/control/moderation/mute', body: { target: target.trim(), mute: true } },
                    t('ra.confirmMute').replace('{name}', targetName),
                    t('ra.doneMute').replace('{name}', targetName),
                  )}
                >
                  {t('ra.mute')}
                </ActionBtn>
                <ActionBtn
                  disabled={!canRun || busy}
                  onClick={() => needTarget(
                    { path: '/control/moderation/mute', body: { target: target.trim(), mute: false } },
                    t('ra.confirmUnmute').replace('{name}', targetName),
                    t('ra.doneUnmute').replace('{name}', targetName),
                  )}
                >
                  {t('ra.unmute')}
                </ActionBtn>
              </div>
              <select
                value={msgType}
                onChange={(e) => setMsgType(e.target.value as 'hint' | 'broadcast')}
                disabled={!canRun}
                className="col-span-6 sm:col-span-2 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse disabled:opacity-40"
              >
                <option value="hint">{t('ra.msgHint')}</option>
                <option value="broadcast">{t('ra.msgBroadcast')}</option>
              </select>
              <input
                value={msgDur}
                onChange={(e) => setMsgDur(Number(e.target.value))}
                disabled={!canRun}
                placeholder={t('ra.msgDuration')}
                className="col-span-6 sm:col-span-2 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
              />
              <input
                value={msgText}
                onChange={(e) => setMsgText(e.target.value)}
                disabled={!canRun}
                placeholder={t('ra.msg')}
                className="col-span-12 sm:col-span-5 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
              />
              <div className="col-span-6 sm:col-span-1">
                <ActionBtn
                  disabled={!canRun || busy || !msgText.trim()}
                  onClick={() => needTarget(
                    {
                      path: '/control/moderation/msg',
                      body: { target: target.trim(), message: msgText.trim(), msg_type: msgType, duration_seconds: msgDur },
                    },
                    `→ ${targetName}`,
                  )}
                >
                  {t('ra.msg')}
                </ActionBtn>
              </div>
            </div>

            {/* effect 效果 */}
            <div className="mt-2 grid grid-cols-12 items-center gap-2">
              <span className="col-span-12 sm:col-span-2 font-mono text-[9px] uppercase tracking-wider text-ink-mute">
                {t('ra.effect')}
              </span>
              <select
                value={effect}
                onChange={(e) => setEffect(e.target.value)}
                disabled={!canRun}
                className="col-span-8 sm:col-span-4 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse disabled:opacity-40"
              >
                {EFFECTS.map(([name, label]) => (
                  <option key={name} value={name}>{name} · {label}</option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={effectDur}
                onChange={(e) => setEffectDur(Number(e.target.value))}
                disabled={!canRun}
                placeholder="sec"
                className="col-span-4 sm:col-span-2 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
              />
              <div className="col-span-8 sm:col-span-4">
                <ActionBtn
                  disabled={!canRun || busy}
                  onClick={() => needTarget(
                    { path: '/control/player/effects', body: { target: target.trim(), effect, effect_duration: effectDur } },
                    `${effect} → ${targetName}`,
                  )}
                >
                  {t('ra.effectApply')}
                </ActionBtn>
              </div>
            </div>

            {/* state 玩家状态 */}
            <div className="mt-2 grid grid-cols-12 items-center gap-2">
              <span className="col-span-12 sm:col-span-2 font-mono text-[9px] uppercase tracking-wider text-ink-mute">
                {t('ra.state')}
              </span>
              {([['godmode', t('ra.godmode')], ['bypass', t('ra.bypass')], ['intercom', t('ra.intercom')]] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setStateVals((s) => ({ ...s, [key]: !s[key] }))}
                  disabled={!canRun}
                  className={`col-span-4 sm:col-span-2 border px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors disabled:opacity-40 ${
                    stateVals[key]
                      ? 'border-inverse bg-inverse text-ink'
                      : 'border-ink-border text-ink-mute hover:border-inverse hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
              <input
                type="number"
                min={0}
                value={health}
                onChange={(e) => setHealth(e.target.value)}
                disabled={!canRun}
                placeholder={t('ra.health')}
                className="col-span-4 sm:col-span-2 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
              />
              <div className="col-span-8 sm:col-span-2">
                <ActionBtn
                  disabled={!canRun || busy}
                  onClick={() => needTarget(
                    {
                      path: '/control/admin/state',
                      body: {
                        target: target.trim(),
                        godmode: stateVals.godmode,
                        bypass: stateVals.bypass,
                        intercom: stateVals.intercom,
                        health: health.trim() === '' ? undefined : Number(health),
                      },
                    },
                    `state → ${targetName}`,
                  )}
                >
                  {t('ra.stateApply')}
                </ActionBtn>
              </div>
            </div>

            {/* 物品栏（/control/player/inventory） */}
            <div className="mt-4 border-t border-ink-border pt-3">
              <span className="font-mono text-[9px] uppercase tracking-wider text-ink-mute">
                {t('ra.inventory')}
              </span>
              <div className="mt-2 grid grid-cols-12 items-center gap-2">
                <input
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  disabled={!canRun}
                  placeholder={t('ra.inventoryItem')}
                  className="col-span-12 sm:col-span-5 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
                />
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={itemAmount}
                  onChange={(e) => setItemAmount(Number(e.target.value))}
                  disabled={!canRun}
                  title={t('ra.inventoryAmount')}
                  className="col-span-4 sm:col-span-2 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse disabled:opacity-40"
                />
                <div className="col-span-8 sm:col-span-5 flex flex-wrap gap-2">
                  <ActionBtn
                    disabled={!canRun || busy || !itemName.trim()}
                    onClick={() => needTarget(
                      { path: '/control/player/inventory', body: { target: target.trim(), action: 'add', item: itemName.trim(), amount: itemAmount } },
                      `${itemName.trim()} ×${itemAmount} → ${targetName}`,
                    )}
                  >
                    {t('ra.inventoryAdd')}
                  </ActionBtn>
                  <ActionBtn
                    disabled={!canRun || busy || !itemName.trim()}
                    onClick={() => needTarget(
                      { path: '/control/player/inventory', body: { target: target.trim(), action: 'remove', item: itemName.trim(), amount: itemAmount } },
                      `- ${itemName.trim()} ×${itemAmount} · ${targetName}`,
                    )}
                  >
                    {t('ra.inventoryRemove')}
                  </ActionBtn>
                  <ActionBtn
                    danger
                    disabled={!canRun || busy}
                    onClick={() => needTarget(
                      { path: '/control/player/inventory', body: { target: target.trim(), action: 'clear', clear_ammo: clearAmmo } },
                      `clear → ${targetName}`,
                    )}
                  >
                    {t('ra.inventoryClear')}
                  </ActionBtn>
                  <label className="flex items-center gap-1.5 font-mono text-[10px] text-ink-mute">
                    <input
                      type="checkbox"
                      checked={clearAmmo}
                      onChange={(e) => setClearAmmo(e.target.checked)}
                      disabled={!canRun}
                      className="accent-foreground"
                    />
                    {t('ra.inventoryClearAmmo')}
                  </label>
                </div>
              </div>

              {/* SCP-330 糖果（节日门控：409 holiday_inactive 时显示友好提示） */}
              <div className="mt-2 grid grid-cols-12 items-center gap-2">
                <span className="col-span-12 sm:col-span-2 font-mono text-[9px] uppercase tracking-wider text-ink-mute">
                  {t('ra.candy')}
                </span>
                <input
                  value={candyName}
                  onChange={(e) => setCandyName(e.target.value)}
                  disabled={!canRun}
                  placeholder={t('ra.candyName')}
                  className="col-span-8 sm:col-span-4 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
                />
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={candyAmount}
                  onChange={(e) => setCandyAmount(Number(e.target.value))}
                  disabled={!canRun}
                  title={t('ra.inventoryAmount')}
                  className="col-span-4 sm:col-span-2 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground focus:outline-none focus:border-inverse disabled:opacity-40"
                />
                <div className="col-span-8 sm:col-span-2">
                  <ActionBtn
                    disabled={!canRun || busy}
                    onClick={() => needTarget(
                      { path: '/control/player/candy', body: { target: target.trim(), candy: candyName.trim() || 'random', amount: candyAmount } },
                      `candy ×${candyAmount} → ${targetName}`,
                    )}
                  >
                    {t('ra.candyGive')}
                  </ActionBtn>
                </div>
                <p className="col-span-12 font-mono text-[9px] leading-relaxed text-ink-mute">
                  {fill(t('ra.holidayHint'), { holiday: holidayLabel(serverData?.activeHoliday ?? '', t) })}
                </p>
              </div>
            </div>
          </section>

          {/* ================= 服务器控制 ================= */}
          <section className="col-span-12 xl:col-span-5 space-y-3">
            {/* 回合 / 核弹 */}
            <div className="border border-ink-border bg-ink-deep p-4">
              <CardLabel icon="◈">{t('ra.serverOps')}</CardLabel>

              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-16 font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                    {t('ra.round')}
                  </span>
                  <ActionBtn
                    danger
                    disabled={!canRun || busy}
                    onClick={() => setConfirm({
                      message: t('ra.confirmRoundRestart'),
                      okText: t('ra.roundRestarted'),
                      call: { path: '/control/round', body: { action: 'restart' } },
                    })}
                  >
                    {t('ra.roundRestart')}
                  </ActionBtn>
                  <ActionBtn
                    danger
                    disabled={!canRun || busy}
                    onClick={() => setConfirm({
                      message: t('ra.confirmRoundEnd'),
                      okText: t('ra.roundEnded'),
                      call: { path: '/control/round', body: { action: 'end' } },
                    })}
                  >
                    {t('ra.roundEnd')}
                  </ActionBtn>
                  <ActionBtn
                    disabled={!canRun || busy}
                    onClick={() => exec(
                      { path: '/control/round', body: { action: 'start' } },
                      'round start',
                    )}
                  >
                    {t('ra.roundStart')}
                  </ActionBtn>
                </div>

                <div className="flex items-center gap-2">
                  <span className="w-16 font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                    {t('ra.warhead')}
                  </span>
                  <ActionBtn
                    danger
                    disabled={!canRun || busy}
                    onClick={() => setConfirm({
                      message: t('ra.confirmWarheadStart'),
                      okText: t('ra.doneWarheadStart'),
                      call: { path: '/control/round/warhead', body: { action: 'start' } },
                    })}
                  >
                    {t('ra.warheadStart')}
                  </ActionBtn>
                  <ActionBtn
                    danger
                    disabled={!canRun || busy}
                    onClick={() => setConfirm({
                      message: t('ra.confirmWarheadStop'),
                      okText: t('ra.doneWarheadStop'),
                      call: { path: '/control/round/warhead', body: { action: 'stop' } },
                    })}
                  >
                    {t('ra.warheadStop')}
                  </ActionBtn>
                  <ActionBtn
                    danger
                    disabled={!canRun || busy}
                    onClick={() => setConfirm({
                      message: t('ra.confirmWarheadDetonate'),
                      okText: t('ra.doneWarheadDetonate'),
                      call: { path: '/control/round/warhead', body: { action: 'detonate' } },
                    })}
                  >
                    {t('ra.warheadDetonate')}
                  </ActionBtn>
                </div>

                {/* 重生波次（/control/round/wave）：状态查询 + 立即重生 + 倒计时设置 */}
                <div className="flex items-center gap-2 border-t border-ink-border pt-2">
                  <span className="w-16 font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                    {t('ra.wave')}
                  </span>
                  <select
                    value={waveFaction}
                    onChange={(e) => setWaveFaction(e.target.value as 'mtf' | 'chaos')}
                    disabled={!canRun}
                    className="border border-ink-border bg-ink px-2 py-1.5 font-mono text-[10px] text-foreground focus:outline-none focus:border-inverse disabled:opacity-40"
                  >
                    <option value="mtf">{t('ra.waveMtf')}</option>
                    <option value="chaos">{t('ra.waveChaos')}</option>
                  </select>
                  {waveQuery.isFetching ? (
                    <Loader2 size={11} className="animate-spin text-ink-mute" />
                  ) : wave ? (
                    <span className="font-mono text-[10px] text-foreground">
                      {t('ra.waveTimeLeft')} {Math.max(0, Math.round(wave.time_left))}s
                      {typeof wave.tokens === 'number' && wave.tokens >= 0 ? ` · ${t('ra.waveTokensLabel')} ${wave.tokens}` : ''}
                    </span>
                  ) : waveQuery.isError ? (
                    <span className="font-mono text-[10px] text-ink-mute">{t('ra.waveNone')}</span>
                  ) : null}
                  <ActionBtn
                    danger
                    disabled={!canRun || busy}
                    onClick={() => exec(
                      { path: '/control/round/wave', body: { action: 'instant', faction: waveFaction } },
                      t('ra.doneWaveInstant'),
                    )}
                  >
                    {t('ra.waveInstant')}
                  </ActionBtn>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0" />
                  <input
                    type="number"
                    min={0}
                    value={waveSeconds}
                    onChange={(e) => setWaveSeconds(e.target.value)}
                    disabled={!canRun}
                    title={t('ra.waveSeconds')}
                    className="w-20 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[10px] text-foreground focus:outline-none focus:border-inverse disabled:opacity-40"
                  />
                  <input
                    type="number"
                    min={0}
                    value={waveTokens}
                    onChange={(e) => setWaveTokens(e.target.value)}
                    disabled={!canRun}
                    title={t('ra.waveTokens')}
                    placeholder={t('ra.waveTokens')}
                    className="w-20 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[10px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
                  />
                  <ActionBtn
                    disabled={!canRun || busy}
                    onClick={() => exec(
                      {
                        path: '/control/round/wave',
                        body: {
                          action: 'set',
                          faction: waveFaction,
                          seconds: Math.max(0, Number(waveSeconds) || 0),
                          ...(waveTokens.trim() !== '' ? { tokens: Math.max(0, Number(waveTokens) || 0) } : {}),
                        },
                      },
                      t('ra.doneWaveSet'),
                    )}
                  >
                    {t('ra.waveSet')}
                  </ActionBtn>
                  <ActionBtn
                    disabled={!canRun}
                    onClick={() => void queryClient.invalidateQueries({ queryKey: ['control', server?.id, 'wave', waveFaction] })}
                  >
                    {t('ra.waveStatus')}
                  </ActionBtn>
                </div>
              </div>
            </div>

            {/* 假人管理（/control/dummies，上限 5） */}
            <div className="border border-ink-border bg-ink-deep p-4">
              <div className="flex items-center justify-between">
                <CardLabel icon="◍">{t('ra.dummies')}</CardLabel>
                <span className="font-mono text-[10px] text-ink-mute">
                  {t('ra.dummyCount')
                    .replace('{count}', String(dummies?.count ?? 0))
                    .replace('{max}', String(dummies?.max ?? 5))}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={dummyNickname}
                  onChange={(e) => setDummyNickname(e.target.value)}
                  disabled={!canRun}
                  placeholder={t('ra.dummyNickname')}
                  className="w-32 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
                />
                <input
                  value={dummyRole}
                  onChange={(e) => setDummyRole(e.target.value)}
                  disabled={!canRun}
                  placeholder={t('ra.dummyRole')}
                  className="w-40 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
                />
                <ActionBtn
                  disabled={!canRun || busy}
                  onClick={() => exec(
                    {
                      path: '/control/dummies',
                      body: {
                        action: 'spawn',
                        nickname: dummyNickname.trim(),
                        ...(dummyRole.trim() ? { role: dummyRole.trim() } : {}),
                      },
                    },
                    t('ra.doneDummySpawn'),
                  )}
                >
                  {t('ra.dummySpawn')}
                </ActionBtn>
                <ActionBtn
                  danger
                  disabled={!canRun || busy}
                  onClick={() => setConfirm({
                    message: t('ra.confirmDummyRemoveAll'),
                    okText: t('ra.doneDummyRemoveAll'),
                    call: { path: '/control/dummies', body: { action: 'remove', target: 'all' } },
                  })}
                >
                  {t('ra.dummyRemoveAll')}
                </ActionBtn>
              </div>

              {dummiesQuery.isError && (
                <div className="mt-2 border-l-2 border-scp-err/60 bg-scp-err/5 px-2 py-1.5 font-mono text-[10px] text-scp-err">
                  {describeControlError(dummiesQuery.error, t)}
                </div>
              )}
              {dummies && dummies.dummies.length === 0 && (
                <p className="mt-2 font-mono text-[10px] text-ink-mute">{t('ra.dummyEmpty')}</p>
              )}
              {dummies && dummies.dummies.length > 0 && (
                <div className="mt-2 space-y-1">
                  {dummies.dummies.map((dm) => (
                    <div key={dm.player_id} className="flex items-center justify-between gap-2 border border-ink-border px-2 py-1.5">
                      <span className="min-w-0 truncate font-mono text-[11px] text-foreground">
                        {dm.nickname}
                        <span className="ml-2 text-[9px] text-ink-mute">
                          #{dm.player_id} · {dm.role}
                        </span>
                      </span>
                      <button
                        type="button"
                        disabled={!canRun || busy}
                        onClick={() => exec(
                          { path: '/control/dummies', body: { action: 'remove', target: String(dm.player_id) } },
                          t('ra.doneDummyRemove'),
                        )}
                        className="shrink-0 border border-ink-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-mute transition-colors hover:border-scp-err hover:text-scp-err disabled:opacity-40"
                      >
                        {t('ra.dummyRemove')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* CASSIE */}
            <div className="border border-ink-border bg-ink-deep p-4">
              <CardLabel icon="♪">{t('ra.cassie')}</CardLabel>
              <textarea
                value={cassieText}
                onChange={(e) => setCassieText(e.target.value)}
                disabled={!canRun}
                rows={3}
                placeholder={t('ra.cassieMessage')}
                className="mt-3 w-full resize-y border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
              />
              <div className="mt-2 flex items-center justify-between">
                <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                  <input
                    type="checkbox"
                    checked={cassieSub}
                    onChange={(e) => setCassieSub(e.target.checked)}
                    disabled={!canRun}
                    className="accent-foreground"
                  />
                  {t('ra.cassieSubtitle')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    value={cassieTrans}
                    onChange={(e) => setCassieTrans(e.target.value)}
                    disabled={!canRun}
                    placeholder={t('ra.cassieTranslation')}
                    className="flex-1 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
                  />
                  <ActionBtn
                    disabled={!canRun || busy || !cassieText.trim()}
                    onClick={() => exec(
                      {
                        path: '/control/cassie',
                        body: {
                          message: cassieText.trim(),
                          isHeld: false,
                          isNoisy: true,
                          isSubtitles: cassieSub,
                          // 字幕翻译：播报英文原文、字幕显示中文（游戏服需实现 MessageTranslated）
                          ...(cassieTrans.trim() ? { translation: cassieTrans.trim() } : {}),
                        },
                      },
                      'CASSIE',
                    )}
                  >
                    {t('ra.cassiePlay')}
                  </ActionBtn>
                </div>
              </div>
            </div>

            {/* 服务器状态速览 */}
            <div className="border border-ink-border bg-ink-deep p-4">
              <CardLabel icon="≡">{t('top.phase')}</CardLabel>
              <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[11px]">
                <div className="border border-ink-border px-2 py-1.5">
                  <span className="block text-[9px] uppercase tracking-wider text-ink-mute">{t('dash.players')}</span>
                  <span className="text-foreground">{serverData?.playersCount ?? '—'}/{serverData?.maxPlayers ?? '—'}</span>
                </div>
                <div className="border border-ink-border px-2 py-1.5">
                  <span className="block text-[9px] uppercase tracking-wider text-ink-mute">{t('dash.phase')}</span>
                  <span className="text-foreground">{phaseText(serverData, t)}</span>
                </div>
                <div className="border border-ink-border px-2 py-1.5">
                  <span className="block text-[9px] uppercase tracking-wider text-ink-mute">{t('dash.nuke')}</span>
                  <span className="text-foreground">{nukeText(serverData, t)}</span>
                </div>
              </div>
            </div>

            {/* SLPlayer 音乐控制 */}
            <div className="border border-ink-border bg-ink-deep p-4">
              <div className="flex items-center justify-between">
                <CardLabel icon="♪">{t('slp.title')}</CardLabel>
                {slpQuery.isFetching && <Loader2 size={11} className="animate-spin text-ink-mute" />}
              </div>

              {slpQuery.isError && (
                <div className="mt-3 border-l-2 border-scp-err/60 bg-scp-err/5 px-2 py-1.5 font-mono text-[10px] text-scp-err">
                  {slpQuery.error instanceof Error ? slpQuery.error.message : String(slpQuery.error)}
                </div>
              )}

              {slp && (
                <>
                  {/* 当前播放 + 进度 */}
                  <div className="mt-3 border border-ink-border px-2 py-1.5">
                    <p className="truncate font-mono text-[11px] text-foreground">
                      {slp.playing ? `▶ ${slp.song ?? '?'}` : `□ ${t('slp.notPlaying')}`}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-[2px] flex-1 bg-ink">
                        <div
                          className="h-[2px] bg-scp-safe"
                          style={{
                            width: slp.duration_seconds > 0
                              ? `${Math.min(100, (slp.elapsed_seconds / slp.duration_seconds) * 100)}%`
                              : '0%',
                          }}
                        />
                      </div>
                      <span className="shrink-0 font-mono text-[9px] text-ink-mute">
                        {fmtDur(slp.elapsed_seconds)} / {fmtDur(slp.duration_seconds)}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-[9px] text-ink-mute">
                      {t('slp.volume')} {slp.volume}% · {t('slp.mode')} {slp.shuffle ? t('slp.random') : t('slp.order')}
                      {' '}· {t('slp.source')} {slp.source === 'remote' ? `${t('slp.remote')}${slp.remote_url ? ` (${slp.remote_url})` : ''}` : t('slp.local')}
                    </p>
                  </div>

                  {/* 播放控制行 */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        if (!Number.isNaN(v) && e.target.value !== '') slpAction({ action: 'play', index: v }, `play #${v}`)
                      }}
                      disabled={!canRun || busy || slp.playlist.length === 0}
                      className="min-w-0 flex-1 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[10px] text-foreground focus:outline-none focus:border-inverse disabled:opacity-40"
                    >
                      <option value="">{t('slp.play')}…</option>
                      {slp.playlist.map((s) => (
                        <option key={s.index} value={s.index}>
                          {s.current ? '▶ ' : ''}[{s.index}] {s.display}
                        </option>
                      ))}
                    </select>
                    <ActionBtn disabled={!canRun || busy} onClick={() => slpAction({ action: 'next' }, 'next')}>
                      {t('slp.next')}
                    </ActionBtn>
                    <ActionBtn disabled={!canRun || busy} onClick={() => slpAction({ action: 'stop' }, 'stop')}>
                      {t('slp.stop')}
                    </ActionBtn>
                    <ActionBtn disabled={!canRun || busy} onClick={() => slpAction({ action: 'shuffle', shuffle: 'toggle' }, 'shuffle')}>
                      {t('slp.shuffle')}
                    </ActionBtn>
                  </div>

                  {/* 音量 + 重扫 */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={slpVolume}
                      onChange={(e) => setSlpVolume(e.target.value)}
                      disabled={!canRun || busy}
                      placeholder={`${slp.volume}%`}
                      className="w-16 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[10px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
                    />
                    <ActionBtn
                      disabled={!canRun || busy}
                      onClick={() => {
                        const v = Number(slpVolume)
                        if (!Number.isNaN(v) && v >= 0 && v <= 100) {
                          slpAction({ action: 'volume', volume: v }, `volume ${v}%`)
                        }
                      }}
                    >
                      {t('slp.volume')}
                    </ActionBtn>
                    <ActionBtn disabled={!canRun || busy} onClick={() => slpAction({ action: 'reload' }, 'reload')}>
                      {t('slp.reload')}
                    </ActionBtn>
                  </div>

                  {/* fetch 云端歌单 */}
                  <div className="mt-2 flex items-center gap-1.5">
                    <input
                      value={slpFetchUrl}
                      onChange={(e) => setSlpFetchUrl(e.target.value)}
                      disabled={!canRun || busy}
                      placeholder={t('slp.fetchUrl')}
                      className="min-w-0 flex-1 border border-ink-border bg-ink px-2 py-1.5 font-mono text-[10px] text-foreground placeholder:text-ink-mute focus:outline-none focus:border-inverse disabled:opacity-40"
                    />
                    <ActionBtn
                      disabled={!canRun || busy || !slpFetchUrl.trim()}
                      onClick={() => {
                        slpAction({ action: 'fetch', url: slpFetchUrl.trim() }, 'fetch')
                      }}
                    >
                      {t('slp.fetch')}
                    </ActionBtn>
                  </div>
                </>
              )}

              {!slpQuery.isError && !slp && slpQuery.isLoading && (
                <p className="mt-3 font-mono text-[10px] text-ink-mute">{t('common.loading')}</p>
              )}
              {!slpQuery.isError && !slp && !slpQuery.isLoading && (
                <p className="mt-3 font-mono text-[10px] text-ink-mute">{t('slp.notLoaded')}</p>
              )}
            </div>
          </section>
        </div>

        {busy && (
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-ink-mute">
            <Loader2 size={12} className="animate-spin" /> {t('common.sync')}
          </div>
        )}

        <ConfirmDialog
          open={confirm !== null}
          message={confirm?.message ?? ''}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => confirm && exec(confirm.call, confirm.okText)}
        />
      </div>
    </PageStub>
  )
}

function CardLabel({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
      <span className="text-scp-safe">{icon}</span> {children}
    </span>
  )
}

function ActionBtn({
  children, onClick, disabled, danger,
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors disabled:opacity-40 ${
        danger
          ? 'border-ink-border text-ink-mute hover:border-scp-err hover:text-scp-err'
          : 'border-ink-border text-ink-mute hover:border-inverse hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}
