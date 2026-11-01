import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { navItems } from './nav'
import { useServersStore } from '@/store/serversStore'

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const servers = useServersStore((s) => s.servers)

  return (
    <aside
      className={[
        'flex h-full flex-col border-r border-ink-border bg-ink-deep',
        'transition-[width] duration-300 ease-out',
        collapsed ? 'w-[56px]' : 'w-[220px]',
      ].join(' ')}
    >
      {/* Logo 区 */}
      <div className="flex h-14 items-center gap-3 border-b border-ink-border px-4">
        <div className="grid h-7 w-7 shrink-0 place-items-center">
          <span className="font-mono text-[13px] font-bold leading-none text-white">
            SCP
          </span>
        </div>
        {!collapsed && (
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-white">
            Foundation&nbsp;Console
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
              className={({ isActive }) =>
                [
                  'group relative flex items-center gap-3 px-4 py-2.5',
                  'text-[13px] transition-colors duration-300',
                  isActive
                    ? 'text-white'
                    : 'text-ink-mute hover:text-white',
                ].join(' ')
              }
              title={collapsed ? item.label : undefined}
            >
              {({ isActive }) => (
                <>
                  {/* 激活左侧白色竖线 */}
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-6 w-[2px] -translate-y-1/2 bg-white" />
                  )}
                  <Icon size={16} className="shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* 服务器数 + 折叠按钮 */}
      <div className="border-t border-ink-border">
        {!collapsed && (
          <div className="px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-mute">
            {servers.length} server(s)
          </div>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full items-center justify-center gap-2 py-2.5 text-ink-mute transition-colors hover:text-white"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          {!collapsed && (
            <span className="font-mono text-[10px] uppercase tracking-wider">
              Collapse
            </span>
          )}
        </button>
      </div>
    </aside>
  )
}
