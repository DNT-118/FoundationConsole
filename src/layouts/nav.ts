import type { ComponentType } from 'react'
import {
  LayoutDashboard, Server, Users, Puzzle, ShieldAlert,
  Terminal, ScrollText, Ban, Folder, Code2, Settings, Info,
} from 'lucide-react'

export interface NavItem {
  path: string
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
}

/** 左侧导航：与设计稿顺序一致 */
export const navItems: NavItem[] = [
  { path: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
  { path: '/servers',       label: 'Servers',     icon: Server },
  { path: '/players',       label: 'Players',     icon: Users },
  { path: '/plugins',       label: 'Plugins',     icon: Puzzle },
  { path: '/remoteadmin',   label: 'RemoteAdmin', icon: ShieldAlert },
  { path: '/console',       label: 'Console',     icon: Terminal },
  { path: '/logs',          label: 'Logs',         icon: ScrollText },
  { path: '/banlist',       label: 'Ban List',     icon: Ban },
  { path: '/files',         label: 'Files',         icon: Folder },
  { path: '/api',           label: 'API',           icon: Code2 },
  { path: '/settings',      label: 'Settings',     icon: Settings },
  { path: '/about',         label: 'About',        icon: Info },
]
