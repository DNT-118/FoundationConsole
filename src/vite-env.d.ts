/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: 'sldata' | 'local' | 'server'
  /** GitHub Pages 演示构建时为 '1'（vite --mode demo 注入）。 */
  readonly VITE_FDC_DEMO?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
