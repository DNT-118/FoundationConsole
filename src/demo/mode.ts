/**
 * GitHub Pages 演示模式开关（构建期决定）。
 * `npm run build:demo` / `vite build --mode demo` 时为 true；
 * 普通构建为 false，相关分支会在打包时被整体剔除。
 */
export const IS_DEMO: boolean = import.meta.env.VITE_FDC_DEMO === '1'

export const DEMO_BANNER_TEXT =
  '注意，你正在使用Github Pages演示版本，此版本所有数据均存储在本地浏览器且某些功能不可用'

/** 演示内置模拟服务器的主机名（只有它会返回模拟数据）。 */
export const DEMO_MOCK_HOST = 'demo.local'
