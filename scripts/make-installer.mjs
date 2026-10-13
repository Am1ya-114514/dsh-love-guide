#!/usr/bin/env node
/**
 * 打 Windows 安装包（NSIS）。
 *
 * 为什么要有这个脚本，而不是直接跑 electron-builder：
 *
 * 这台机器上「把刚解压完的目录树 rename 到目标名」这一步会偶发
 * EPERM: operation not permitted, rename 'xxx.tmp' -> 'xxx'（errno -4048）。
 * 触发点不止一处：
 *   - electron-builder 解压 Electron 发行包（app-builder-lib/out/util/electronGet.js）
 *   - electron-builder 解压 7zip / NSIS 工具链（同一个 extractArchive）
 *   - @electron/packager 搬最后的产物（见 scripts/pack.mjs，那里也踩到过）
 * 它不是一个稳定的权限问题：等几秒再手动搬同一个目录就能成功，所以是瞬时句柄占用
 * （新写出来的 exe/dll 被杀软或系统扫描时占着）。重跑一次要重新下载、重新解压几百 MB，
 * 代价太大。
 *
 * 所以这里的做法是：跑一次 → 如果失败 → 把缓存里所有「搬了一半」的 *.tmp 目录自己
 * 搬到它该在的名字上（等几秒并重试）→ 再跑一次。第二次跑时 electron-builder 会发现
 * 工具链已经在缓存里，直接跳过下载和解压，于是绕过那个卡点。
 *
 * 用法：node scripts/make-installer.mjs
 * 产物：<项目>/.runtime/installer/<产品名>-Setup-<版本>.exe
 */

import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const RUNTIME = join(ROOT, '.runtime')
const LOG = join(RUNTIME, 'installer-build.log')
const OUT = join(RUNTIME, 'installer')
/** 缓存也放在项目里，理由和输出目录一样：不往 C 盘写。 */
const CACHE = process.env.ELECTRON_BUILDER_CACHE ?? join(RUNTIME, 'electron-builder-cache')
const ELECTRON_CACHE = process.env.ELECTRON_CACHE ?? join(RUNTIME, 'electron-cache')
const MAX_ATTEMPTS = 4

function log(message) {
  console.log(`[installer] ${message}`)
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function* walkDirs(root, depth) {
  if (depth < 0) return
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = join(root, entry.name)
    yield full
    yield* walkDirs(full, depth - 1)
  }
}

/**
 * 重命名，失败就等一会儿再试。
 * 只对「占用类」的错误码重试——路径不存在之类的重试多少次也没用。
 */
function renameWithRetry(from, to, attempts = 6, delayMs = 2500) {
  for (let i = 0; i < attempts; i++) {
    try {
      renameSync(from, to)
      return true
    } catch (error) {
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES'].includes(error?.code)) return false
      if (i < attempts - 1) sleepSync(delayMs)
    }
  }
  return false
}

/**
 * 把没搬完的 *.tmp 目录收尾。
 * 返回修好的数量：为 0 说明这次失败跟那个竞态无关，重试没有意义。
 */
function repairTmpDirs(roots) {
  let fixed = 0
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const dir of walkDirs(root, 2)) {
      if (!dir.endsWith('.tmp')) continue
      const target = dir.slice(0, -'.tmp'.length)
      if (existsSync(target)) {
        rmSync(dir, { recursive: true, force: true })
        log(`清掉多余的临时目录 ${dir}`)
        fixed += 1
        continue
      }
      if (renameWithRetry(dir, target)) {
        log(`接管搬移：${dir} -> ${target}`)
        fixed += 1
      } else {
        log(`搬不动：${dir}（等了几轮仍然被占用）`)
      }
    }
  }
  return fixed
}

function builderCli() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'electron-builder', 'package.json'), 'utf8'))
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['electron-builder']
  if (!bin) throw new Error('electron-builder 的 package.json 里没有 bin 字段，找不到入口')
  return join(ROOT, 'node_modules', 'electron-builder', bin)
}

/**
 * 跑一次 electron-builder。
 * 输出通过文件描述符直接写日志文件，不用管道：这个环境里 spawn 配 stdio: 'pipe'
 * 会因为没有命名管道权限而报 EPERM，而 stdio: 'inherit' 又收不到输出。
 */
function runOnce(cli) {
  const env = { ...process.env, ELECTRON_BUILDER_CACHE: CACHE, ELECTRON_CACHE, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  // 这个会话里带着 ELECTRON_RUN_AS_NODE=1，会让 electron 退化成普通 node，
  // 打包过程中任何用到 electron 可执行文件的地方都会行为异常，所以传给子进程前删掉。
  delete env.ELECTRON_RUN_AS_NODE

  const fd = openSync(LOG, 'w')
  try {
    const result = spawn(process.execPath, [cli, '--win', '--config', 'electron-builder.yml'], {
      cwd: ROOT,
      env,
      stdio: ['ignore', fd, fd],
    })
    return result
  } finally {
    closeSync(fd)
  }
}

function logText() {
  try {
    return readFileSync(LOG, 'utf8').replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '')
  } catch {
    return ''
  }
}

function logTail(lines = 24) {
  return logText().trimEnd().split(/\r?\n/).slice(-lines)
}

function findArtifact() {
  const dir = OUT
  if (!existsSync(dir)) return null
  const hit = readdirSync(dir).find((name) => /Setup.*\.exe$/i.test(name))
  return hit ? join(dir, hit) : null
}

async function main() {
  const cli = builderCli()
  log(`electron-builder 入口 ${cli}`)
  log(`输出目录 ${OUT}`)
  log(`缓存目录 ${CACHE}`)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    log(`第 ${attempt} 次尝试…`)
    const child = runOnce(cli)
    const code = await new Promise((done) => child.on('close', done))
    if (code === 0) {
      const artifact = findArtifact()
      log(`打包成功${artifact ? `：${artifact}` : ''}`)
      return
    }

    log(`退出码 ${code}，日志尾部：`)
    for (const line of logTail()) console.log(`    ${line}`)

    const fixed = repairTmpDirs([CACHE, OUT])

    // 这台机器上「文件刚写完就被立刻重新打开」也会偶发 UNKNOWN / EBUSY，
    // 和 rename 竞态是同一类瞬时占用：清掉半成品再重来通常就过了。
    const transient = /EPERM|EBUSY|ENOTEMPTY|EACCES|UNKNOWN|resource busy/i.test(logText())
    if (fixed === 0 && !transient) {
      log('没有发现被卡住的临时目录，也不像瞬时占用，不再重试。')
      process.exit(code || 1)
    }

    rmSync(join(OUT, 'win-unpacked'), { recursive: true, force: true, maxRetries: 5 })
    log(`收尾了 ${fixed} 个临时目录${transient ? '（日志里有瞬时占用特征）' : ''}，重跑一次。`)
  }

  log(`试了 ${MAX_ATTEMPTS} 次都没成功，日志在 ${LOG}`)
  process.exit(1)
}

await main()
