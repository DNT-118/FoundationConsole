/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: 'sldata' | 'local' | 'server'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
