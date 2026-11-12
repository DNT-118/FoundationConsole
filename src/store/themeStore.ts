/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'dark' | 'light' | 'anime'

/** 主题循环顺序：dark → light → anime → dark。 */
const CYCLE: Theme[] = ['dark', 'light', 'anime']

interface ThemeState {
  theme: Theme
  setTheme: (t: Theme) => void
  toggle: () => void
}

/** 应用主题：写入 html[data-theme]，持久化到 localStorage。 */
const apply = (t: Theme) => {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', t)
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'anime',
      setTheme: (t) => {
        apply(t)
        set({ theme: t })
      },
      toggle: () => {
        const cur = get().theme
        const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length]
        apply(next)
        set({ theme: next })
      },
    }),
    { name: 'pfc.theme' },
  ),
)

/** 应用启动时（模块加载）立即生效，避免闪白。 */
apply((typeof localStorage !== 'undefined' && localStorage.getItem('pfc.theme')) ? (JSON.parse(String(localStorage.getItem('pfc.theme') ?? '') )?.state?.theme || 'anime') : 'anime')