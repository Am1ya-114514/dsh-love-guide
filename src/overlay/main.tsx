/**
 * 悬浮窗入口。
 *
 * 刻意不 import 主程序的 index.css（那里有整套 Tailwind 主题、几百 KB），
 * 悬浮窗用的是自己一份很小的手写 CSS：它每多一毫秒的启动时间，用户就多等
 * 一毫秒才看到那句能发出去的话。
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { OverlayApp } from './overlay-app'
import './overlay.css'

const host = document.getElementById('overlay-root')
if (host) {
  createRoot(host).render(
    <StrictMode>
      <OverlayApp />
    </StrictMode>,
  )
}
