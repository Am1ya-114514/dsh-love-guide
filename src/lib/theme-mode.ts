/**
 * 明暗主题。
 *
 * 这里刻意没有用 next-themes：它为了避免首屏闪烁会在页面里注入一段内联
 * <script>，而本程序给生产构建配了 `script-src 'self'` 的 CSP——内联脚本会被
 * 直接拦掉，主题反而失效。
 *
 * 所以走一条更笨但更可靠的路：localStorage 是同步可读的，initTheme() 在
 * createRoot().render() 之前调用，等 React 开始渲染时 <html> 上的 class 已经就位，
 * 既不需要内联脚本，也不会闪烁。
 */

import { useSyncExternalStore } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'gtjs.theme-mode'
const listeners = new Set<() => void>()

function readStored(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // 隐私模式下 localStorage 可能不可写，按「跟随系统」处理
  }
  return 'system'
}

let current: ThemeMode = 'system'

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  return mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode
}

/** 把主题写到 <html> 上。ECharts 的配色也靠读取这里的 CSS 变量。 */
export function applyTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode)
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  // data-theme 兼任两个职责：告诉 CSS「JS 已经跑过了」，以及给原生控件定色。
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
}

/** 在渲染之前调用一次。 */
export function initTheme() {
  current = readStored()
  applyTheme(current)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (current === 'system') applyTheme('system')
  })
}

export function setThemeMode(mode: ThemeMode) {
  current = mode
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // 存不进去也不影响本次会话
  }
  applyTheme(mode)
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useThemeMode(): [ThemeMode, (m: ThemeMode) => void] {
  const mode = useSyncExternalStore(
    subscribe,
    () => current,
    () => 'system' as ThemeMode,
  )
  return [mode, setThemeMode]
}
