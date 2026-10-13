/**
 * 把已经构建好的 dist/ 包成一个 Windows 桌面程序。
 *
 * 为什么要「暂存目录 + 单独打包」而不是直接打包整个仓库：
 *   前端已经被 Vite 打成 dist/ 了，运行时一个 node_modules 都不需要。
 *   直接对仓库跑 electron-packager 会把 src/、knowledge/、docs/ 和
 *   几百兆的开发依赖一起塞进去——既慢又会让产物从 300MB 涨到 1GB。
 *   这里先组一个只含必要文件的小目录，再对它打包。
 *
 * 用法：
 *   pnpm run app:pack          # 需要先 pnpm build
 *   pnpm run app:pack -- --keep # 保留暂存目录，方便排查
 */
import { mkdirSync, rmSync, cpSync, renameSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const STAGE = resolve(ROOT, '.runtime', 'app')
const OUT = process.env.GTJS_APP_OUT ? resolve(process.env.GTJS_APP_OUT) : resolve(ROOT, '..', '..', 'dsh-Love-Guide')
const APP_NAME = 'dsh-love-guide'
// 用户的档案都在 exe 同级的这个目录里。重新打包会整目录覆盖 OUT，
// 所以每次先把它们挪到一边、打完再放回去——否则升级一次就丢一次数据。
const DATA_DIR_NAMES = ['dsh-love-guide-data', 'goutoujunshi-data']
const keepStage = process.argv.includes('--keep')

// electron-packager 会把一份完整的 Electron（约 400MB）解压到 os.tmpdir()，
// 默认就是 C 盘，而且刚解压完立刻 rename 很容易被 Defender 抢到句柄，
// 报 `EPERM: operation not permitted, rename ...`。这两件事一起解决：
// 把临时目录挪到项目所在盘，并在 import 之前设好（packager 会读 os.tmpdir()）。
const TMP = process.env.GTJS_TMP ? resolve(process.env.GTJS_TMP) : resolve(ROOT, '.runtime', 'tmp')
mkdirSync(TMP, { recursive: true })
process.env.TEMP = TMP
process.env.TMP = TMP
process.env.TMPDIR = TMP
if (!process.env.ELECTRON_CACHE) process.env.ELECTRON_CACHE = resolve(ROOT, '.runtime', 'electron-cache')

const { packager } = await import('@electron/packager')

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

function fail(msg) {
  console.error(`\n[pack] ${msg}\n`)
  process.exit(1)
}

function stage() {
  const dist = join(ROOT, 'dist')
  if (!existsSync(join(dist, 'index.html'))) {
    fail('没有找到 dist/index.html。先跑 pnpm build。')
  }
  const icon = join(ROOT, 'build', 'icon.ico')
  if (!existsSync(icon)) fail(`没有找到图标 ${icon}。跑 python build/make-icon.py 生成。`)

  rmSync(STAGE, { recursive: true, force: true })
  mkdirSync(join(STAGE, 'electron'), { recursive: true })
  mkdirSync(join(STAGE, 'build'), { recursive: true })
  cpSync(dist, join(STAGE, 'dist'), { recursive: true })
  cpSync(join(ROOT, 'electron', 'main.cjs'), join(STAGE, 'electron', 'main.cjs'))
  cpSync(icon, join(STAGE, 'build', 'icon.ico'))

  // 暂存用的 package.json 刻意不写 dependencies：产物里不需要任何运行时依赖，
  // 写了反而会让 packager 去找 node_modules。
  writeFileSync(
    join(STAGE, 'package.json'),
    JSON.stringify(
      {
        name: APP_NAME,
        productName: 'dsh-Love Guide',
        version: pkg.version,
        description: '把关系决策方法论做成独立可运行的本地程序',
        main: 'electron/main.cjs',
      },
      null,
      2,
    ) + '\n',
  )

  console.log(`[pack] 暂存目录就绪：${STAGE}`)
  console.log(`[pack]   dist=${countFiles(join(STAGE, 'dist'))} 个文件`)
}

function countFiles(dir) {
  let n = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1
  }
  return n
}

// 先打到自己盘上的工作目录，成功后再搬到 OUT。
// 这样 packager 最后那步 rename 的落点也在项目盘上，跨盘复制只在必要时发生。
const WORK_OUT = resolve(ROOT, '.runtime', 'pack-out')
const EXPECTED = join(WORK_OUT, `${APP_NAME}-win32-x64`)

async function packOnce() {
  rmSync(WORK_OUT, { recursive: true, force: true })
  mkdirSync(WORK_OUT, { recursive: true })
  return packager({
    dir: STAGE,
    name: APP_NAME,
    platform: 'win32',
    arch: 'x64',
    out: WORK_OUT,
    overwrite: true,
    asar: true,
    icon: join(STAGE, 'build', 'icon.ico'),
    appVersion: pkg.version,
    prune: false,
    // 图标单独放 resources/ 下，不进 asar
    extraResource: [join(STAGE, 'build', 'icon.ico')],
    win32metadata: {
      CompanyName: 'dsh-Love Guide',
      FileDescription: 'dsh-Love Guide —— 关系决策实验室',
      ProductName: 'dsh-Love Guide',
      OriginalFilename: `${APP_NAME}.exe`,
      InternalName: APP_NAME,
    },
    quiet: false,
  })
}

/**
 * packager 把 Electron 解压好之后，最后一步是 rename 到输出目录。这一步在
 * Windows 上偶尔报 EPERM（刚写完的几百兆文件还会被索引/扫描类的东西握一小会儿
 * 句柄）。重跑一次要再解压 400MB，太亏——它其实已经把东西准备好了，只是没搬过去。
 * 所以这里不再重试，而是等一会儿，自己把那个 tmp 目录搬到位。
 */
async function recoverFromRenameRace() {
  const tmpRoot = join(TMP, 'electron-packager')
  if (!existsSync(tmpRoot)) return false
  const candidates = readdirSync(tmpRoot).filter((n) => n.startsWith('tmp-'))
  if (candidates.length === 0) return false

  console.warn(`[pack] packager 最后一步 rename 被占用挡住了；已解压好的目录还在，等它放手后自己搬。`)
  for (let round = 1; round <= 20; round++) {
    await sleep(3000)
    for (const name of candidates) {
      const from = join(tmpRoot, name)
      if (!existsSync(from)) continue
      try {
        await renameWithRetry(from, EXPECTED)
        console.log(`[pack] 已接管搬移（第 ${round} 轮）：${name} → ${EXPECTED}`)
        return true
      } catch {
        // 还没放手，继续等
      }
    }
    if (existsSync(join(EXPECTED, `${APP_NAME}.exe`))) return true
  }
  return false
}

/** rename 在同一卷上是瞬时的；失败且跨卷时才退回递归复制。 */
async function renameWithRetry(from, to) {
  let lastErr
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(to, { recursive: true, force: true })
      renameSync(from, to)
      return
    } catch (err) {
      lastErr = err
      await sleep(1200)
    }
  }
  // rename 实在不行就复制过去（跨盘时会走到这里）
  try {
    cpSync(from, to, { recursive: true, force: true })
    rmSync(from, { recursive: true, force: true })
    return
  } catch {
    throw lastErr
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 把 OUT 里的用户数据目录挪到暂存区，返回挪过哪些。 */
function stashDataDirs() {
  const stash = resolve(ROOT, '.runtime', 'data-stash')
  rmSync(stash, { recursive: true, force: true })
  const moved = []
  for (const name of DATA_DIR_NAMES) {
    const from = join(OUT, name)
    if (!existsSync(from)) continue
    mkdirSync(stash, { recursive: true })
    renameSync(from, join(stash, name))
    moved.push(name)
    console.log(`[pack] 先把 ${name} 挪出来，打完再放回去`)
  }
  return moved
}

/** 把暂存的用户数据放回 OUT。 */
function restoreDataDirs(moved) {
  if (moved.length === 0) return
  const stash = resolve(ROOT, '.runtime', 'data-stash')
  for (const name of moved) {
    const to = join(OUT, name)
    rmSync(to, { recursive: true, force: true })
    renameSync(join(stash, name), to)
    console.log(`[pack] 已放回 ${name}`)
  }
  rmSync(stash, { recursive: true, force: true })
}

async function main() {
  stage()
  console.log(`[pack] 临时目录：${TMP}`)
  console.log(`[pack] 工作目录：${WORK_OUT}`)
  console.log(`[pack] 输出目录：${OUT}`)

  let exeDir = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const paths = await packOnce()
      exeDir = paths[0]
      break
    } catch (err) {
      const transient = err && (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'ENOTEMPTY')
      console.warn(`[pack] 第 ${attempt} 次打包失败（${err.code}）：${err.message}`)
      if (!transient) throw err
      if (await recoverFromRenameRace()) {
        exeDir = EXPECTED
        break
      }
      if (attempt === 2) throw err
      console.warn('[pack] 没能接管，清干净重来一次……')
      rmSync(TMP, { recursive: true, force: true })
      mkdirSync(TMP, { recursive: true })
    }
  }

  if (!exeDir) throw new Error('打包结束但没有拿到产物目录')
  if (!existsSync(join(exeDir, `${APP_NAME}.exe`))) {
    throw new Error(`产物目录里没有 ${APP_NAME}.exe：${exeDir}`)
  }

  // 搬到用户要的位置。产物直接铺在 OUT 下（不再套一层 xxx-win32-x64），
  // 这样双击的那个 exe 就在文件夹第一层，找起来不绕。
  const finalDir = OUT
  const stashed = stashDataDirs()
  if (resolve(exeDir) !== resolve(finalDir)) {
    if (existsSync(finalDir)) rmSync(finalDir, { recursive: true, force: true })
    mkdirSync(OUT, { recursive: true })
    console.log(`[pack] 搬到输出目录……`)
    await renameWithRetry(exeDir, finalDir)
  }
  restoreDataDirs(stashed)

  console.log(`\n[pack] 完成：${finalDir}`)
  console.log(`[pack] 可执行文件：${join(finalDir, `${APP_NAME}.exe`)}`)

  if (!keepStage) {
    rmSync(STAGE, { recursive: true, force: true })
    rmSync(WORK_OUT, { recursive: true, force: true })
    console.log('[pack] 已清理暂存目录')
  }
}

main().catch((err) => {
  console.error('\n[pack] 打包失败：')
  console.error(err)
  process.exit(1)
})
