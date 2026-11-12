/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
/**
 * 玩家档案面板（只读 /control/player/data）。
 * 只渲染上游真实返回的字段（缺省/读取失败为 null 的字段跳过）；
 * 未知的新字段按"键 = 原样 JSON"兜底展示，上游加字段时面板不会丢信息。
 * 错误统一走 describeControlError（409/501/426/403 等结构化错误码）。
 */
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, X } from 'lucide-react'
import { useT } from '@/i18n'
import { useI18nStore } from '@/i18n/store'
import { useControlSource, makeControlQueryFn } from '@/hooks/useControl'
import { describeControlError } from '@/utils/controlHint'
import type { PlayerProfileData } from '@/types/api'

/** 已知字段的展示标签（双语；未列出的上游新字段回退为字段名）。 */
const FIELD_LABELS: { key: string; label: { zh: string; en: string } }[] = [
  { key: 'nickname', label: { zh: '玩家', en: 'Player' } },
  { key: 'userid', label: { zh: 'UserId', en: 'UserId' } },
  { key: 'player_id', label: { zh: '数字 ID', en: 'Player ID' } },
  { key: 'role', label: { zh: '职业', en: 'Role' } },
  { key: 'room', label: { zh: '房间', en: 'Room' } },
  { key: 'zone', label: { zh: '区域', en: 'Zone' } },
  { key: 'group', label: { zh: '权限组', en: 'Group' } },
  { key: 'health', label: { zh: '生命值', en: 'Health' } },
  { key: 'max_health', label: { zh: '生命上限', en: 'Max health' } },
  { key: 'artificial_health', label: { zh: '人工生命 (AHP)', en: 'Artificial health' } },
  { key: 'max_artificial_health', label: { zh: 'AHP 上限', en: 'Max AHP' } },
  { key: 'hume_shield', label: { zh: '休谟护盾', en: 'Hume shield' } },
  { key: 'max_hume_shield', label: { zh: '护盾上限', en: 'Max hume shield' } },
  { key: 'stamina', label: { zh: '体力', en: 'Stamina' } },
  { key: 'position', label: { zh: '坐标', en: 'Position' } },
  { key: 'godmode', label: { zh: '无敌模式', en: 'Godmode' } },
  { key: 'noclip', label: { zh: '穿墙', en: 'Noclip' } },
  { key: 'bypass', label: { zh: '绕过权限', en: 'Bypass' } },
  { key: 'overwatch', label: { zh: '观战模式', en: 'Overwatch' } },
  { key: 'temporary_bypass', label: { zh: 'TemporaryBypass', en: 'TemporaryBypass' } },
  { key: 'effect_door_permissions', label: { zh: '效果开门权限', en: 'Effect door perms' } },
  { key: 'effects', label: { zh: '当前效果', en: 'Active effects' } },
  { key: 'items', label: { zh: '物品栏', en: 'Items' } },
  { key: 'ammo', label: { zh: '弹药', en: 'Ammo' } },
  { key: 'spectating', label: { zh: '正在观看', en: 'Spectating' } },
  { key: 'voice_channel', label: { zh: '语音频道', en: 'Voice channel' } },
  { key: 'is_speaking', label: { zh: '正在说话', en: 'Speaking' } },
  { key: 'is_muted', label: { zh: '语音禁言', en: 'Muted' } },
  { key: 'is_intercom_muted', label: { zh: '对讲机禁言', en: 'Intercom muted' } },
  { key: 'is_dummy', label: { zh: '假人', en: 'Dummy' } },
]

function fmtValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export default function PlayerProfile({ target, onClose }: { target: string; onClose: () => void }) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const label = (zh: string, en: string) => (lang === 'zh-CN' ? zh : en)
  const { server, control } = useControlSource()

  const query = useQuery({
    queryKey: ['control', server?.id, 'playerdata', target],
    enabled: !!control && !!target,
    queryFn: makeControlQueryFn<PlayerProfileData>(control!, '/control/player/data', { target }),
  })
  const data = query.data

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const rows: { label: string; value: string; title?: string }[] = []
  if (data && typeof data === 'object') {
    const record = data as unknown as Record<string, unknown>
    const known = new Set(FIELD_LABELS.map((f) => f.key))
    for (const f of FIELD_LABELS) {
      if (!(f.key in record)) continue
      const v = record[f.key]
      if (v === null || v === undefined) continue   // 只显示上游真实返回的字段
      rows.push({
        label: label(f.label.zh, f.label.en),
        value: fmtValue(v),
        title: typeof v === 'object' ? JSON.stringify(v) : undefined,
      })
    }
    // 上游新增的未知字段兜底展示（不丢信息）
    for (const key of Object.keys(record)) {
      if (known.has(key)) continue
      const v = record[key]
      if (v === null || v === undefined) continue
      rows.push({ label: key, value: fmtValue(v), title: typeof v === 'object' ? JSON.stringify(v) : undefined })
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('profile.title')}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex max-h-[80vh] w-full max-w-md flex-col border border-ink-border bg-ink-deep p-4">
        <div className="flex items-center justify-between gap-2 border-b border-ink-border pb-2">
          <span className="min-w-0 truncate font-mono text-[12px] text-foreground">
            {t('profile.title')} · {target}
          </span>
          <button
            onClick={onClose}
            aria-label={t('common.cancel')}
            className="shrink-0 font-mono text-ink-mute transition-colors hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto py-2">
          {query.isFetching && !data && (
            <div className="flex items-center gap-2 py-6 font-mono text-[11px] text-ink-mute">
              <Loader2 size={12} className="animate-spin" /> {t('common.loading')}
            </div>
          )}
          {query.isError && (
            <p className="border-l-2 border-scp-err/60 bg-scp-err/5 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-scp-err">
              {describeControlError(query.error, t)}
            </p>
          )}
          {data && rows.map((r, i) => (
            <div key={`${r.label}-${i}`} className="flex justify-between gap-3 border-b border-ink-border/50 py-1.5 font-mono text-[11px] last:border-b-0">
              <span className="shrink-0 text-ink-mute">{r.label}</span>
              <span className="min-w-0 break-all text-right text-foreground" title={r.title}>{r.value}</span>
            </div>
          ))}
        </div>

        <p className="border-t border-ink-border pt-2 font-mono text-[9px] text-ink-mute">
          {t('profile.hint')}
        </p>
      </div>
    </div>
  )
}
