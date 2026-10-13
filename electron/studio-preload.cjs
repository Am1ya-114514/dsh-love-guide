/**
 * 主窗口的 preload。
 *
 * 只暴露「打开/隐藏悬浮窗」和「问一下快捷键是什么」——主窗口的渲染进程跑的是
 * 我们自己的界面，但它渲染的是模型返回的文本，暴露面越小越好，所以这里不把
 * `ipcRenderer` 本身递出去，也不递任何通用 `invoke`。
 *
 * 注意这与网页版是共存的：浏览器里根本没有 `window.studioAPI`，
 * 界面据此判断该不该显示「实时建议」那个入口。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('studioAPI', {
  isDesktop: true,
  showOverlay: () => ipcRenderer.invoke('overlay:show'),
  hideOverlay: () => ipcRenderer.invoke('overlay:hide'),
  overlayVisible: () => ipcRenderer.invoke('overlay:visible'),
  overlayHotkey: () => ipcRenderer.invoke('overlay:hotkey'),
})
