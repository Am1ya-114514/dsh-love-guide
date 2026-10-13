#!/usr/bin/env node
/**
 * 打「绿色版」Windows 桌面程序（解压即用、不用安装）。
 *
 * 为什么从 @electron/packager 换成 electron-builder：
 *
 * 原来用 @electron/packager，它解压完 Electron 之后会做一次
 * `rename(win32-x64-template-XXXX, tmp-YYYY)`，这台机器上这一步会偶发
 * EPERM: operation not permitted（errno -4048）——是瞬时句柄占用，等几秒手动搬就成功，
 * 但 packager 不给重试机会，而且目标名是它随机生成的，外部没法替它搬。
 * 失败一次就要重新解压几百 MB。
 *
 * 而安装包那条线（scripts/make-installer.mjs）用的是 electron-builder，它有
 * `electronDist: node_modules/electron/dist` 这条配置，直接复制已经解压好的 Electron，
 * 完全不碰那个 rename。于是绿色版也走同一条路：`electron-builder --win --dir` 产出
 * win-unpacked，再把它搬到目标目录。
 *
 * 这里保留 make-installer.mjs 那套「失败后收尾卡住的临时目录再重试」的手法。
 * 两份脚本的辅助函数是刻意重复的：抽公共模块的收益，抵不上现在改坏一个能用的脚本的风险。
 *
 * 用法：node scripts/make-portable.mjs
 * 产物：<项目>/../../dsh-Love-Guide（可用 GTJS_APP_OUT 覆盖）
 */

import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const RUNTIME = join(ROOT, '.runtime')
const LOG = join(RUNTIME, 'portable-build.log')
const WORK_OUT = join(RUNTIME, 'portable-out')
// 默认落在项目上两级：F:\projects\goutoujunshi-studio -> F:\dsh-Love-Guide
const OUT = process.env.GTJS_APP_OUT ? resolve(process.env.GTJS_APP_OUT) : resolve(ROOT, '..', '..', 'dsh-Love-Guide')
const CACHE = process.env.ELECTRON_BUILDER_CACHE ?? join(RUNTIME, 'electron-builder-cache')
const ELECTRON_CACHE = process.env.ELECTRON_CACHE ?? join(RUNTIME, 'electron-cache')
/** 用户数据目录名。打包会覆盖目标目录，所以先把它们挪出来，打完再放回去。 */
const DATA_DIR_NAMES = ['dsh-love-guide-data', 'goutoujunshi-data']
/** 数据暂存区。规矩：里面有东西就永远先归位，绝不先删（见 reclaimStashIfAny）。 */
const STASH = join(RUNTIME, 'data-stash')
const MAX_ATTEMPTS = 4

const log = (m) => console.log(`[portable] ${m}`)
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

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

/** 把没搬完的 *.tmp 目录收尾，返回修好的数量。 */
function repairTmpDirs(roots) {
  let fixed = 0
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const dir of walkDirs(root, 2)) {
      if (!dir.endsWith('.tmp')) continue
      const target = dir.slice(0, -'.tmp'.length)
      if (existsSync(target)) {
        rmSync(dir, { recursive: true, force: true })
        fixed += 1
        continue
      }
      if (renameWithRetry(dir, target)) {
        log(`接管搬移：${dir} -> ${target}`)
        fixed += 1
      }
    }
  }
  return fixed
}

function builderCli() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'electron-builder', 'package.json'), 'utf8'))
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['electron-builder']
  if (!bin) throw new Error('electron-builder 的 package.json 里没有 bin 字段')
  return join(ROOT, 'node_modules', 'electron-builder', bin)
}

function runOnce(cli) {
  const env = {
    ...process.env,
    ELECTRON_BUILDER_CACHE: CACHE,
    ELECTRON_CACHE,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  }
  // 这个会话里带着 ELECTRON_RUN_AS_NODE=1，会让 electron 退化成普通 node。
  delete env.ELECTRON_RUN_AS_NODE

  const fd = openSync(LOG, 'w')
  try {
    // --dir：只产出 win-unpacked，不做安装包。输出用文件描述符写日志，
    // 不用管道（这个环境里 stdio: 'pipe' 会因没有命名管道权限报 EPERM）。
    // `-c.directories.output` 覆盖 electron-builder.yml 里给安装包用的输出目录：
    // 绿色版必须落在 WORK_OUT，否则会和安装包的构建目录互相踩。
    return spawn(
      process.execPath,
      [
        cli,
        '--win',
        '--dir',
        '--config',
        'electron-builder.yml',
        `-c.directories.output=${WORK_OUT}`,
      ],
      {
        cwd: ROOT,
        env,
        stdio: ['ignore', fd, fd],
      },
    )
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

function stashDataDirs() {
  const stash = STASH
  mkdirSync(stash, { recursive: true })
  const moved = []
  for (const name of DATA_DIR_NAMES) {
    const from = join(OUT, name)
    if (!existsSync(from)) continue
    renameSync(from, join(stash, name))
    moved.push(name)
    log(`先把 ${name} 挪出来，打完再放回去`)
  }
  return moved
}

function restoreDataDirs(moved) {
  if (moved.length === 0) return
  const stash = STASH
  for (const name of moved) {
    const from = join(stash, name)
    if (!existsSync(from)) {
      log(`警告：暂存区里的 ${name} 不见了，无法放回`)
      process.exitCode = 1
      continue
    }
    const to = join(OUT, name)
    // 目标目录刚被整体重建过，正常不会有重名；真撞上了就改名并存，绝不删任何一份。
    if (existsSync(to)) {
      const kept = `${to}.incoming`
      renameSync(from, kept)
      log(`目标已存在 ${name}，这一份留在 ${kept}，两份都保留`)
      process.exitCode = 1
      continue
    }
    mkdirSync(OUT, { recursive: true })
    renameSync(from, to)
    log(`已放回 ${name}`)
  }
  const left = existsSync(stash) ? readdirSync(stash) : []
  if (left.length === 0) rmSync(stash, { recursive: true, force: true })
  else log(`暂存区仍有 ${left.join(', ')}，保留 ${stash}`)
}

/**
 * 上一轮如果没来得及放回用户数据（例如进程被强杀、或旧版本用 process.exit 硬退出
 * 跳过了 finally），先把暂存区里的东西原样搬回 OUT，再继续。
 *
 * 这一条是踩过坑加的：早先的版本在进入暂存流程时会无条件 `rmSync(STASH)`，
 * 于是「上一轮遗留在暂存区里的用户数据」会被这一轮的清理动作直接删掉。
 * 现在的规矩是——**暂存区里只要有东西，就永远先归位，绝不先删**。
 */
function reclaimStashIfAny() {
  if (!existsSync(STASH)) return
  let reclaimed = 0
  for (const name of DATA_DIR_NAMES) {
    const from = join(STASH, name)
    if (!existsSync(from)) continue
    const to = join(OUT, name)
    // 两边都有：说明上一轮在这里躺着一份、而 OUT 里又新生成了一份。
    // 哪一份都不是能随便删的东西，所以什么都不动，直接停下让人来看。
    if (existsSync(to)) {
      log(`暂存区与目标目录里各有一份 ${name}，两边都不动。请人工确认后再跑。`)
      log(`  暂存：${from}`)
      log(`  目标：${to}`)
      process.exitCode = 1
      throw new Error(`both stash and output contain ${name}`)
    }
    renameSync(from, to)
    reclaimed += 1
    log(`发现上一轮遗留的用户数据，已归位：${name}`)
  }
  const left = readdirSync(STASH)
  if (left.length === 0) {
    rmSync(STASH, { recursive: true, force: true })
  } else {
    log(`暂存区还有 ${left.length} 项不是用户数据，保留 ${STASH}`)
  }
  if (reclaimed > 0) log(`归位了 ${reclaimed} 个数据目录`)
}

/** 只有确认这是本程序的输出目录，才允许整目录删除。 */
function assertLooksLikeAppDir() {
  if (!existsSync(OUT)) return
  const entries = readdirSync(OUT)
  if (entries.length === 0) return
  const mine = entries.some((n) => n === 'dsh-love-guide.exe' || n === 'resources' || n === 'locales')
  if (!mine) {
    log(`拒绝删除 ${OUT}：里面的内容不像本程序的产物（${entries.slice(0, 5).join(', ')}…）`)
    process.exitCode = 1
    throw new Error('output directory does not look like our app')
  }
}

function countFiles(dir) {
  let n = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1
  }
  return n
}

async function main() {
  const cli = builderCli()
  log(`electron-builder 入口 ${cli}`)
  log(`工作目录 ${WORK_OUT}`)
  log(`输出目录 ${OUT}`)

  // 先把上一轮可能遗留的用户数据归位，再决定这一轮要暂存什么。
  reclaimStashIfAny()
  assertLooksLikeAppDir()

  const stashed = stashDataDirs()

  try {
    let unpacked = null
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      rmSync(WORK_OUT, { recursive: true, force: true, maxRetries: 5 })
      log(`第 ${attempt} 次尝试…`)
      const child = runOnce(cli)
      const code = await new Promise((done) => child.on('close', done))
      const candidate = join(WORK_OUT, 'win-unpacked')
      if (code === 0 && existsSync(candidate)) {
        unpacked = candidate
        break
      }

      log(`退出码 ${code}，日志尾部：`)
      for (const line of logText().trimEnd().split(/\r?\n/).slice(-20)) console.log(`    ${line}`)

      const fixed = repairTmpDirs([CACHE, WORK_OUT])
      const transient = /EPERM|EBUSY|ENOTEMPTY|EACCES|UNKNOWN|resource busy/i.test(logText())
      if (fixed === 0 && !transient) {
        log('没有卡住的临时目录，也不像瞬时占用，不再重试。')
        // 注意：这里不能用 process.exit()——那会跳过下面的 finally，
        // 把用户数据留在暂存区。改成设置退出码后抛错，让 finally 一定跑到。
        process.exitCode = code || 1
        throw new Error('builder failed without a transient error signature')
      }
      log(`收尾了 ${fixed} 个临时目录，重跑一次。`)
    }

    if (!unpacked) {
      log(`试了 ${MAX_ATTEMPTS} 次都没成功，日志在 ${LOG}`)
      process.exitCode = 1
      throw new Error('all build attempts failed')
    }

    // 搬到目标目录。目标可能正被运行中的程序占着，所以这里也重试。
    rmSync(OUT, { recursive: true, force: true, maxRetries: 6 })
    mkdirSync(OUT, { recursive: true })
    for (const entry of readdirSync(unpacked)) {
      const from = join(unpacked, entry)
      const to = join(OUT, entry)
      if (!renameWithRetry(from, to)) {
        log(`搬不动 ${entry}，可能程序还在运行`)
        process.exitCode = 1
        throw new Error(`cannot move ${entry}`)
      }
    }

    const exe = join(OUT, 'dsh-love-guide.exe')
    log(`打包成功：${OUT}`)
    log(`  exe ${existsSync(exe) ? '已生成' : '缺失！'}`)
    log(`  文件数 ${countFiles(OUT)}`)
  } finally {
    restoreDataDirs(stashed)
  }
}

await main().catch((error) => {
  log(`失败：${error?.message ?? error}`)
  process.exitCode = process.exitCode || 1
})
