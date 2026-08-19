import path from 'path'
import { defineConfig } from '@lark-apaas/coding-preset-vite-react'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
      // 自托管部署：把飞书 / Miaoda 的客户端 SDK 整个替换为本地空壳，
      // 避免远程 /spark/app/* 与 slardar/tea 监控脚本请求失败导致白屏。
      '@lark-apaas/client-toolkit-lite': path.resolve(
        __dirname,
        'src/lib/miaoda-toolkit-mock.tsx',
      ),
    },
  },
})
