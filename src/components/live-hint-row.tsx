/**
 * 侧栏底部的「实时建议」入口——桌面版才有。
 *
 * 悬浮窗平时是藏着的（Ctrl+Shift+L 也能叫出来），但没有这个入口，
 * 一个不记得快捷键的人就等于没有这个功能。这里显示它的开关状态，
 * 点一下叫出来，再点一下收回去。
 *
 * 网页版没有 `window.studioAPI`，这时整个组件不渲染。
 */
import { useCallback, useEffect, useState } from 'react'
import { IconEye } from '@tabler/icons-react'
import { cn } from '#/lib/utils'
import { studioBridge } from '#/lib/studio-bridge'

export function LiveHintRow() {
  const bridge = studioBridge()
  const [visible, setVisible] = useState(false)
  const [hotkey, setHotkey] = useState('Ctrl+Shift+L')

  useEffect(() => {
    if (!bridge) return
    let alive = true
    void bridge.overlayVisible().then((v) => {
      if (alive) setVisible(v)
    })
    void bridge.overlayHotkey().then((k) => {
      if (alive && k) setHotkey(k.replace(/Control/g, 'Ctrl'))
    })
    return () => {
      alive = false
    }
  }, [bridge])

  const onClick = useCallback(async () => {
    if (!bridge) return
    if (visible) {
      await bridge.hideOverlay()
      setVisible(false)
    } else {
      setVisible(await bridge.showOverlay())
    }
  }, [bridge, visible])

  if (!bridge) return null

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition hover:bg-sidebar-accent"
    >
      <IconEye className="size-4 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">实时建议</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {visible ? '已打开，可随时收起' : `盯住聊天窗口给回复 · ${hotkey}`}
        </span>
      </span>
      <span className={cn('size-2 rounded-full', visible ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
    </button>
  )
}
