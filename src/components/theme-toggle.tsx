import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react'
import { useThemeMode, type ThemeMode } from '#/lib/theme-mode'
import { cn } from '#/lib/utils'

const ORDER: ThemeMode[] = ['light', 'dark', 'system']

const META: Record<ThemeMode, { label: string; hint: string; Icon: typeof IconSun }> = {
  light: { label: '浅色', hint: '白天或亮屏环境', Icon: IconSun },
  dark: { label: '深色', hint: '夜间或长时间阅读', Icon: IconMoon },
  system: { label: '跟随系统', hint: '按操作系统的偏好自动切换', Icon: IconDeviceDesktop },
}

/** 侧栏底部的主题切换：点一下在 浅色 → 深色 → 跟随系统 之间循环。 */
export function ThemeToggle() {
  const [mode, setMode] = useThemeMode()
  const { label, hint, Icon } = META[mode]

  return (
    <button
      type="button"
      onClick={() => setMode(ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length])}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition hover:bg-sidebar-accent"
      aria-label={`切换外观，当前为${label}`}
    >
      <Icon className="size-4 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
      </span>
      <span className={cn('size-2 rounded-full', mode === 'system' ? 'bg-muted-foreground/40' : 'bg-primary')} />
    </button>
  )
}
