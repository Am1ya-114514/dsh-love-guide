import brand from '#/assets/brand.png'
import { cn } from '#/lib/utils'

/**
 * 军师的头像。用应用图标本身（src/assets/brand.png，由 build/make-icon.py 从
 * build/icon-source.webp 生成），这样对话里的身份和 exe 图标、侧栏标记是同一个。
 * 用户头像仍走图标字体（IconUser），因为那代表"人"，不该用产品图标。
 */
export function AgentAvatar({ className }: { className?: string }) {
  return (
    <img
      src={brand}
      alt=""
      aria-hidden
      className={cn('size-7 shrink-0 rounded-lg object-cover ring-1 ring-border/70', className)}
    />
  )
}
