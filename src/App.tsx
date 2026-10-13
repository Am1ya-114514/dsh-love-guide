import { lazy, Suspense, useEffect } from 'react'
import { IconAlertTriangle, IconCircleCheck, IconInfoCircle, IconX } from '@tabler/icons-react'
import { AppSidebar } from './components/app-sidebar'
import { ConfirmDialog } from './components/confirm-dialog'
import { DialogueView } from './components/dialogue-view'
import { Topbar } from './components/topbar'
import { TooltipProvider } from './components/ui/tooltip'
import { bootStudio, useStudio } from './lib/store'
import { cn } from './lib/utils'

/**
 * 图表视图按需加载：ECharts 是本项目最重的一块依赖，而「对话」这个首屏根本用不到它。
 * 拆出去之后首屏只下载对话所需的代码，切到证据/记录页时再加载图表。
 */
const EvidenceView = lazy(() => import('./components/evidence-view').then((m) => ({ default: m.EvidenceView })))
const ChatLogView = lazy(() => import('./components/chatlog-view').then((m) => ({ default: m.ChatLogView })))
const KnowledgeView = lazy(() => import('./components/knowledge-view').then((m) => ({ default: m.KnowledgeView })))
const SettingsView = lazy(() => import('./components/settings-view').then((m) => ({ default: m.SettingsView })))

export default function App() {
  const ready = useStudio((s) => s.ready)
  const view = useStudio((s) => s.view)

  useEffect(() => {
    void bootStudio()
  }, [])

  return (
    <TooltipProvider>
      <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
        <AppSidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          {!ready ? (
            <Splash />
          ) : (
            <div className="min-h-0 flex-1">
              <Suspense fallback={<ViewLoading />}>
                {view === 'dialogue' && <DialogueView />}
                {view === 'evidence' && <EvidenceView />}
                {view === 'chatlog' && <ChatLogView />}
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
    <div className="pointer-events-none fixed top-4 right-4 z-100 flex w-[min(92vw,380px)] flex-col gap-2">
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
