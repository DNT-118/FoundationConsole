import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// 开发与生产共用平台鉴权、serverId 白名单和 WebSocket 中继。
export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // three.js / @react-three/fiber 只被仪表盘的惰性 3D 场景引用：
        // 拆成独立 vendor chunk，场景代码变动不再使 three 缓存失效；
        // 仍在打开仪表盘 3D 开关时才拉取，不影响首屏。
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules/@react-three')) return 'three-fiber'
        },
      },
    },
    // three.js 压缩后 ~700KB 属固有体积（scene chunk 由仪表盘 3D 开关惰性加载，
    // 永不进首屏）；按其真实体积上调阈值以消除误导性警告，其余 chunk 均 <500KB。
    chunkSizeWarningLimit: 950,
  },
})
