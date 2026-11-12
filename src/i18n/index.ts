import { useI18nStore } from './store'
import { dict, type TKey } from './dict'

/** 翻译 hook：const t = useT(); t('nav.dashboard') */
export function useT() {
  const lang = useI18nStore((s) => s.lang)
  return (key: TKey): string => {
    const table = dict[lang] as Record<TKey, string>
    return table[key] ?? dict['zh-CN'][key] ?? key
  }
}

/** 非组件环境用：传 lang 取译。 */
export function translate(lang: 'zh-CN' | 'en', key: TKey): string {
  return dict[lang][key] ?? dict['zh-CN'][key] ?? key
}
