import { useState } from 'react'
import { IconCircleCheck, IconCopy, IconSquare, IconUser } from '@tabler/icons-react'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { AgentAvatar } from './agent-avatar'
import { Markdown } from './markdown'
import { copyText, formatDateTime, cn } from '#/lib/utils'
import { AGENT_LABEL } from '#/lib/brand'
import { selectAiConfigured, useStudio } from '#/lib/store'
import { EVIDENCE_TIER_LABEL } from '#/lib/types'
import type { ChatMessage } from '#/lib/types'

interface Props {
  message: ChatMessage
  streaming?: boolean
}

export function MessageBubble({ message, streaming }: Props) {
  const isUser = message.role === 'user'
  const configured = useStudio(selectAiConfigured)

  return (
    <div className={cn('flex w-full gap-3', isUser && 'flex-row-reverse')}>
      {isUser ? (
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <IconUser className="size-4" />
        </div>
      ) : (
        <AgentAvatar className="mt-0.5" />
      )}

      <div className={cn('min-w-0 flex-1 space-y-2', isUser && 'flex flex-col items-end')}>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{isUser ? '你' : AGENT_LABEL}</span>
          <span>·</span>
          <span>{formatDateTime(message.createdAt)}</span>
          {message.model && !isUser && (
            <>
              <span>·</span>
              <span className="font-mono">{message.model}</span>
            </>
          )}
          {message.usage && message.usage.completion > 0 && (
            <span className="text-muted-foreground/70">
              · ↑{message.usage.prompt} ↓{message.usage.completion}
            </span>
          )}
        </div>

        {isUser ? (
          <div className="max-w-[min(680px,90%)] rounded-2xl rounded-tr-sm bg-secondary px-4 py-2.5 text-sm whitespace-pre-wrap">
            {message.content}
          </div>
        ) : (
          <div className="w-full space-y-3">
            <div className="rounded-2xl rounded-tl-sm border bg-card px-4 py-3">
              {message.content ? (
                <Markdown text={message.content} />
              ) : streaming ? (
                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  正在思考
                  <span className="flex gap-0.5">
                    <span className="size-1 animate-pulse rounded-full bg-current [animation-delay:0ms]" />
                    <span className="size-1 animate-pulse rounded-full bg-current [animation-delay:180ms]" />
                    <span className="size-1 animate-pulse rounded-full bg-current [animation-delay:360ms]" />
                  </span>
                </span>
              ) : null}
              {streaming && message.content && (
                <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-primary align-text-bottom" />
              )}
            </div>

            {message.error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {message.error}
              </div>
            )}

            {message.action && message.action.scripts.length > 0 && (
              <div className="rounded-xl border bg-card p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">可直接发送的话术</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 gap-1 px-2 text-[11px]"
                    onClick={async () => {
                      await copyText(message.action!.scripts.map((s) => `${s.label}：${s.text}`).join('\n\n'))
                    }}
                  >
                    <IconCopy className="size-3" />
                    全部复制
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {message.action.scripts.map((s, i) => (
                    <ScriptCard key={i} label={s.label} text={s.text} cost={s.cost} />
                  ))}
                </div>
              </div>
            )}

            {message.citations && message.citations.length > 0 && (
              <details className="rounded-lg border border-dashed px-3 py-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  本轮引用了 {message.citations.length} 篇知识库材料（点开可核对原文）
                </summary>
                <ul className="mt-2 space-y-2">
                  {message.citations.map((c) => (
                    <li key={c.docId} className="text-xs">
                      <p className="font-medium">{c.title}</p>
                      <p className="text-muted-foreground">
                        {c.tier ? `证据等级：${EVIDENCE_TIER_LABEL[c.tier]}｜` : ''}
                        <span className="font-mono">{c.docId}</span>
                      </p>
                      {c.excerpt && (
                        <p className="mt-1 border-l-2 pl-2 whitespace-pre-wrap text-muted-foreground">{c.excerpt}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {!configured && !message.error && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                还没有配置模型，这条是本地生成的占位内容。
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ScriptCard({ label, text, cost }: { label: string; text: string; cost: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="group flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
          {label}
        </Badge>
        <button
          type="button"
          className="text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-foreground"
          onClick={async () => {
            const ok = await copyText(text)
            setCopied(ok)
            window.setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? <IconCircleCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
        </button>
      </div>
      <p className="text-sm leading-snug whitespace-pre-wrap select-all">{text}</p>
      {cost && <p className="text-[11px] text-muted-foreground">代价：{cost}</p>}
    </div>
  )
}

/** 生成中的实时文本，单独渲染。 */
export function StreamingBubble() {
  const streamText = useStudio((s) => s.streamText)
  const stop = useStudio((s) => s.stop)
  return (
    <div className="flex w-full gap-3">
      <AgentAvatar className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{AGENT_LABEL}</span>
          <span>·</span>
          <span>正在生成</span>
          <Button size="sm" variant="ghost" className="ml-auto h-6 gap-1 px-2 text-[11px]" onClick={stop}>
            <IconSquare className="size-3" />
            停止
          </Button>
        </div>
        <div className="rounded-2xl rounded-tl-sm border bg-card px-4 py-3">
          {streamText ? (
            <Markdown text={streamText} />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              正在检索知识库
              <span className="flex gap-0.5">
                <span className="size-1 animate-pulse rounded-full bg-current [animation-delay:0ms]" />
                <span className="size-1 animate-pulse rounded-full bg-current [animation-delay:180ms]" />
                <span className="size-1 animate-pulse rounded-full bg-current [animation-delay:360ms]" />
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
