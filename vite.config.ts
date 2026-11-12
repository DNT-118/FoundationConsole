import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 演示版（GitHub Pages）：`npm run build:demo`，即 `vite build --mode demo`。
 * - 部署子路径默认 /FoundationConsole/，可用 FDC_BASE 覆盖
 * - 注入 VITE_FDC_DEMO=1，并清空本地 .env 里的默认地址 / Token，防止打进公开产物
 * - 复制 index.html 为 404.html，供 GitHub Pages 做 SPA 路由回退
 * 普通构建（`npm run build`）不受影响。
 */
function spaFallback(): Plugin {
  let outDir = 'dist'
  return {
    name: 'fdc-spa-404-fallback',
    apply: 'build',
    configResolved(cfg) {
      outDir = path.resolve(cfg.root, cfg.build.outDir)
    },
    closeBundle() {
      const index = path.join(outDir, 'index.html')
      if (fs.existsSync(index)) {
        fs.copyFileSync(index, path.join(outDir, '404.html'))
        fs.writeFileSync(path.join(outDir, '.nojekyll'), '')
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo'
  return {
    base: demo ? (process.env.FDC_BASE ?? '/FoundationConsole/') : '/',
    plugins: demo ? [react(), spaFallback()] : [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    define: demo
      ? {
          'import.meta.env.VITE_FDC_DEMO': JSON.stringify('1'),
          'import.meta.env.VITE_SL_DATA_API_BASE': JSON.stringify(''),
          'import.meta.env.VITE_SL_DATA_API_TOKEN': JSON.stringify(''),
        }
      : undefined,
    server: { port: 5173, strictPort: false },
  }
})
