import { useEffect, useMemo, useRef, useState } from 'react'
import { IconSend, IconTrash, IconWand, IconPlayerStop } from '@tabler/icons-react'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { Badge } from '#/components/ui/badge'
import { MessageBubble, StreamingBubble } from './message-bubble'
import { useStudio } from '#/lib/store'
import { cn } from '#/lib/utils'

const STARTERS = [
  { label: '对方突然变冷淡，我该问吗？', prompt: '对方最近回复变慢了，我想问清楚但又怕显得逼得太紧。帮我判断现在该不该问、怎么问。' },
  { label: '第一次约出来怎么开口', prompt: '我们聊了两周，还没单独见过面。帮我设计一个邀约，并说明如果被拒绝该怎么接。' },
  { label: '这句话该怎么回', prompt: '对方发了一句我不太会接的话，帮我按场景给几版回复，并说明每版的代价。' },
  { label: '我是不是投入太多了', prompt: '我怀疑这段关系里只有我在投入。帮我看看我手上这些证据能不能支撑这个判断，如果不能，我还需要观察什么。' },
  { label: '该继续还是退出', prompt: '我在这段关系里已经耗了很久。帮我做一次投入失衡的判断，并给出继续与退出两条路各自的具体动作。' },
]

export function DialogueView() {
  const activeRealmId = useStudio((s) => s.activeRealmId)
  const messages = useStudio((s) => s.messages)
  const streaming = useStudio((s) => s.streaming)
  const send = useStudio((s) => s.send)
  const stop = useStudio((s) => s.stop)
  const regenerate = useStudio((s) => s.regenerate)
  const clearDialogue = useStudio((s) => s.clearDialogue)
  const askConfirm = useStudio((s) => s.askConfirm)
  const createRealm = useStudio((s) => s.createRealm)
  const realmName = useStudio((s) => s.realms.find((r) => r.id === s.activeRealmId)?.name)
  const [draft, setDraft] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const ta = useRef<HTMLTextAreaElement>(null)

  const empty = messages.length === 0 && !streaming

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    // 空对话里没有「最新一条」可看，贴底只会把标题和引导语顶出屏幕
    // ——手机宽度下这个空状态比一屏还高，一进来就贴底会看到半截标题。
    if (messages.length === 0 && !streaming) return
    el.scrollTo({ top: el.scrollHeight, behavior: messages.length > 2 ? 'smooth' : 'auto' })
  }, [messages.length, streaming])

  const submit = async () => {
    const text = draft.trim()
    if (!text || streaming) return
    setDraft('')
    if (!activeRealmId) {
      await createRealm('临')
    }
    await send(text)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  const metricsLabel = useMemo(() => (streaming ? '生成中…' : `${messages.length} 条对话`), [streaming, messages.length])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-5 px-6 py-6">
          {empty ? (
            <EmptyState
              onPick={(p) => {
                setDraft(p)
                ta.current?.focus()
              }}
            />
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
          {streaming && <StreamingBubble />}
        </div>
      </div>

      <div className="border-t bg-background/80 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl space-y-2 px-6 py-3">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {realmName ? `对象：${realmName}` : '未建档案'}
            </Badge>
            <span>{metricsLabel}</span>
            {messages.length > 0 && (
              <div className="ml-auto flex items-center gap-1">
                <Button
                  size="xs"
                  variant="ghost"
                  className="gap-1"
                  disabled={streaming}
                  onClick={() => void regenerate()}
                >
                  <IconWand className="size-3" />
                  重答
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  className="gap-1"
                  disabled={streaming}
                  onClick={async () => {
                    const ok = await askConfirm({
                      title: '清空这个对象的全部对话记录？',
                      body: '只清对话。已经记下的证据、档案字段和关系进展都不受影响。',
                      confirmLabel: '清空对话',
                      destructive: true,
                    })
                    if (ok) await clearDialogue()
                  }}
                >
                  <IconTrash className="size-3" />
                  清空对话
                </Button>
              </div>
            )}
          </div>

          <div className="relative rounded-xl border bg-card shadow-xs focus-within:ring-2 focus-within:ring-ring/40">
            <Textarea
              ref={ta}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={3}
              placeholder="把事情说清楚就行，不用组织语言。例如：她昨天说“最近有点忙”，然后两天没回我消息，我想知道下一步怎么办。"
              className="min-h-[76px] resize-none border-0 bg-transparent pr-12 focus-visible:ring-0"
            />
            <div className="absolute right-2 bottom-2">
              {streaming ? (
                <Button size="icon" variant="outline" onClick={stop} title="停止">
                  <IconPlayerStop className="size-4" />
                </Button>
              ) : (
                <Button size="icon" onClick={() => void submit()} disabled={!draft.trim()} title="发送（Enter）">
                  <IconSend className="size-4" />
                </Button>
              )}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Enter 发送，Shift+Enter 换行。军师不会替你发送任何消息，也不预测对方爱不爱你。
          </p>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  const applyPublicCase = useStudio((s) => s.applyPublicCase)
  return (
    <div className="space-y-6 pt-8">
      <div className="space-y-2 text-center">
        <h2 className="text-lg font-semibold">先说说发生了什么</h2>
        <p className="mx-auto max-w-lg text-sm text-muted-foreground">
          这里没有服务器。你说的每句话、导入的每段记录、AI 给你的每个判断，都只存在这台电脑上。
          军师的角色是帮你把事实、推测和未知分开，然后给一个能立刻执行的动作。
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {STARTERS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onPick(s.prompt)}
            className={cn(
              'rounded-xl border bg-card px-3.5 py-3 text-left text-sm transition',
              'hover:border-primary/50 hover:bg-muted/50',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-dashed p-4">
        <p className="mb-2 text-sm font-medium">没有真实材料？先看一个合成案例</p>
        <p className="mb-3 text-xs text-muted-foreground">
          公开案例是完全合成的关系数据，用来演示「证据 → 指标 → 对话」这条链路怎么跑通。
          它不含任何真实个人信息。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => applyPublicCase('steady-warm')}>
            载入「稳步升温」
          </Button>
          <Button variant="outline" size="sm" onClick={() => applyPublicCase('fading')}>
            载入「持续降温」
          </Button>
          <Button variant="outline" size="sm" onClick={() => applyPublicCase('one-sided')}>
            载入「单方面投入」
          </Button>
        </div>
      </div>
    </div>
  )
}
