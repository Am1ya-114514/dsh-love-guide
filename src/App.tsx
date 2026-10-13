import { lazy, Suspense, useEffect, useState } from 'react'
import { IconAlertTriangle, IconCircleCheck, IconInfoCircle, IconX } from '@tabler/icons-react'
import { AppSidebar } from './components/app-sidebar'
import { ConfirmDialog } from './components/confirm-dialog'
import { DialogueView } from './components/dialogue-view'
import { Topbar } from './components/topbar'
import { Sheet, SheetContent, SheetTitle } from './components/ui/sheet'
import { TooltipProvider } from './components/ui/tooltip'
import { bootStudio, useStudio } from './lib/store'
import { cn } from './lib/utils'

/**
 * 图表视图按需加载：ECharts 是本项目最重的一块依赖，而「对话」这个首屏根本用不到它。
 * 拆出去之后首屏只下载对话所需的代码，切到证据/记录页时再加载图表。
 */
const EvidenceView = lazy(() => import('./components/evidence-view').then((m) => ({ default: m.EvidenceView })))
const ChatLogView = lazy(() => import('./components/chatlog-view').then((m) => ({ default: m.ChatLogView })))
const SimView = lazy(() => import('./components/sim-view').then((m) => ({ default: m.SimView })))
const KnowledgeView = lazy(() => import('./components/knowledge-view').then((m) => ({ default: m.KnowledgeView })))
const SettingsView = lazy(() => import('./components/settings-view').then((m) => ({ default: m.SettingsView })))

export default function App() {
  const ready = useStudio((s) => s.ready)
  const view = useStudio((s) => s.view)
  const setView = useStudio((s) => s.setView)
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => {
    void bootStudio()
  }, [])

  // 悬浮窗上点「设置」时，主进程会把主窗口唤到前台并推一个目标视图过来。
  // 设置页是模型连接、人格、数据边界的唯一入口，悬浮窗不再复制一套。
  useEffect(() => {
    const bridge = window.studioAPI
    if (!bridge?.onGoto) return
    return bridge.onGoto((target) => {
      if (target === 'settings') setView('settings')
    })
  }, [setView])

  return (
    <TooltipProvider>
      <div className="app-shell flex w-full overflow-hidden bg-background text-foreground">
        {/*
          桌面（lg 及以上）常驻侧栏；窄屏收进抽屉。
          这里用 `hidden lg:block` 的包装层而不是给 aside 加 `hidden`：
          两个 display 工具类同时命中一个元素时，谁生效取决于生成 CSS 的先后，
          不可靠；分成两层就没有这个歧义。
        */}
        <div className="hidden h-full shrink-0 lg:block">
          <AppSidebar />
        </div>

        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" className="w-[268px] gap-0 p-0">
            <SheetTitle className="sr-only">导航</SheetTitle>
            <AppSidebar onNavigate={() => setNavOpen(false)} />
          </SheetContent>
        </Sheet>

        <main className="flex min-w-0 flex-1 flex-col">
          <Topbar onOpenNav={() => setNavOpen(true)} />
          {!ready ? (
            <Splash />
          ) : (
            <div className="min-h-0 flex-1">
              <Suspense fallback={<ViewLoading />}>
                {view === 'dialogue' && <DialogueView />}
                {view === 'evidence' && <EvidenceView />}
                {view === 'chatlog' && <ChatLogView />}
                {view === 'sim' && <SimView />}
                {view === 'knowledge' && <KnowledgeView />}
                {view === 'settings' && <SettingsView />}
              </Suspense>
            </div>
          )}
        </main>
      </div>
      <ToastStack />
      <ConfirmDialog />
    </TooltipProvider>
  )
}

function Splash() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="space-y-2 text-center">
        <div className="mx-auto size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <p className="text-sm text-muted-foreground">正在打开本地数据库…</p>
      </div>
    </div>
  )
}

function ViewLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="space-y-2 text-center">
        <div className="mx-auto size-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <p className="text-xs text-muted-foreground">正在加载视图…</p>
      </div>
    </div>
  )
}

function ToastStack() {
  const toasts = useStudio((s) => s.toasts)
  const dismiss = useStudio((s) => s.dismissToast)

  return (
    <div className="safe-pad pointer-events-none fixed top-4 right-4 z-100 flex w-[min(92vw,380px)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-popover p-3 text-sm shadow-lg',
            t.kind === 'err' && 'border-destructive/40',
            t.kind === 'warn' && 'border-amber-500/40',
          )}
        >
          <span
            className={cn(
              'mt-0.5 shrink-0',
              t.kind === 'ok' && 'text-emerald-600',
              t.kind === 'warn' && 'text-amber-600',
              t.kind === 'err' && 'text-destructive',
            )}
          >
            {t.kind === 'ok' ? (
              <IconCircleCheck className="size-4" />
            ) : t.kind === 'warn' ? (
              <IconAlertTriangle className="size-4" />
            ) : (
              <IconInfoCircle className="size-4" />
            )}
          </span>
          <p className="min-w-0 flex-1 leading-relaxed break-words whitespace-pre-wrap">{t.text}</p>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="关闭"
          >
            <IconX className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
