/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
import { useEffect, useState } from 'react'
import { useServerQuery } from '@/hooks/useServerQuery'
import { useServersStore, serverBaseUrl } from '@/store/serversStore'
import { nukeText } from '@/utils/serverDisplay'
import { useT } from '@/i18n'
import { useThemeStore } from '@/store/themeStore'
import { useI18nStore } from '@/i18n/store'

// 中文界面显示 UTC+8（北京时间）；英文界面显示美国太平洋时间（夏令时自动处理）
const TZ_ZH = 'Asia/Shanghai'
const TZ_EN = 'America/Los_Angeles'

function formatClock(now: Date, tz: string) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: tz,
  }).format(now)
}

export default function Statusbar() {
  const t = useT()
  const theme = useThemeStore((s) => s.theme)
  const lang = useI18nStore((s) => s.lang)
  const active = useServersStore((s) => s.servers.find((x) => x.id === s.activeId))
  const { data, isFetching } = useServerQuery()
  const [now, setNow] = useState(() => new Date())

  // 每秒走动一次（原实现只在数据刷新触发重渲染时更新）
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const tz = lang === 'en' ? TZ_EN : TZ_ZH
  const clock = formatClock(now, tz)

  return (
    <footer className={`flex h-7 items-center justify-between border-t border-ink-border px-4 font-mono text-[10px] uppercase tracking-wider text-ink-mute ${theme === 'anime' ? '' : 'bg-ink-deep'}`}>
      <div className="flex items-center gap-4 overflow-hidden">
        <span className="hidden sm:inline">{t('status.version')} 0.2.0 · PEAK</span>
        <span className="hidden text-ink-border sm:inline">|</span>
        <span className="hidden truncate md:inline">{active ? serverBaseUrl(active) : 'no endpoint'}</span>
        <span className="hidden text-ink-border md:inline">|</span>
        <span className={isFetching ? 'text-foreground' : ''}>
          {isFetching ? t('status.syncing') : t('status.idle')}
        </span>
      </div>

      <div className="flex items-center gap-4 overflow-hidden">
        <span className="hidden sm:inline">{t('status.round')} {data ? `${data.roundDuration}s` : '—'}</span>
        <span className="hidden text-ink-border sm:inline">|</span>
        <span className="hidden sm:inline">{t('status.nuke')} {nukeText(data, t)}</span>
        <span className="hidden text-ink-border sm:inline">|</span>
        <span className="text-foreground">{clock} {t('status.tz')}</span>
        <span className="hidden text-ink-border lg:inline">|</span>
        <span className="hidden font-mono text-[9px] text-ink-mute lg:inline">© DNT_OF</span>
      </div>
    </footer>
  )
}
