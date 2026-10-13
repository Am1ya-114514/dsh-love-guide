/**
 * dsh-Love Guide —— 桌面外壳。
 *
 * 设计要点（都是踩过坑才这么写的）：
 *
 * 1. **不用 file:// 加载页面**。file:// 的 origin 是 null，浏览器直连
 *    DeepSeek/OpenAI 这类服务商时 CORS 会被拒。这里在 127.0.0.1 上起一个
 *    固定端口的只读静态服务，origin 就是 http://127.0.0.1:<port>，与浏览器
 *    里跑时完全一致，服务商的 CORS 放行规则照样生效。
 *
 * 2. **端口必须固定**。IndexedDB 是按 origin 存的，端口一变就等于换了一个
 *    全新数据库，用户的档案会"凭空消失"。所以端口写死，冲突时宁可报错。
 *
 * 3. **数据目录放在 exe 旁边**（可用 GTJS_DATA_DIR 覆盖）。默认的
 *    userData 在 %APPDATA%（C 盘），这个项目刻意不往 C 盘写东西。
 *
 * 4. **不要终端**。打包出来的是 Windows GUI 子系统程序，双击只有窗口；
 *    进程内不 spawn 任何子进程，所以也不会有黑框闪一下。
 */
const { app, BrowserWindow, Menu, dialog, shell, ipcMain, globalShortcut } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { OverlaySidecar } = require('./sidecar.cjs')

const APP_NAME = 'dsh-Love Guide'
const HOST = '127.0.0.1'
const PORT = 41730
const DEV_URL = process.env.GTJS_DEV_URL || ''

/**
 * 悬浮窗快捷键。
 *
 * 选 Ctrl+Shift+L 是因为它和 QQ/微信/浏览器都不冲突；用 Alt+` 那种
 * 「一个键最小化和展开」的写法虽然更贴需求，但 Alt 组合在中文输入法下
 * 经常被截走，实际用起来会时灵时不灵。
 */
const OVERLAY_HOTKEY = process.env.GTJS_OVERLAY_HOTKEY || 'Control+Shift+L'
/** 收起后的尺寸：只留一条标题栏，贴在屏幕边上不挡聊天。 */
const OVERLAY_COLLAPSED = { width: 340, height: 46 }
const OVERLAY_EXPANDED = { width: 420, height: 620 }


/** 数据目录名。改过名，老目录会在启动时自动搬一次（见 resolveDataDir）。 */
const DATA_DIR_NAME = 'dsh-love-guide-data'
const LEGACY_DATA_DIR_NAME = 'goutoujunshi-data'

/** 可移植数据目录：优先环境变量，其次 exe 同级，最后退回系统默认。 */
function resolveDataDir() {
  if (process.env.GTJS_DATA_DIR) return path.resolve(process.env.GTJS_DATA_DIR)
  if (!app.isPackaged) return path.join(__dirname, '..', '.runtime', 'data')
  const beside = path.join(path.dirname(app.getPath('exe')), DATA_DIR_NAME)
  const legacy = path.join(path.dirname(app.getPath('exe')), LEGACY_DATA_DIR_NAME)

  // 这个程序以前叫「狗头军师工作室」，数据目录也跟着叫 goutoujunshi-data。
  // 改名之后不能把老用户的档案丢在旧目录里，所以启动时先搬一次。
  if (!fs.existsSync(beside) && fs.existsSync(legacy)) {
    try {
      fs.renameSync(legacy, beside)
    } catch {
      // 搬不动（比如旧目录被占用）就继续用旧目录，宁可不改名也不能丢数据。
      return legacy
    }
  }

  try {
    fs.mkdirSync(beside, { recursive: true })
    fs.accessSync(beside, fs.constants.W_OK)
    return beside
  } catch {
    return app.getPath('userData')
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

function distRoot() {
  return app.isPackaged
    ? path.join(app.getAppPath(), 'dist')
    : path.join(__dirname, '..', 'dist')
}

/** 只读静态服务：只有 dist 里的文件能被取到，其他一律回落到 index.html。 */
function startServer() {
  const root = distRoot()
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    dialog.showErrorBox(
      APP_NAME,
      `找不到已构建的前端文件：\n${root}\n\n请在项目目录里先跑 pnpm build，再重新打包。`,
    )
    app.exit(1)
    return Promise.resolve(null)
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)
    let rel = decodeURIComponent(url.pathname)
    if (rel.endsWith('/')) rel += 'index.html'
    const target = path.resolve(root, '.' + rel)

    // 目录穿越防护：解析后的绝对路径必须在 root 底下。
    if (!target.startsWith(root + path.sep) && target !== root) {
      res.writeHead(403).end('forbidden')
      return
    }

    let file = target
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(root, 'index.html') // SPA 回退
    }
    const body = fs.readFileSync(file)
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Length': body.length,
    })
    res.end(body)
  })

  return new Promise((resolve) => {
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        dialog.showErrorBox(
          APP_NAME,
          `端口 ${PORT} 已被占用。\n\n通常是上一个窗口没有完全退出，或者另一个程序占用了这个端口。\n` +
            `请在任务管理器里结束残留的 ${APP_NAME} 进程后重试。\n\n` +
            `（换端口会让本地档案读不出来，所以这里刻意不自动换。）`,
        )
        app.exit(1)
        resolve(null)
        return
      }
      throw err
    })
    server.listen(PORT, HOST, () => resolve(server))
  })
}

/** 图标路径：打好的包里放在 resources/ 下（不进 asar，读取更稳）。 */
function packagedIcon() {
  if (!app.isPackaged) return path.join(__dirname, '..', 'build', 'icon.ico')
  const outside = path.join(process.resourcesPath, 'icon.ico')
  return fs.existsSync(outside) ? outside : path.join(app.getAppPath(), 'build', 'icon.ico')
}

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'))
    if (typeof s.width === 'number' && typeof s.height === 'number') return s
  } catch {
    /* 首次启动没有这个文件，正常 */
  }
  return { width: 1320, height: 880 }
}

function saveWindowState(win) {
  if (!win || win.isDestroyed() || win.isMinimized()) return
  const b = win.getNormalBounds()
  try {
    fs.writeFileSync(windowStatePath(), JSON.stringify({ ...b, maximized: win.isMaximized() }))
  } catch {
    /* 写不进去就算了，不值得打扰用户 */
  }
}

async function createWindow() {
  const state = loadWindowState()
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0c0a09',
    title: APP_NAME,
    icon: packagedIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'studio-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  Menu.setApplicationMenu(null)
  if (state.maximized) win.maximize()

  // 窗口一准备好就显示，避免先闪一块白底
  win.once('ready-to-show', () => win.show())

  // 页面里的外链走系统浏览器，窗口本身不允许被导航走
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault()
      if (/^https?:/i.test(url)) void shell.openExternal(url)
    }
  })

  // 没有原生菜单栏，快捷键在这里手动补上
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    if (key === 'f12' || (input.control && input.shift && key === 'i')) {
      win.webContents.toggleDevTools()
      event.preventDefault()
    } else if (key === 'f5' || (input.control && key === 'r')) {
      win.webContents.reload()
      event.preventDefault()
    } else if (input.control && key === '0') {
      win.webContents.setZoomLevel(0)
      event.preventDefault()
    } else if (input.control && (key === '+' || key === '=' )) {
      win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5)
      event.preventDefault()
    } else if (input.control && key === '-') {
      win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5)
      event.preventDefault()
    }
  })

  win.on('close', () => saveWindowState(win))

  if (DEV_URL) {
    await win.loadURL(DEV_URL)
  } else {
    await win.loadURL(`http://${HOST}:${PORT}/`)
  }
  return win
}

/* ------------------------------------------------------------------ *
 * 悬浮窗：盯一个聊天窗口，把「对方在说什么 + 我可以怎么回」浮在最上面
 * ------------------------------------------------------------------ */

let overlayWin = null
let sidecar = null
let overlayCollapsed = false

function overlayLog(line) {
  console.log(`[main] ${line}`)
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send('overlay:event', { event: 'log', line })
  }
}

async function createOverlay() {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.show()
    overlayWin.focus()
    return overlayWin
  }

  const win = new BrowserWindow({
    ...OVERLAY_EXPANDED,
    minWidth: 320,
    minHeight: 46,
    show: false,
    frame: false, // 无边框：收起时就是一条窄条，有系统边框会很难看
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true, // 它是个辅助窗，不该在任务栏占一格
    alwaysOnTop: true,
    backgroundColor: '#0c0a09',
    title: `${APP_NAME} — 悬浮窗`,
    icon: packagedIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload 里用了 require('electron')，sandbox 下拿不到 ipcRenderer
      spellcheck: false,
    },
  })

  // 'screen-saver' 这一级才能压住全屏视频和部分游戏窗口；
  // 默认的 'floating' 会被 QQ 之类的普通窗口盖住。
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  await win.loadURL(`${DEV_URL || `http://${HOST}:${PORT}`}/overlay.html`)
  overlayWin = win
  win.on('closed', () => {
    overlayWin = null
  })
  return win
}

/** 收起 / 展开。收起态刻意保留标题栏，不然用户找不到怎么展开回来。 */
function setOverlayCollapsed(collapsed) {
  overlayCollapsed = !!collapsed
  if (!overlayWin || overlayWin.isDestroyed()) return overlayCollapsed
  const b = overlayWin.getBounds()
  const target = collapsed ? OVERLAY_COLLAPSED : OVERLAY_EXPANDED
  overlayWin.setBounds({ x: b.x, y: b.y, width: target.width, height: target.height })
  overlayWin.setResizable(!collapsed)
  return overlayCollapsed
}

function registerOverlayIpc() {
  // 模型连接存在浏览器 IndexedDB 里，外面的进程读不到。渲染进程每次保存设置
  // 都会顺手把这份设置送过来，落成一个 JSON 放在数据目录里，供「实时建议」
  // 那个独立进程读取。**API Key 明文落盘**——它和浏览器里那份是同一个信任级别
  // （同一台机器、同一个用户目录），但文件权限收成 0600。
  ipcMain.handle('ai:sync', (_e, payload) => {
    try {
      const dir = resolveDataDir()
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, 'model.json')
      const data = {
        provider: String(payload?.provider ?? ''),
        endpoint: String(payload?.endpoint ?? ''),
        model: String(payload?.model ?? ''),
        apiKey: String(payload?.apiKey ?? ''),
        temperature: Number(payload?.temperature ?? 0.6),
        guardMode: payload?.guardMode === 'research' ? 'research' : 'general',
        updatedAt: new Date().toISOString(),
      }
      // 先写临时文件再 rename，避免另一个进程读到写了一半的 JSON
      const tmp = `${file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
      fs.renameSync(tmp, file)
      return { ok: true, file }
    } catch (err) {
      console.error(`[main] [ai:sync] 写 model.json 失败: ${err?.message ?? err}`)
      return { ok: false, error: String(err?.message ?? err) }
    }
  })

  ipcMain.handle('overlay:status', () => ({
    ...sidecar.describe(),
    collapsed: overlayCollapsed,
    hotkey: OVERLAY_HOTKEY,
  }))

  ipcMain.handle('overlay:hotkey', () => OVERLAY_HOTKEY)

  ipcMain.handle('overlay:list-windows', async () => {
    const res = await sidecar.call('list_windows', {}, 15000)
    return res.windows || []
  })

  ipcMain.handle('overlay:read', async (_e, { hwnd, max }) => {
    const res = await sidecar.call('read', { hwnd, max }, 90000)
    return res
  })

  ipcMain.handle('overlay:watch', async (_e, { hwnd, interval }) => {
    const res = await sidecar.call('watch_start', { hwnd, interval }, 15000)
    return res
  })

  ipcMain.handle('overlay:unwatch', async () => sidecar.call('watch_stop', {}, 8000))

  ipcMain.handle('overlay:inject', async (_e, { hwnd, text }) => {
    const res = await sidecar.call('inject', { hwnd, text }, 20000)
    return res
  })

  ipcMain.handle('overlay:set-collapsed', (_e, { collapsed }) => setOverlayCollapsed(collapsed))

  ipcMain.handle('overlay:hide', () => {
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.hide()
    return true
  })

  // 主窗口那一侧的入口。除了快捷键，用户还需要一个看得见的地方能把悬浮窗叫出来，
  // 否则「有个功能但不知道在哪开」和没有这个功能是一样的。
  ipcMain.handle('overlay:visible', () => Boolean(overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible()))

  ipcMain.handle('overlay:show', async () => {
    if (!overlayWin || overlayWin.isDestroyed()) await createOverlay()
    if (!overlayWin || overlayWin.isDestroyed()) return false
    overlayWin.show()
    overlayWin.focus()
    return true
  })

  // 悬浮窗上的「设置」按钮。模型连接存在主窗口的 IndexedDB 里，悬浮窗自己没法改，
  // 所以这里把主窗口唤到前台并让它切到设置页——而不是在悬浮窗里再复制一套设置界面。
  ipcMain.handle('studio:open-settings', () => {
    const win = BrowserWindow.getAllWindows().find((w) => w !== overlayWin)
    if (!win || win.isDestroyed()) return false
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send('studio:goto', 'settings')
    return true
  })
}

function startSidecar() {
  sidecar = new OverlaySidecar(app, overlayLog)
  sidecar.on('event', (msg) => {
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.webContents.send('overlay:event', msg)
    }
  })
  sidecar.on('unavailable', (info) => {
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.webContents.send('overlay:event', { event: 'unavailable', ...info })
    }
  })
  sidecar.start()
}

// 单实例：第二次启动只把已有窗口叫到前面，不去抢端口。
// 注意顺序：setName / setPath 必须在 requestSingleInstanceLock 之前——
// 单实例锁会在 userData 里落一个 lockfile，先锁的话这个文件就跑到
// %APPDATA%（C 盘）去了，正好违反「不往 C 盘写」这条。
app.setName(APP_NAME)
app.setPath('userData', resolveDataDir())

if (!app.requestSingleInstanceLock()) {
  app.exit(0)
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows().find((w) => w !== overlayWin)
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  // 悬浮窗开着时「关掉主窗口」不该结束整个程序，
  // 否则用户会以为点错了、实际把自己的浮动工具一起关了。
  app.on('window-all-closed', () => app.quit())

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    if (sidecar) sidecar.stop()
  })

  app.whenReady().then(async () => {
    if (!DEV_URL) await startServer()
    await createWindow()
    startSidecar()
    registerOverlayIpc()

    // 快捷键是「一件事的两个动作」：没开就开，开了就收起/展开。
    const ok = globalShortcut.register(OVERLAY_HOTKEY, () => {
      if (!overlayWin || overlayWin.isDestroyed()) {
        void createOverlay()
        return
      }
      if (!overlayWin.isVisible()) {
        overlayWin.show()
        return
      }
      setOverlayCollapsed(!overlayCollapsed)
    })
    if (!ok) overlayLog(`快捷键 ${OVERLAY_HOTKEY} 注册失败（可能被别的程序占了）`)
  })
}
