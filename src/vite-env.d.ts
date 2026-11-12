/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SL_DATA_API_BASE?: string
  readonly VITE_SL_DATA_API_TOKEN?: string
  readonly VITE_DATA_SOURCE?: 'sldata' | 'local' | 'server'
  /** '1' = GitHub Pages 演示构建（由 vite.config.ts 在 --mode demo 时注入） */
  readonly VITE_FDC_DEMO?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
