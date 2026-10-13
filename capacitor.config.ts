import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Android 外壳配置。
 *
 * 几个必须写死的点：
 *
 * - `webDir: 'dist'` —— Capacitor 把 Vite 的产物整包塞进 APK 的 assets 里，程序完全离线可用，
 *   不需要任何服务器。
 * - `server.androidScheme: 'https'` —— Android WebView 里页面 origin 默认是 `http://localhost`，
 *   某些模型服务商的 CORS 规则会拒掉 http origin；改成 https 后 origin 变成 `https://localhost`，
 *   与服务商放行的形态更接近。注意 **不能改成别的 hostname**：IndexedDB 按 origin 隔离，
 *   换 hostname 等于换数据库，用户档案会“凭空消失”。
 * - **刻意不开 `CapacitorHttp`**。它会把 fetch 劫持到原生 HTTP 栈，好处是绕开 CORS，
 *   代价是响应被整体缓冲——**流式输出（SSE）会直接失效**，军师的回复变成一次性蹦出来。
 *   实测 `api.deepseek.com` 对预检请求是「回声式」放行（`access-control-allow-origin`
 *   原样回送请求方的 origin，`https://localhost` 也照放），所以 WebView 里的原生 fetch
 *   走 CORS 完全能过，流式也保得住。若某个自建端点不放行 CORS，那是该端点的配置问题，
 *   不是这里能绕的——不要为了它把流式牺牲掉。
 * - `android.allowMixedContent: false` —— 不放开明文 HTTP。要用局域网里的 Ollama
 *   就得给它配 HTTPS，或者自行在 AndroidManifest 里加 `usesCleartextTraffic`。
 */
const config: CapacitorConfig = {
  appId: 'com.am1ya.dshloveguide',
  appName: 'dsh-Love Guide',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0c0a09',
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0c0a09',
      overlaysWebView: false,
    },
  },
}

export default config
