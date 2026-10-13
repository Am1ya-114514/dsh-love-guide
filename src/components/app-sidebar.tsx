import { useState } from 'react'
import {
  IconBook2,
  IconChartCandle,
  IconMessages,
  IconPlus,
  IconSettings,
  IconSparkles,
  IconArchive,
  IconArchiveOff,
  IconTrash,
  IconDots,
  IconAdjustments,
  IconDeviceDesktopAnalytics,
} from '@tabler/icons-react'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { ScrollArea } from '#/components/ui/scroll-area'
import { Separator } from '#/components/ui/separator'
import {
  MAX_REALMS,
  PUBLIC_CASES,
  providerLabel,
  selectAiConfigured,
  useStudio,
  type PublicCaseId,
  type WorkspaceView,
} from '#/lib/store'
import { cn } from '#/lib/utils'
import { AiSettingsDialog } from './ai-settings-dialog'
import { NewRealmDialog } from './realm-editor'
import { ThemeToggle } from './theme-toggle'

const NAV: { id: WorkspaceView; label: string; icon: typeof IconMessages }[] = [
  { id: 'dialogue', label: '对话', icon: IconMessages },
  { id: 'evidence', label: '关系进展', icon: IconChartCandle },
  { id: 'chatlog', label: '聊天记录', icon: IconDeviceDesktopAnalytics },
  { id: 'knowledge', label: '知识库', icon: IconBook2 },
]


export function AppSidebar() {
  const [creating, setCreating] = useState(false)
  const realms = useStudio((s) => s.realms)
  const activeRealmId = useStudio((s) => s.activeRealmId)
  const view = useStudio((s) => s.view)
  const setView = useStudio((s) => s.setView)
  const selectRealm = useStudio((s) => s.selectRealm)
  const setArchived = useStudio((s) => s.setArchived)
  const deleteRealm = useStudio((s) => s.deleteRealm)
  const applyPublicCase = useStudio((s) => s.applyPublicCase)
  const askConfirm = useStudio((s) => s.askConfirm)
  const toast = useStudio((s) => s.toast)
  const ai = useStudio((s) => s.ai)
  const configured = useStudio(selectAiConfigured)

  const active = realms.filter((r) => !r.archived)
  const archived = realms.filter((r) => r.archived)

  const handleCreate = async () => {
    if (active.length >= MAX_REALMS) {
      toast('warn', `最多同时保留 ${MAX_REALMS} 个档案（上游 skill 的上限）。先归档一个，或删掉不再需要的。`)
      return
    }
    setCreating(true)
  }

  const handleArchive = async () => {
    const r = realms.find((x) => x.id === activeRealmId)
    if (!r) return
    const ok = await askConfirm({
      title: `归档「${r.name}」？`,
      body: '归档不会删除任何数据：对话、证据、档案字段都原样保留，可以随时从「已归档」里恢复。',
      confirmLabel: '归档',
    })
    if (ok) await setArchived(r.id, true)
  }

  const handleDelete = async () => {
    const r = realms.find((x) => x.id === activeRealmId)
    if (!r) return
    const ok = await askConfirm({
      title: `彻底删除「${r.name}」？`,
      body: '这会连它的聊天记录、证据、档案字段一起删掉，无法撤销。\n\n如果只是暂时不想看，请改用「归档当前档案」。',
      confirmLabel: '彻底删除',
      destructive: true,
    })
    if (!ok) return
    await deleteRealm(r.id)
    toast('warn', '档案及其全部数据已删除。')
  }

  return (
    <aside className="flex h-full w-[268px] shrink-0 flex-col gap-3 border-r bg-sidebar p-3">
      <div className="flex items-center gap-2 px-1 pt-1">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <IconSparkles className="size-4.5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">狗头军师工作室</p>
          <p className="truncate text-[11px] text-muted-foreground">Evidence → Decision → Observation</p>
        </div>
      </div>

      <Button
        variant="outline"
        className="w-full justify-start gap-2 border-dashed"
        onClick={handleCreate}
      >
        <IconPlus className="size-4" />
        建立关系档案
        <span className="ml-auto text-[11px] text-muted-foreground">
          {active.length}/{MAX_REALMS}
        </span>
      </Button>

      <div className="min-h-0 flex-1">
        <ScrollArea className="h-full pr-1">
          <div className="space-y-1">
            <p className="px-2 pt-1 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground">
              关系档案
            </p>
            {active.length === 0 && (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                还没有档案。点上面的按钮建一个，或先载入下面任一公开案例看流程。
              </p>
            )}
            {active.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => selectRealm(r.id)}
                className={cn(
                  'w-full rounded-lg px-2 py-2 text-left transition',
                  'hover:bg-sidebar-accent',
                  activeRealmId === r.id && 'bg-sidebar-accent ring-1 ring-sidebar-border',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/12 text-xs font-semibold text-primary">
                    {r.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
                  {r.temporary && <Badge variant="secondary" className="h-4 px-1 text-[10px]">临时</Badge>}
                </div>
                {r.profile.subjectiveScore > 0 && (
                  <p className="mt-1 pl-8 text-[11px] text-muted-foreground">
                    主观评分 {r.profile.subjectiveScore}/10
                  </p>
                )}
              </button>
            ))}

            {archived.length > 0 && (
              <>
                <p className="px-2 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground">
                  已归档
                </p>
                {archived.map((r) => (
                  <div key={r.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => selectRealm(r.id)}
                      className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-sidebar-accent"
                    >
                      {r.name}
                    </button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      title="恢复"
                      onClick={() => setArchived(r.id, false)}
                    >
                      <IconArchiveOff className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </>
            )}

            <Separator className="my-2" />

            <p className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground">
              工作区
            </p>
            {NAV.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-sidebar-accent',
                    view === item.id && 'bg-sidebar-accent font-medium',
                  )}
                >
                  <Icon className="size-4 text-muted-foreground" />
                  {item.label}
                </button>
              )
            })}

            {active.length > 0 && activeRealmId && (
              <div className="px-2 pt-1">
                <button
                  type="button"
                  onClick={() => void handleArchive()}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <IconArchive className="size-3.5" />
                  归档当前档案
                </button>
              </div>
            )}

            <Separator className="my-2" />

            <p className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground">
              公开案例（合成数据）
            </p>
            {PUBLIC_CASES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => applyPublicCase(c.id as PublicCaseId)}
                className="w-full rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-sidebar-accent"
                title={c.summary}
              >
                <span className="font-medium">{c.label}</span>
                <span className="ml-1 text-muted-foreground">· {c.realmName}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      <div className="space-y-2 pt-1">
        <Separator />
        <AiSettingsDialog>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition hover:bg-sidebar-accent"
          >
            <IconSettings className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">模型连接</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {configured ? `${providerLabel(ai.providerId)} · ${ai.model}` : '未配置 API Key'}
              </span>
            </span>
            <span
              className={cn(
                'size-2 rounded-full',
                configured ? 'bg-emerald-500' : 'bg-amber-500',
              )}
            />
          </button>
        </AiSettingsDialog>

        <ThemeToggle />

        {activeRealmId && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground" />
              }
            >
              <IconDots className="size-4" />
              更多操作
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={() => setView('settings')}>
                <IconAdjustments className="size-4" />
                关于与数据管理
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => void handleDelete()}
              >
                <IconTrash className="size-4" />
                彻底删除此档案
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <p className="px-2 pb-1 text-[10px] leading-relaxed text-muted-foreground">
          全部数据只存在这台电脑的浏览器里。本程序没有服务器，也不会上传任何内容。
        </p>
      </div>

      <NewRealmDialog open={creating} onOpenChange={setCreating} />
    </aside>
  )
}
