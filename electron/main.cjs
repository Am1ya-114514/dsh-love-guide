/**
 * 狗头军师工作室 —— 桌面外壳。
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
const { app, BrowserWindow, Menu, dialog, shell } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const APP_NAME = '狗头军师工作室'
const HOST = '127.0.0.1'
const PORT = 41730
const DEV_URL = process.env.GTJS_DEV_URL || ''

/** 可移植数据目录：优先环境变量，其次 exe 同级，最后退回系统默认。 */
function resolveDataDir() {
  if (process.env.GTJS_DATA_DIR) return path.resolve(process.env.GTJS_DATA_DIR)
  if (!app.isPackaged) return path.join(__dirname, '..', '.runtime', 'data')
  const beside = path.join(path.dirname(app.getPath('exe')), 'goutoujunshi-data')
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
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.on('window-all-closed', () => app.quit())

  app.whenReady().then(async () => {
    if (!DEV_URL) await startServer()
    await createWindow()
  })
}
