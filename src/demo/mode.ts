/**
 * GitHub Pages 演示模式开关（构建期决定）。
 * `npm run build:demo` / `vite build --mode demo` 时为 true；
 * 普通构建为 false，相关分支会在打包时被整体剔除。
 */
export const IS_DEMO: boolean = import.meta.env.VITE_FDC_DEMO === '1'

/** 演示内置数据源的地址前缀，例如 demo://sample */
export const DEMO_URL_PREFIX = 'demo://'

export const DEMO_BANNER_TEXT =
  '注意，你正在使用Github Pages演示版本，此版本所有数据均存储在本地浏览器且某些功能不可用'
