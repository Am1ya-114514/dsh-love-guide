/**
 * 悬浮窗入口。
 *
 * 样式直接复用主程序那套主题（`../index.css` + `overlay.css` 里的映射），
 * 这样悬浮窗和主窗口是同一套配色、圆角与字号——两边看着像两个软件是很怪的。
 * 代价是悬浮窗的 CSS 从 4KB 涨到 100KB 出头，这是本机加载、一次性开销，
 * 换来的是以后改主题只需要改一处。
 *
 * 主题跟随主窗口：同一个 origin，localStorage 是共享的，所以 initTheme()
 * 在这里读到的是用户在设置里选的那一档。
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initTheme } from '../lib/theme-mode'
import { OverlayApp } from './overlay-app'
import '../index.css'
import './overlay.css'

initTheme()

const host = document.getElementById('overlay-root')
if (host) {
  createRoot(host).render(
    <StrictMode>
      <OverlayApp />
    </StrictMode>,
  )
}
