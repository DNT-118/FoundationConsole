/**
 * 页面 chunk 按需预取：只在用户悬停导航项时预加载对应页面，
 * 不做全量预加载（省内存/带宽）。与 App.tsx 中 lazy() 的 import
 * 使用同一 specifier，Vite 保证命中同一 chunk，不会重复打包。
 */
export function preloadPage(path: string): void {
  switch (path) {
    case '/login': void import('@/pages/Login').catch(() => {}); break
    case '/register': void import('@/pages/Register').catch(() => {}); break
    case '/dashboard': void import('@/pages/Dashboard').catch(() => {}); break
    case '/announcement': void import('@/pages/Announcement').catch(() => {}); break
    case '/servers': void import('@/pages/Servers').catch(() => {}); break
    case '/players': void import('@/pages/Players').catch(() => {}); break
    case '/plugins': void import('@/pages/Plugins').catch(() => {}); break
    case '/remoteadmin': void import('@/pages/RemoteAdmin').catch(() => {}); break
    case '/console': void import('@/pages/Console').catch(() => {}); break
    case '/map': void import('@/pages/Map').catch(() => {}); break
    case '/voice': void import('@/pages/Voice').catch(() => {}); break
    case '/logs': void import('@/pages/Logs').catch(() => {}); break
    case '/reports': void import('@/pages/Reports').catch(() => {}); break
    case '/events': void import('@/pages/Events').catch(() => {}); break
    case '/banlist': void import('@/pages/BanList').catch(() => {}); break
    case '/files': void import('@/pages/Files').catch(() => {}); break
    case '/api': void import('@/pages/Api').catch(() => {}); break
    case '/settings': void import('@/pages/Settings').catch(() => {}); break
    case '/about': void import('@/pages/About').catch(() => {}); break
    default: break
  }
}
