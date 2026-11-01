/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SL_DATA_API_BASE?: string
  readonly VITE_SL_DATA_API_TOKEN?: string
  readonly VITE_DATA_SOURCE?: 'sldata' | 'local' | 'server'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
