/** 通用小工具。UI 层用到的 `cn` 直接来自 `cn` 包（shadcn base-nova 预设的约定）。 */
export { cn } from 'cn'

/** 本地 id：不需要全局唯一，只要在同一浏览器里不撞。 */
export function uid(prefix = ''): string {
  const rnd = crypto.getRandomValues(new Uint8Array(8))
  const hex = [...rnd].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${prefix}${Date.now().toString(36)}${hex}`
}

/** 把任意时间输入规整成 `YYYY-MM-DD`；解析不出来返回空串。 */
export function toDateKey(input: string | number | Date | undefined | null): string {
  if (input === undefined || input === null || input === '') return ''
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) {
    // 兼容 2026/8/2、2026.8.2、20260802 这类写法
    const s = String(input).trim()
    const m = s.match(/^(\d{4})[-/.年]?(\d{1,2})[-/.月]?(\d{1,2})/)
    if (!m) return ''
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  }
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** 复制到剪贴板，失败时退回 textarea 方案（http 非 localhost 下 clipboard API 不可用）。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}
