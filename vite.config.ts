import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * 生产构建才注入 CSP，开发时故意不注入：
 * Vite 的 HMR 客户端与 React Refresh 需要内联脚本和 eval，任何严格的 script-src
 * 都会把开发服务器直接打瘫。开发时本机跑的是自己的源码，风险面本就不一样。
 *
 * connect-src 放开到 http:/https: 是刻意的：这个程序的用途就是让用户填任意
 * OpenAI 兼容端点（含局域网里的 Ollama）。把这里收紧等于把功能关掉，
 * 真正需要防的是「页面里被注入第三方脚本」——那一条由 script-src 'self' 兜住。
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // ECharts 会把颜色写成元素上的内联 style，Tailwind 也有少量运行时内联样式
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https: http: ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

function cspPlugin(): Plugin {
  return {
    name: 'gtjs:strict-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), cspPlugin()],
  resolve: {
    alias: {
      '#': path.resolve(import.meta.dirname, './src'),
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    // ECharts 单独成块后首屏已经轻了；这个阈值只是用来压掉无意义的告警。
    chunkSizeWarningLimit: 800,
  },
  server: {
    // 本程序只在本机使用；固定端口，便于把 http://127.0.0.1:5273 填进各 AI 服务商的
    // 允许来源 / CORS 白名单。
    host: '127.0.0.1',
    port: 5273,
    strictPort: false,
  },
  preview: {
    host: '127.0.0.1',
    port: 4273,
  },
})
