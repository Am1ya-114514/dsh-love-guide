/**
 * ECharts 画在 canvas 上，`var(--x)` 这种字符串它认不了，必须拿到真实的颜色值。
 * 所以这里从 documentElement 的计算样式里把设计令牌读出来，并在暗色模式切换时失效重读。
 */

import { useSyncExternalStore } from 'react'

export interface Tokens {
  fg: string
  muted: string
  border: string
  card: string
  primary: string
  up: string
  down: string
  flat: string
  insufficient: string
  tiers: { strong: string; framework: string; popular: string; heuristic: string; insufficient: string }
}

const FALLBACK: Tokens = {
  fg: '#1a1a1a',
  muted: '#8a8a8a',
  border: '#e5e5e5',
  card: '#ffffff',
  primary: '#7c3aed',
  up: '#d1443c',
  down: '#2f9e6e',
  flat: '#8a8a8a',
  insufficient: '#a3a3a3',
  tiers: {
    strong: '#2563eb',
    framework: '#7c3aed',
    popular: '#d97706',
    heuristic: '#0d9488',
    insufficient: '#a3a3a3',
  },
}

function readVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function read(): Tokens {
  if (typeof window === 'undefined') return FALLBACK
  return {
    fg: readVar('--foreground', FALLBACK.fg),
    muted: readVar('--muted-foreground', FALLBACK.muted),
    border: readVar('--border', FALLBACK.border),
    card: readVar('--card', FALLBACK.card),
    primary: readVar('--primary', FALLBACK.primary),
    // 中文习惯：红涨绿跌。
    up: readVar('--chart-up', FALLBACK.up),
    down: readVar('--chart-down', FALLBACK.down),
    flat: readVar('--chart-flat', FALLBACK.flat),
    insufficient: readVar('--evidence-insufficient', FALLBACK.insufficient),
    tiers: {
      strong: readVar('--evidence-strong', FALLBACK.tiers.strong),
      framework: readVar('--evidence-framework', FALLBACK.tiers.framework),
      popular: readVar('--evidence-popular', FALLBACK.tiers.popular),
      heuristic: readVar('--evidence-heuristic', FALLBACK.tiers.heuristic),
      insufficient: readVar('--evidence-insufficient', FALLBACK.tiers.insufficient),
    },
  }
}

let cache: Tokens | null = null
const listeners = new Set<() => void>()

function invalidate() {
  cache = null
  for (const l of listeners) l()
}

if (typeof window !== 'undefined') {
  // 暗色模式是给 <html> 加 class 实现的，所以监听 class 变化即可。
  new MutationObserver(invalidate).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style'],
  })
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', invalidate)
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function getSnapshot(): Tokens {
  if (!cache) cache = read()
  return cache
}

export function useTokens(): Tokens {
  return useSyncExternalStore(subscribe, getSnapshot, () => FALLBACK)
}
