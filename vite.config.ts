import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

/**
 * pages-demo 分支（GitHub Pages 演示版）。
 * - `npm run build:demo`（`vite build --mode demo`）：部署子路径默认 /FoundationConsole/（可用 FDC_BASE 覆盖），
 *   注入 VITE_FDC_DEMO=1（浏览器内模拟后端 + 免登录 + 红色提示栏），
 *   并复制 index.html 为 404.html 供 GitHub Pages 做 SPA 路由回退、写入 .nojekyll。
 * - 普通 `npm run build` / `npm run dev`：与 main 分支前端一致，需要 Node 后端（本分支不含后端，见 main）。
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
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    define: demo ? { 'import.meta.env.VITE_FDC_DEMO': JSON.stringify('1') } : undefined,
    server: demo
      ? { host: '127.0.0.1', port: 5173 }
      : {
          host: '127.0.0.1',
          port: 5173,
          proxy: { '/api': { target: 'http://127.0.0.1:3000', ws: true } },
        },
  }
})
