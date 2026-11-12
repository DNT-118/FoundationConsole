import type { ComponentType } from 'react'
import {
  LayoutDashboard, Server, Users, Puzzle, ShieldAlert,
  Terminal, ScrollText, Ban, Folder, Code2, Settings, Info, Map, Radio, Megaphone,
  ClipboardCheck, Activity,
} from 'lucide-react'
import type { TKey } from '@/i18n/dict'

export interface NavItem {
  path: string
  labelKey: TKey
  icon: ComponentType<{ size?: number; className?: string }>
}

/** 左侧导航：与设计稿顺序一致 */
export const navItems: NavItem[] = [
  { path: '/dashboard',    labelKey: 'nav.dashboard',    icon: LayoutDashboard },
  { path: '/announcement', labelKey: 'nav.announcement', icon: Megaphone },
  { path: '/servers',       labelKey: 'nav.servers',     icon: Server },
  { path: '/players',       labelKey: 'nav.players',     icon: Users },
  { path: '/plugins',       labelKey: 'nav.plugins',     icon: Puzzle },
  { path: '/remoteadmin',   labelKey: 'nav.remoteadmin', icon: ShieldAlert },
  { path: '/console',       labelKey: 'nav.console',     icon: Terminal },
  { path: '/map',           labelKey: 'nav.map',         icon: Map },
  { path: '/voice',         labelKey: 'nav.voice',       icon: Radio },
  { path: '/logs',          labelKey: 'nav.logs',         icon: ScrollText },
  { path: '/reports',       labelKey: 'nav.reports',      icon: ClipboardCheck },
  { path: '/events',        labelKey: 'nav.events',       icon: Activity },
  { path: '/banlist',       labelKey: 'nav.banlist',     icon: Ban },
  { path: '/files',         labelKey: 'nav.files',         icon: Folder },
  { path: '/api',           labelKey: 'nav.api',           icon: Code2 },
  { path: '/settings',      labelKey: 'nav.settings',     icon: Settings },
  { path: '/about',         labelKey: 'nav.about',        icon: Info },
]
