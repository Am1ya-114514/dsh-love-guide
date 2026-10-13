/**
 * 主界面与 Electron 外壳之间那一层很薄的桥。
 *
 * 网页版（浏览器里直接打开）没有这层，所以用到的每个入口都要先问一句
 * `studioBridge()` 是不是 null，为 null 就干脆不渲染那个按钮——
 * 比让人点一下再弹「仅桌面版可用」舒服。
 *
 * 这里只做类型声明和取值，不做任何判断逻辑。
 */

export interface StudioBridge {
  /** 叫出悬浮窗；返回是否成功显示 */
  showOverlay: () => Promise<boolean>
  hideOverlay: () => Promise<boolean>
  overlayVisible: () => Promise<boolean>
  overlayHotkey: () => Promise<string>
}

declare global {
  interface Window {
    studioAPI?: StudioBridge
  }
}

export function studioBridge(): StudioBridge | null {
  if (typeof window === 'undefined') return null
  return window.studioAPI ?? null
}
