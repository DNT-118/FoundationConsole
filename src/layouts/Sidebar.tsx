/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, LogOut, Languages, Menu } from 'lucide-react'
import { navItems } from './nav'
import { useServersStore } from '@/store/serversStore'
import { useAuthStore } from '@/store/authStore'
import { useI18nStore } from '@/i18n/store'
import { useT } from '@/i18n'
import { preloadPage } from '@/pages/preload'
import { useThemeStore } from '@/store/themeStore'

export default function Sidebar() {
  // 手机端（<768px）默认折叠为图标栏；展开时全屏覆盖（fixed + 遮罩），
  // 不再挤压右侧工作区。宽屏保持传统 push 布局。
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768,
  )
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768,
  )
  // 移动端展开态（覆盖模式）
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 768) {
        setIsMobile(true)
        setCollapsed(true)
      } else {
        setIsMobile(false)
        setOpen(false) // 回宽屏收起覆盖
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const t = useT()
  const servers = useServersStore((s) => s.servers)
  const resetServers = useServersStore((s) => s.reset)
  const signOut = useAuthStore((s) => s.signOut)
  const session = useAuthStore((s) => s.session)
  const toggleLang = useI18nStore((s) => s.toggle)
  const lang = useI18nStore((s) => s.lang)
  const navigate = useNavigate()
  const theme = useThemeStore((s) => s.theme)

  const expanded = isMobile ? open : !collapsed
  const closeNav = () => { if (isMobile) setOpen(false) }

  return (
    <>
      {/* 移动端展开遮罩：点击任意处关闭 */}
      {isMobile && open && (
        <div
          className="fixed inset-0 z-40 bg-ink/60 backdrop-blur-[2px]"
          onClick={closeNav}
        />
      )}
      <aside
        className={[
          'flex h-full flex-col border-r border-ink-border',
        theme !== 'anime' && 'bg-ink-deep',
          'transition-[width] duration-300 ease-out',
          // 移动端展开 = 全屏覆盖（fixed 脱离文档流，不挤压工作区）
          isMobile && open
            ? 'fixed inset-y-0 left-0 z-50 w-[220px] shadow-2xl'
            : collapsed
              ? 'w-[56px]'
              : 'w-[220px]',
        ].join(' ')}
      >
        {/* Logo 区 */}
        <div className="flex h-14 items-center gap-3 border-b border-ink-border px-4">
          <div className="grid h-7 w-7 shrink-0 place-items-center">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="SCP" className="h-7 w-7 object-contain" draggable={false} />
          </div>
          {expanded && (
            <span className="font-sans text-[12px] tracking-wide text-foreground">
              {t('app.title')}
            </span>
          )}
        </div>

        {/* 导航 */}
        <nav className="flex-1 overflow-y-auto py-2">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={closeNav}
                onMouseEnter={() => preloadPage(item.path)}
                onFocus={() => preloadPage(item.path)}
                aria-label={t(item.labelKey)}
                className={({ isActive }) =>
                  [
                    'group relative flex items-center gap-3 px-4 py-2.5',
                    'text-[13px] transition-colors duration-300',
                    isActive ? 'text-foreground' : 'text-ink-mute hover:text-foreground',
                  ].join(' ')
                }
                title={collapsed && !open ? t(item.labelKey) : undefined}
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute left-0 top-1/2 h-6 w-[2px] -translate-y-1/2 bg-inverse" />
                    )}
                    <Icon size={16} className="shrink-0" />
                    {expanded && <span className="truncate">{t(item.labelKey)}</span>}
                  </>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* 底部：语言 / 服务器数 / 登出 / 折叠 */}
        <div className="border-t border-ink-border">
          <button
            onClick={toggleLang}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-ink-mute transition-colors hover:text-foreground"
            title="切换语言 / Toggle language"
          >
            <Languages size={14} />
            {expanded && (
              <span className="font-mono text-[10px] uppercase tracking-wider">
                {lang === 'zh-CN' ? '简体中文' : 'English'}
              </span>
            )}
          </button>

          {expanded && (
            <div className="px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-mute">
              {servers.length} {t('nav.serversCount')} · {session?.username ?? '—'}
            </div>
          )}
          <button
            onClick={() => {
              signOut()
              resetServers()
              navigate('/login', { replace: true })
            }}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-ink-mute transition-colors hover:text-scp-err"
          >
            <LogOut size={14} />
            {expanded && (
              <span className="font-mono text-[10px] uppercase tracking-wider">{t('nav.signOut')}</span>
            )}
          </button>
          <div className="px-4 py-1.5 text-center font-mono text-[8px] uppercase tracking-[0.3em] text-ink-mute/60">
            DNT_OF © 2026
          </div>
          <button
            onClick={() => (isMobile ? setOpen((o) => !o) : setCollapsed((c) => !c))}
            className="flex w-full items-center justify-center gap-2 py-2.5 text-ink-mute transition-colors hover:text-foreground"
          >
            {isMobile ? (
              open ? <ChevronLeft size={14} /> : <Menu size={14} />
            ) : collapsed ? (
              <ChevronRight size={14} />
            ) : (
              <ChevronLeft size={14} />
            )}
            {expanded && (
              <span className="font-mono text-[10px] uppercase tracking-wider">
                {isMobile ? t('nav.collapse') : t('nav.collapse')}
              </span>
            )}
          </button>
        </div>
      </aside>
    </>
  )
}
