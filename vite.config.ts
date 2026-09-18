/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const host = process.env.ELECTRON_DEV_HOST

export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || '127.0.0.1',
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/dist-electron/**'] },
  },
  test: {
    // 只跑 src/ 下的测试，避免 .worktrees、.pnpm-store 里的陈旧副本被误当作测试。
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  },
})
