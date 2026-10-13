/**
 * 悬浮窗的 preload。
 *
 * 主窗口没有 preload（它只需要 fetch 自己的后端），但悬浮窗必须能：
 * 列出窗口、读聊天、把建议回复填进输入框、以及被快捷键显示/隐藏。
 * 这些都得走主进程，所以这里开一个**只有这几个方法**的窄接口。
 *
 * 刻意不暴露 `ipcRenderer` 本身：那等于把整条 IPC 通道交给页面，
 * 而页面会加载模型返回的文本——万一将来渲染出了问题，暴露面越小越好。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('overlayAPI', {
  /** 后端状态：目录、解释器、是否就绪。界面用它显示排查信息。 */
  status: () => ipcRenderer.invoke('overlay:status'),
  /** 列出所有可见窗口，给用户挑一个要盯的目标。 */
  listWindows: () => ipcRenderer.invoke('overlay:list-windows'),
  /** 读一次聊天内容（截图 + OCR），几秒级。 */
  read: (hwnd, max) => ipcRenderer.invoke('overlay:read', { hwnd, max }),
  /** 开始/停止监听。监听到变化会推 'changed' 事件。 */
  watch: (hwnd, interval) => ipcRenderer.invoke('overlay:watch', { hwnd, interval }),
  unwatch: () => ipcRenderer.invoke('overlay:unwatch'),
  /** 把文字填进目标窗口的输入框 —— 只填，不发。 */
  inject: (hwnd, text) => ipcRenderer.invoke('overlay:inject', { hwnd, text }),
  /** 收起成一个小条 / 展开。 */
  setCollapsed: (collapsed) => ipcRenderer.invoke('overlay:set-collapsed', { collapsed }),
  hide: () => ipcRenderer.invoke('overlay:hide'),
  /** 把主窗口唤到前台并切到设置页——模型连接不在这个窗口里。 */
  openSettings: () => ipcRenderer.invoke('studio:open-settings'),
  /** 快捷键用的当前值，界面上要显示出来。 */
  hotkey: () => ipcRenderer.invoke('overlay:hotkey'),

  onEvent: (handler) => {
    const wrapped = (_e, payload) => handler(payload)
    ipcRenderer.on('overlay:event', wrapped)
    return () => ipcRenderer.removeListener('overlay:event', wrapped)
  },
})
