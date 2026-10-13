/**
 * 主窗口的 preload。
 *
 * 只暴露「打开/隐藏悬浮窗」和「问一下快捷键是什么」——主窗口的渲染进程跑的是
 * 我们自己的界面，但它渲染的是模型返回的文本，暴露面越小越好，所以这里不把
 * `ipcRenderer` 本身递出去，也不递任何通用 `invoke`。
 *
 * 注意这与网页版是共存的：浏览器里根本没有 `window.studioAPI`，
 * 界面据此判断该不该显示「实时建议」那个入口。
 *
 * `syncAiSettings` 是给「实时建议」那个独立进程用的：模型连接存在浏览器的
 * IndexedDB 里，外面的 Python / Qt 进程读不到，所以每次保存设置时顺手把
 * 它写一份 JSON 到数据目录，由主进程落盘。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('studioAPI', {
  isDesktop: true,
  showOverlay: () => ipcRenderer.invoke('overlay:show'),
  hideOverlay: () => ipcRenderer.invoke('overlay:hide'),
  overlayVisible: () => ipcRenderer.invoke('overlay:visible'),
  overlayHotkey: () => ipcRenderer.invoke('overlay:hotkey'),
  syncAiSettings: (payload) => ipcRenderer.invoke('ai:sync', payload),
  // 悬浮窗上那个「设置」按钮走这里：主进程把主窗口唤到前台，再让渲染进程切到设置页。
  onGoto: (cb) => {
    if (typeof cb !== 'function') return () => {}
    const h = (_e, view) => cb(view)
    ipcRenderer.on('studio:goto', h)
    return () => ipcRenderer.removeListener('studio:goto', h)
  },
})
