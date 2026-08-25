import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // 开发时代理 SSE 到 DSH 插件端口
      '/events': {
        target: 'http://127.0.0.1:9527',
        changeOrigin: false,
      },
      '/trace': {
        target: 'http://127.0.0.1:9527',
        changeOrigin: false,
      },
      '/unmapped-tools': {
        target: 'http://127.0.0.1:9527',
        changeOrigin: false,
      },
      '/plugins': {
        target: 'http://127.0.0.1:9527',
        changeOrigin: false,
      },
    },
  },
})
