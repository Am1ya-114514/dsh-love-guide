/**
 * 悬浮窗的 Python 后端（截图 / OCR / 注入）由这个模块托管。
 *
 * 为什么要单独一个进程，见 overlay/service.py 顶部的注释。这里只负责：
 * 拉起它、按行收发 JSON、把事件转发给界面、退出时收尸。
 *
 * 两个容易踩的点：
 * - **stdout 是协议通道，绝不能被别的东西污染**。任何 print 到 stdout 的
 *   调试输出都会让 JSON 解析失败，所以子进程的 stderr 单独接出来当日志。
 * - **写 stdin 之后不保证立刻有响应**。OCR 一次要好几秒，所以请求带 id，
 *   响应按 id 对回去，允许多个请求同时在飞。
 */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')

/** 找后端目录：环境变量 > 打包进 resources > 仓库内的 overlay/ > 开发时的同级目录。 */
function resolveOverlayDir(app) {
  if (process.env.GTJS_OVERLAY_DIR) return path.resolve(process.env.GTJS_OVERLAY_DIR)
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'overlay')
    if (fs.existsSync(path.join(bundled, 'service.py'))) return bundled
  }
  // 仓库里自带一份 overlay/（入 git），开发时直接用，不必依赖隔壁的独立目录
  const inRepo = path.join(__dirname, '..', 'overlay')
  if (fs.existsSync(path.join(inRepo, 'service.py'))) return inRepo
  const dev = path.join(__dirname, '..', '.runtime', 'overlay')
  if (fs.existsSync(path.join(dev, 'service.py'))) return dev
  // 兜底：允许指向仓库外的后端副本
  return process.env.GTJS_OVERLAY_DEV_DIR || inRepo
}

/**
 * 找 Python。
 *
 * 顺序是有讲究的：**必须先看后端目录里的 .venv**，因为 RapidOCR 和 pywin32
 * 只装在那个虚拟环境里；系统 Python 能跑起来 import 就会失败，报出来的错
 * （ModuleNotFoundError）会让用户以为是程序坏了，其实是解释器选错了。
 */
function resolvePython(overlayDir) {
  if (process.env.GTJS_OVERLAY_PY) return process.env.GTJS_OVERLAY_PY
  const candidates = [
    path.join(overlayDir, '.venv', 'Scripts', 'python.exe'),
    path.join(overlayDir, '.venv', 'bin', 'python'),
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return 'python'
}

class OverlaySidecar extends EventEmitter {
  constructor(app, log, dataDir) {
    super()
    this.app = app
    this.log = log || (() => {})
    this.proc = null
    this.seq = 0
    this.pending = new Map()
    this.buf = ''
    this.dir = resolveOverlayDir(app)
    this.python = resolvePython(this.dir)
    // 后端要读数据目录里的 model.json（模型连接由渲染进程经 ai:sync 写在那里）。
    // 打包后 GTJS_DATA_DIR 并不在 process.env 里——那是我们自己的约定，不是系统的，
    // 所以必须由主进程算出真实路径显式传进来，不能指望子进程自己猜。
    this.dataDir = dataDir || process.env.GTJS_DATA_DIR || ''
    this.ready = false
  }

  describe() {
    return { dir: this.dir, python: this.python, running: !!this.proc, ready: this.ready }
  }

  start() {
    if (this.proc) return
    const script = path.join(this.dir, 'service.py')
    if (!fs.existsSync(script)) {
      this.log(`找不到后端脚本：${script}`)
      this.emit('unavailable', { dir: this.dir, python: this.python, script })
      return
    }

    this.proc = spawn(this.python, [script], {
      cwd: this.dir,
      // 后端里所有中文输出都是 UTF-8；不指定的话 Windows 下会按 GBK 解，
      // 报错信息会变成乱码，排查时非常难受。
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
        ...(this.dataDir ? { GTJS_DATA_DIR: this.dataDir } : {}),
      },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (chunk) => this._onData(chunk))
    this.proc.stderr.setEncoding('utf8')
    this.proc.stderr.on('data', (chunk) => this.log(`[overlay] ${String(chunk).trimEnd()}`))

    this.proc.on('exit', (code, signal) => {
      this.log(`后端退出 code=${code} signal=${signal}`)
      this.proc = null
      this.ready = false
      for (const [, p] of this.pending) p.reject(new Error('后端进程已退出'))
      this.pending.clear()
      this.emit('exit', { code, signal })
    })
    this.proc.on('error', (err) => {
      this.log(`后端启动失败：${err.message}`)
      this.emit('unavailable', { dir: this.dir, python: this.python, error: err.message })
    })
  }

  _onData(chunk) {
    this.buf += chunk
    let idx
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim()
      this.buf = this.buf.slice(idx + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        // 后端往 stdout 打了非 JSON 的东西。不能让它静默消失，
        // 否则表现就是「某个功能一直转圈」，查起来毫无线索。
        this.log(`后端输出无法解析：${line.slice(0, 300)}`)
        continue
      }
      if (msg.event) {
        if (msg.event === 'ready') this.ready = true
        this.emit('event', msg)
        continue
      }
      const p = this.pending.get(msg.id)
      if (!p) {
        this.log(`收到无主响应 id=${msg.id}`)
        continue
      }
      this.pending.delete(msg.id)
      if (msg.ok === false) p.reject(new Error(msg.error || '后端返回失败'))
      else p.resolve(msg)
    }
  }

  call(cmd, params = {}, timeoutMs = 60000) {
    if (!this.proc) {
      this.start()
      if (!this.proc) return Promise.reject(new Error('后端不可用'))
    }
    const id = ++this.seq
    const payload = JSON.stringify({ id, cmd, ...params })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`后端超时（${cmd}，${timeoutMs}ms）`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      this.proc.stdin.write(payload + '\n')
    })
  }

  stop() {
    if (!this.proc) return
    try {
      this.proc.stdin.write(JSON.stringify({ id: 0, cmd: 'quit' }) + '\n')
    } catch {
      /* 管道可能已经断了 */
    }
    const proc = this.proc
    setTimeout(() => {
      if (proc && !proc.killed) proc.kill()
    }, 1500)
  }
}

module.exports = { OverlaySidecar, resolveOverlayDir, resolvePython }
