/**
 * 对方人设卡编辑器。
 *
 * 两种来源并存：从导入的聊天记录里让模型抽，或者用户自己敲。
 * 抽出来的每条都留着原文片段（quotes），因为「这个人说话什么样」这种结论
 * 必须能让人回去核对，不然模拟就会变成按模型想象演。
 */

import { useEffect, useState } from 'react'
import { IconLoader2, IconSparkles, IconTrash } from '@tabler/icons-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Separator } from '#/components/ui/separator'
import { Textarea } from '#/components/ui/textarea'
import { useStudio } from '#/lib/store'
import type { SimPersona } from '#/lib/types'
const listToText = (xs: string[]): string => xs.join('、')
const textToList = (s: string): string[] =>
  s
    .split(/[、,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 12)

interface Draft {
  speechStyle: string
  catchphrases: string
  topics: string
  emotionalStyle: string
  replyRhythm: string
  turnOffs: string
}

const EMPTY: Draft = {
  speechStyle: '',
  catchphrases: '',
  topics: '',
  emotionalStyle: '',
  replyRhythm: '',
  turnOffs: '',
}

function toDraft(p: SimPersona | undefined): Draft {
  if (!p) return { ...EMPTY }
  return {
    speechStyle: p.speechStyle,
    catchphrases: listToText(p.catchphrases),
    topics: listToText(p.topics),
    emotionalStyle: p.emotionalStyle,
    replyRhythm: p.replyRhythm,
    turnOffs: listToText(p.turnOffs),
  }
}

export function SimPersonaDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const realm = useStudio((s) => s.realms.find((r) => r.id === s.activeRealmId))
  const busy = useStudio((s) => s.simBusy)
  const extract = useStudio((s) => s.extractPersonaFromLogs)
  const updatePersona = useStudio((s) => s.updatePersona)
  const resetPersona = useStudio((s) => s.resetPersona)

  const [draft, setDraft] = useState<Draft>(EMPTY)

  // 每次打开时从当前档案同步，避免上次改了一半的草稿残留
  useEffect(() => {
    if (open) setDraft(toDraft(realm?.persona))
  }, [open, realm?.persona])

  const persona = realm?.persona
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  const save = async () => {
    await updatePersona({
      speechStyle: draft.speechStyle.trim(),
      catchphrases: textToList(draft.catchphrases),
      topics: textToList(draft.topics),
      emotionalStyle: draft.emotionalStyle.trim(),
      replyRhythm: draft.replyRhythm.trim(),
      turnOffs: textToList(draft.turnOffs),
      derivedFrom: persona?.derivedFrom === 'chatlog' ? 'hybrid' : (persona?.derivedFrom ?? 'manual'),
      quotes: persona?.quotes ?? [],
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[min(44rem,94vw)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="gap-1.5 border-b px-6 py-4 pr-14">
          <DialogTitle>对方人设卡</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            这份卡片决定模拟对练里「AI 扮演的那个人」怎么说话、什么会让她退开。
            它只描述能核对到的语言习惯，不是心理测评。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="flex flex-wrap items-center gap-2">
            {persona ? (
              <Badge variant="secondary">
                {persona.derivedFrom === 'chatlog'
                  ? '来自聊天记录'
                  : persona.derivedFrom === 'hybrid'
                    ? '聊天记录 + 手动修改'
                    : '手动填写'}
              </Badge>
            ) : (
              <Badge variant="outline">还没有人设卡，现在开一局会用默认的普通人设</Badge>
            )}
            {busy ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <IconLoader2 className="size-3.5 animate-spin" />
                {busy}…
              </span>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pp-speech">说话方式</Label>
            <Textarea
              id="pp-speech"
              value={draft.speechStyle}
              onChange={(e) => set({ speechStyle: e.target.value })}
              placeholder="例：句子偏短，常只回一两个字，不太用标点；高兴时会连发两三条。"
              className="min-h-[68px]"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pp-catch">口头禅 / 常用词</Label>
              <Input
                id="pp-catch"
                value={draft.catchphrases}
                onChange={(e) => set({ catchphrases: e.target.value })}
                placeholder="嗯嗯、哈哈哈、再说吧"
              />
              <p className="text-xs text-muted-foreground">用顿号或逗号分隔。</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pp-topics">在意的话题</Label>
              <Input
                id="pp-topics"
                value={draft.topics}
                onChange={(e) => set({ topics: e.target.value })}
                placeholder="工作加班、猫、周末去哪吃"
              />
              <p className="text-xs text-muted-foreground">用顿号或逗号分隔。</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pp-emo">情绪表达方式</Label>
            <Textarea
              id="pp-emo"
              value={draft.emotionalStyle}
              onChange={(e) => set({ emotionalStyle: e.target.value })}
              placeholder="例：不高兴时只回「嗯」，或者隔很久才回；开心时会主动分享当天的事。"
              className="min-h-[60px]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pp-rhythm">回复节奏</Label>
            <Input
              id="pp-rhythm"
              value={draft.replyRhythm}
              onChange={(e) => set({ replyRhythm: e.target.value })}
              placeholder="例：白天回得快，晚上十点后基本不回；很少主动开新话题。"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pp-off">会让她退开的做法</Label>
            <Textarea
              id="pp-off"
              value={draft.turnOffs}
              onChange={(e) => set({ turnOffs: e.target.value })}
              placeholder="被追问在哪、和谁；连着发三条没回应还继续发。"
              className="min-h-[60px]"
            />
            <p className="text-xs text-muted-foreground">用顿号或逗号分隔。这一栏越具体，模拟越不会一味顺着你。</p>
          </div>

          {persona?.quotes.length ? (
            <>
              <Separator />
              <div className="space-y-2">
                <Label>抽取时依据的原文片段</Label>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {persona.quotes.map((q) => (
                    <li key={q} className="rounded-md bg-muted/50 px-2 py-1">
                      {q}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  这些是模型据以总结的原话。对不上就说明抽错了，请手动改上面的字段。
                </p>
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter className="gap-2 border-t px-6 py-4 sm:justify-between">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => void extract()}
            >
              {busy === '分析对方人设' ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconSparkles className="size-4" />
              )}
              从聊天记录分析
            </Button>
            {persona ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => void resetPersona()}
              >
                <IconTrash className="size-4" />
                清空
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" onClick={() => void save()}>
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
