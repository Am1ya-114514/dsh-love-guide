import { useState } from 'react'
import { IconId, IconLock, IconLockOpen, IconMenu2, IconSparkles } from '@tabler/icons-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { selectActiveRealm, useStudio, type WorkspaceView } from '#/lib/store'
import { RealmEditorDialog } from './realm-editor'

const TITLES: Record<WorkspaceView, { title: string; sub: string }> = {
  dialogue: { title: '对话', sub: '说清处境，拿到一个能立刻执行的动作' },
  evidence: { title: '关系进展', sub: '把证据画成 K 线：只解释已记录的事实' },
  chatlog: { title: '聊天记录', sub: '本地解析、说话人映射、互惠指标与推演' },
  sim: { title: '模拟对练', sub: '让 AI 按人设扮演对方，说错话的代价在这里是零' },
  knowledge: { title: '知识库', sub: '43 篇上游资料，按证据等级检索' },
  settings: { title: '关于与数据', sub: '这个程序做了什么、数据放在哪、怎么带走' },
}

export function Topbar({ onOpenNav }: { onOpenNav?: () => void }) {
  const view = useStudio((s) => s.view)
  const realm = useStudio(selectActiveRealm)
  const consentAt = useStudio((s) => s.consentAt)
  const evidenceCount = useStudio((s) => s.evidence.length)
  const logCount = useStudio((s) => s.chatLogs.length)
  const [editing, setEditing] = useState(false)
  const meta = TITLES[view]

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 lg:h-14 lg:gap-3 lg:px-4">
      {onOpenNav && (
        <Button
          variant="ghost"
          size="icon"
          className="-ml-1.5 shrink-0 lg:hidden"
          onClick={onOpenNav}
          aria-label="打开导航"
        >
          <IconMenu2 className="size-5" />
        </Button>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-[15px] font-semibold lg:text-sm">{meta.title}</h1>
          {realm && (
            <Badge variant="secondary" className="h-5 max-w-28 gap-1 px-1.5 text-[10px] lg:max-w-32">
              <IconSparkles className="size-3" />
              {realm.name}
              {realm.temporary && ' · 临时'}
            </Badge>
          )}
        </div>
        {/* 手机上不重复副标题：一行标题 + 汉堡就够，多一行字只是把内容往下挤 */}
        <p className="hidden truncate text-[11px] text-muted-foreground lg:block">{meta.sub}</p>
      </div>

      {realm && view !== 'settings' && (
        <div className="hidden items-center gap-3 text-[11px] text-muted-foreground md:flex">
          <span>{evidenceCount} 条证据</span>
          <span className="text-border">|</span>
          <span>{logCount} 条聊天</span>
        </div>
      )}

      <div
        className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] sm:flex"
        title={
          consentAt
            ? `长期记忆已在 ${new Date(consentAt).toLocaleString()} 获得同意。可随时在「关于与数据」里撤销。`
            : '长期记忆尚未启用。没启用时，跨会话只会记住你手动填的档案字段。'
        }
      >
        {consentAt ? (
          <IconLock className="size-3 text-emerald-600" />
        ) : (
          <IconLockOpen className="size-3 text-muted-foreground" />
        )}
        <span className="text-muted-foreground">{consentAt ? '记忆已启用' : '未启用记忆'}</span>
      </div>

      {realm && view !== 'settings' && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5 px-2 lg:px-3"
          onClick={() => setEditing(true)}
          aria-label="档案"
        >
          <IconId className="size-3.5" />
          <span className="hidden lg:inline">档案</span>
        </Button>
      )}

      {realm && (
        <RealmEditorDialog realm={realm} open={editing} onOpenChange={setEditing} />
      )}
    </header>
  )
}
