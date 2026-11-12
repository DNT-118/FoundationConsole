import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Lang = 'zh-CN' | 'en'

interface I18nState {
  lang: Lang
  setLang: (l: Lang) => void
  toggle: () => void
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set, get) => ({
      lang: 'zh-CN',
      setLang: (lang) => set({ lang }),
      toggle: () => set({ lang: get().lang === 'zh-CN' ? 'en' : 'zh-CN' }),
    }),
    { name: 'pfc.lang' },
  ),
)
