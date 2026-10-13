#!/usr/bin/env node
/**
 * 打 Android APK。
 *
 * 一次跑完四步：构建前端 → cap sync → gradle 打包 → 把 APK 抄到一个好找的位置。
 *
 * 工具链刻意全部放在 F 盘（用户的要求是「要下载安装的东西尽量别走 C 盘」）：
 *   JDK     F:\android-tools\jdk21
 *   SDK     F:\android-tools\android-sdk
 *   Gradle  F:\android-tools\gradle-home   ← 依赖缓存，跑一次就是几百 MB
 * 都能用环境变量覆盖（GTJS_JDK_HOME / ANDROID_HOME / GRADLE_USER_HOME）。
 *
 * 两个环境上的坑，写在这里免得下次再踩：
 *
 * 1. 这台机器 spawn 配 `stdio: 'pipe'` 会因为没有命名管道权限而报 EPERM，
 *    所以输出统一走文件描述符直写日志文件（和 make-installer.mjs 一个路子）。
 * 2. `gradlew` 是 .bat，Windows 上不能直接 spawn，得包一层 `cmd /c`。
 *
 * 用法：
 *   node scripts/make-apk.mjs              # debug APK，可直接装
 *   node scripts/make-apk.mjs --sync-only  # 只跑「构建 + cap sync」，不打包
 *   node scripts/make-apk.mjs --release    # release APK（需要先配好签名）
 *
 * 产物：<项目>/.runtime/apk/dsh-Love-Guide-<版本>-<变体>.apk
 */

import { spawn } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const RUNTIME = join(ROOT, '.runtime')
const LOG = join(RUNTIME, 'apk-build.log')
const ANDROID = join(ROOT, 'android')
const OUT = join(RUNTIME, 'apk')

const JDK = process.env.GTJS_JDK_HOME ?? 'F:\\android-tools\\jdk21\\jdk-21.0.12.1+1'
const SDK = process.env.ANDROID_HOME ?? 'F:\\android-tools\\android-sdk'
const GRADLE_HOME = process.env.GRADLE_USER_HOME ?? 'F:\\android-tools\\gradle-home'

const args = process.argv.slice(2)
const syncOnly = args.includes('--sync-only')
const variant = args.includes('--release') ? 'release' : 'debug'

function log(message) {
  console.log(`[apk] ${message}`)
}

function fail(message) {
  console.error(`[apk] ${message}`)
  process.exit(1)
}

function pkgVersion() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
}

/** 用进程内已有的 node 跑一个 .js 入口，输出直写日志。 */
function runNode(entry, argv, label) {
  return run(process.execPath, [entry, ...argv], label)
}

function run(command, argv, label, options = {}) {
  const fd = openSync(LOG, 'a')
  try {
    return new Promise((resolvePromise) => {
      const child = spawn(command, argv, {
        cwd: options.cwd ?? ROOT,
        // 不用管道：见文件头注释第 1 条。
        stdio: ['ignore', fd, fd],
        env: { ...process.env, ...options.env },
        windowsHide: true,
      })
      child.on('error', (error) => {
        log(`${label} 起不来：${error.message}`)
        resolvePromise(1)
      })
      child.on('close', (code) => resolvePromise(code ?? 1))
    })
  } finally {
    // spawn 已经把 fd 复制给子进程了，父进程这边可以立刻关。
    setTimeout(() => closeSync(fd), 0)
  }
}

function binPath(pkg, entry) {
  const dir = join(ROOT, 'node_modules', pkg)
  if (!existsSync(dir)) fail(`node_modules 里没有 ${pkg}，先跑一次 pnpm install`)
  return join(dir, entry)
}

async function main() {
  mkdirSync(RUNTIME, { recursive: true })
  mkdirSync(OUT, { recursive: true })

  // 每次覆盖日志，否则上一轮的报错会混进来误导排查。
  const reset = openSync(LOG, 'w')
  closeSync(reset)

  if (!existsSync(join(JDK, 'bin', 'java.exe'))) {
    fail(`找不到 JDK：${JDK}\n     （用 GTJS_JDK_HOME 指到别的 JDK 21 安装目录）`)
  }
  if (!existsSync(SDK)) {
    fail(`找不到 Android SDK：${SDK}\n     （用 ANDROID_HOME 指到别的 SDK 目录）`)
  }

  const env = {
    JAVA_HOME: JDK,
    ANDROID_HOME: SDK,
    ANDROID_SDK_ROOT: SDK,
    GRADLE_USER_HOME: GRADLE_HOME,
    PYTHONIOENCODING: 'utf-8',
  }

  log('1/4 构建前端产物')
  // 图标/启动图跟着前端构建一起刷新，免得改了源图忘了重新生成。
  let code = await run(
    process.execPath,
    [binPath('typescript', join('bin', 'tsc')), '-b'],
    'tsc',
    { env },
  )
  if (code !== 0) fail(`类型检查没过，细节见 ${LOG}`)
  code = await run(process.execPath, [binPath('vite', join('bin', 'vite.js')), 'build'], 'vite build', { env })
  if (code !== 0) fail(`前端构建失败，细节见 ${LOG}`)

  log('2/4 同步到 android/ 工程')
  code = await run(
    process.execPath,
    [binPath('@capacitor/cli', join('bin', 'capacitor')), 'sync', 'android'],
    'cap sync',
    { env },
  )
  if (code !== 0) fail(`cap sync 失败，细节见 ${LOG}`)

  if (syncOnly) {
    log('只做同步，到此为止。')
    return
  }

  if (!existsSync(join(ANDROID, 'gradlew.bat'))) {
    fail('android/ 里没有 gradlew.bat —— 先跑 `npx cap add android` 生成工程')
  }

  log(`3/4 gradle 打包（${variant}），第一次会下载 gradle 发行包与依赖，比较久`)
  const task = variant === 'release' ? 'assembleRelease' : 'assembleDebug'
  code = await run(
    'cmd.exe',
    ['/c', 'gradlew.bat', task, '--no-daemon', '--console=plain'],
    `gradle ${task}`,
    { cwd: ANDROID, env },
  )
  if (code !== 0) fail(`gradle 打包失败，细节见 ${LOG}`)

  log('4/4 收起产物')
  const built = join(ANDROID, 'app', 'build', 'outputs', 'apk', variant, `app-${variant}.apk`)
  if (!existsSync(built)) fail(`gradle 说成功了，但没找到 ${built}`)
  const target = join(OUT, `dsh-Love-Guide-${pkgVersion()}-${variant}.apk`)
  copyFileSync(built, target)
  const mb = (statSync(target).size / 1024 / 1024).toFixed(1)
  log(`APK：${target}（${mb} MB）`)
  log(`装到手机上：把这个文件传到手机、点开、允许「安装未知来源应用」。`)
}

main().catch((error) => {
  console.error(`[apk] 意外错误：${error?.stack ?? error}`)
  process.exit(1)
})
