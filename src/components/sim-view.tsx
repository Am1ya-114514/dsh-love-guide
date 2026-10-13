/**
 * 模拟对练。
 *
 * 这一栏是「练习场」，不是聊天记录分析，也不是真人。三条设计约束：
 *  1. AI 扮演的那个人按人设卡演，可以冷淡、可以敷衍——不能是个永远配合的假人；
 *  2. 场外点评与情商复盘都不进入对方的上下文，否则「对方」会突然开始说教；
 *  3. 复盘分数只是练习反馈，界面上必须写明它不是人格测评。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  IconAlertTriangle,
  IconChartBar,
  IconId,
  IconLoader2,
  IconMessageChatbot,
  IconMoodHeart,
  IconPhoto,
  IconPlayerStopFilled,
  IconPlus,
  IconRefresh,
  IconSend,
  IconSparkles,
  IconTrash,
  IconUser,
} from '@tabler/icons-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Textarea } from '#/components/ui/textarea'
import { SimPersonaDialog } from '#/components/sim-persona-dialog'
import { useStudio } from '#/lib/store'
import { cn, formatDateTime } from '#/lib/utils'
import { EQ_DIMENSIONS, type EqReport, type SimChatMessage } from '#/lib/types'

/* ---------------------------------------------------------------------------
 * 小件
 * ------------------------------------------------------------------------- */

/**
 * 空会话时的三个开场白。
 * 它们只是把文字填进输入框，发不发、改不改都由用户自己决定——
 * 模拟对练里不做任何自动发送，每一句都必须是用户按下去的。
 */
const OPENERS = [
  { label: '给个开场白', text: '今天路过一家你上次提过的那家店，想起你说想吃来着。' },
  { label: '接上次的话题', text: '上次你说那个项目忙完了吗？后来怎么样了。' },
  { label: '分享一件小事', text: '今天碰到件挺好笑的事，讲给你听——' },
] as const

function PartnerAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-medium text-primary ring-1 ring-primary/25',
        className,
      )}
    >
      {name.slice(0, 1)}
    </span>
  )
}

function ScoreBar({ label, hint, value }: { label: string; hint: string; value: number }) {
  // 低分不高亮成"错误色"——这是练习反馈，不是判卷
  const tone = value >= 75 ? 'bg-chart-up' : value >= 50 ? 'bg-primary/70' : 'bg-evidence-popular'
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium" title={hint}>
          {label}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function EqReportCard({ report }: { report: EqReport }) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">{report.overall}</span>
        <span className="text-xs text-muted-foreground">情商均分（练习反馈，不是人格测评）</span>
      </div>
      <div className="space-y-2.5">
        {EQ_DIMENSIONS.map((d) => (
          <ScoreBar key={d.key} label={d.label} hint={d.hint} value={report.scores[d.key]} />
        ))}
      </div>
      {report.summary ? <p className="text-sm leading-relaxed">{report.summary}</p> : null}
      {report.strengths.length ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">做得好</p>
          <ul className="space-y-1 text-xs leading-relaxed">
            {report.strengths.map((s) => (
              <li key={s} className="rounded-md bg-chart-up/10 px-2 py-1">
                {s}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {report.fixes.length ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">可以改成这样说</p>
          {report.fixes.map((f) => (
            <div key={f.said + f.better} className="space-y-1 rounded-md border px-2 py-1.5 text-xs leading-relaxed">
              <p className="text-muted-foreground line-through decoration-dotted">你说：{f.said}</p>
              <p>改成：{f.better}</p>
              {f.why ? <p className="text-muted-foreground">{f.why}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{formatDateTime(report.at)}</p>
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * 背景图选择
 * ------------------------------------------------------------------------- */

function BackgroundDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const assets = useStudio((s) => s.simAssets)
  const session = useStudio((s) => s.simSessions.find((x) => x.id === s.simSessionId))
  const addAsset = useStudio((s) => s.addSimAsset)
  const deleteAsset = useStudio((s) => s.deleteSimAsset)
  const setBackground = useStudio((s) => s.setSimBackground)
  const toast = useStudio((s) => s.toast)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] w-[min(40rem,94vw)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="gap-1.5 border-b px-6 py-4 pr-14">
          <DialogTitle>聊天背景</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            图片只存在这台电脑的本机数据库里，不会上传。建议用横构图、色调偏暗的图，气泡更好读。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              <IconPlus className="size-4" />
              添加图片
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!session?.backgroundId}
              onClick={() => session && void setBackground(session.id, undefined)}
            >
              用纯色
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                const a = await addAsset(f)
                if (a && session) {
                  await setBackground(session.id, a.id)
                  toast('ok', '背景已换。')
                }
              }}
            />
          </div>

          {assets.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
              还没有背景图。
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {assets.map((a) => (
                <div key={a.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => session && void setBackground(session.id, a.id)}
                    className={cn(
                      'block h-20 w-full overflow-hidden rounded-lg border bg-cover bg-center ring-offset-2 transition',
                      session?.backgroundId === a.id ? 'ring-2 ring-primary' : 'hover:opacity-90',
                    )}
                    style={{ backgroundImage: `url(${a.dataUrl})` }}
                    title={a.name}
                  />
                  <button
                    type="button"
                    onClick={() => void deleteAsset(a.id)}
                    className="absolute right-1 top-1 rounded-md bg-black/55 p-1 text-white opacity-0 transition group-hover:opacity-100"
                    title="删除这张"
                  >
                    <IconTrash className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button size="sm" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------------------------------------------------------------------------
 * 主视图
 * ------------------------------------------------------------------------- */

export function SimView() {
  const realm = useStudio((s) => s.realms.find((r) => r.id === s.activeRealmId))
  const sessions = useStudio((s) => s.simSessions)
  const sessionId = useStudio((s) => s.simSessionId)
  const messages = useStudio((s) => s.simMessages)
  const assets = useStudio((s) => s.simAssets)
  const eqReports = useStudio((s) => s.eqReports)
  const streaming = useStudio((s) => s.simStreaming)
  const streamText = useStudio((s) => s.simStreamText)
  const busy = useStudio((s) => s.simBusy)
  const ai = useStudio((s) => s.ai)

  const createSession = useStudio((s) => s.createSimSession)
  const selectSession = useStudio((s) => s.selectSimSession)
  const deleteSession = useStudio((s) => s.deleteSimSession)
  const clearSim = useStudio((s) => s.clearSim)
  const simSend = useStudio((s) => s.simSend)
  const simStop = useStudio((s) => s.simStop)
  const coachNote = useStudio((s) => s.coachNote)
  const analyzeEq = useStudio((s) => s.analyzeEq)
  const setView = useStudio((s) => s.setView)

  const [input, setInput] = useState('')
  const [personaOpen, setPersonaOpen] = useState(false)
  const [bgOpen, setBgOpen] = useState(false)

  const session = sessions.find((s) => s.id === sessionId)
  const background = assets.find((a) => a.id === session?.backgroundId)
  const report = useMemo(
    () => [...eqReports].filter((r) => r.sessionId === sessionId).sort((a, b) => b.at - a.at)[0],
    [eqReports, sessionId],
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, streamText])

  const apiReady = Boolean(ai.apiKey.trim()) || ai.baseUrl.startsWith('http://127.0.0.1')

  const submit = () => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    void simSend(text)
  }

  if (!realm) {
    return (
      <div className="grid h-full place-items-center p-8">
        <Card className="max-w-md">
          <CardContent className="space-y-3 py-6 text-center">
            <IconMoodHeart className="mx-auto size-8 text-muted-foreground" />
            <p className="text-sm font-medium">先建立一个关系档案</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              模拟对练要练的是「和这个人相处」。建好档案之后，可以手填人设卡，也可以导入聊天记录让模型替你总结。
            </p>
            <Button size="sm" onClick={() => setView('dialogue')}>
              回到对话
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    /*
      背景铺在整个视图上，不只是消息那一栏。

      放在最外层而不是滚动容器上：滚动容器的背景会跟着内容一起被裁到它自己的
      矩形里，右侧资料栏和底部输入框就还是原来的底色，看起来像贴了一张图。

      顺便把整块内容再压一层氛围色——背景图有时很亮，白底气泡和输入框直接压
      上去会飘，压一层再让气泡半透明，层级关系才立得住。
    */
    <div
      className={cn('relative flex h-full min-h-0', background && 'bg-cover bg-center bg-no-repeat')}
      style={background ? { backgroundImage: `url(${background.dataUrl})` } : undefined}
    >
      {background && <div className="pointer-events-none absolute inset-0 bg-background/45" />}
      {/* 聊天区 */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b bg-background/65 px-4 py-2.5 backdrop-blur-md">
          <Badge variant="secondary" className="gap-1">
            <IconMessageChatbot className="size-3.5" />
            模拟对练
          </Badge>
          <span className="text-xs text-muted-foreground">
            AI 扮演的不是真人，按人设卡推演。练完可以复盘，复盘结论会进入军师的建议依据。
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setBgOpen(true)}>
              <IconPhoto className="size-4" />
              背景
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPersonaOpen(true)}>
              <IconId className="size-4" />
              人设卡
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={Boolean(busy) || streaming || messages.filter((m) => m.role !== 'coach').length < 2}
              onClick={() => void coachNote()}
            >
              {busy === '场外点评' ? <IconLoader2 className="size-4 animate-spin" /> : <IconSparkles className="size-4" />}
              场外点评
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={Boolean(busy) || streaming || messages.filter((m) => m.role === 'user').length < 3}
              onClick={() => void analyzeEq()}
            >
              {busy === '复盘情商指标' ? <IconLoader2 className="size-4 animate-spin" /> : <IconChartBar className="size-4" />}
              结束并分析
            </Button>
          </div>
        </div>

        {!session ? (
          <div className="grid flex-1 place-items-center p-8">
            <Card className="max-w-lg">
              <CardContent className="space-y-3 py-6">
                <div className="flex items-center gap-2">
                  <IconMoodHeart className="size-5 text-primary" />
                  <p className="text-sm font-medium">开一局模拟对练</p>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  你会和一个 AI 扮演的「{realm.name}」聊天。它按人设卡说话——可以回得慢、可以敷衍、可以在你越界时退开。
                  说错话的代价在这里是零，练熟了再去找真人。
                </p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li>· 先去「人设卡」填一填，或者从已导入的聊天记录里让模型总结。</li>
                  <li>· 聊几轮之后点「场外点评」看临场反馈，聊完点「结束并分析」拿情商复盘。</li>
                  <li>· 复盘结论会在之后的正式建议里被军师参考。</li>
                </ul>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={() => void createSession()}>
                    <IconPlus className="size-4" />
                    开始第一局
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPersonaOpen(true)}>
                    先填人设卡
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5"
            >
              <div className="mx-auto flex max-w-3xl flex-col gap-4">
                {messages.length === 0 ? (
                  <div className="space-y-3 rounded-xl border border-dashed bg-background/70 px-4 py-6 text-center">
                    <div className="space-y-2">
                      <p className="text-sm font-medium">先说第一句</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        像平时那样开口就行。对方会按人设反应——如果突然变冷淡，那可能正是现实里会发生的事。
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {OPENERS.map((o) => (
                        <Button
                          key={o.label}
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setInput(o.text)}
                        >
                          {o.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {messages.map((m) => (
                  <SimBubble key={m.id} message={m} realmName={realm.name} />
                ))}

                {streaming ? (
                  <div className="flex justify-start gap-2">
                    <PartnerAvatar name={realm.name} className="mt-0.5" />
                    <div className="max-w-[76%] rounded-2xl rounded-tl-sm border bg-card/95 px-3.5 py-2 text-sm leading-relaxed shadow-sm">
                      {streamText || <span className="text-muted-foreground">对方正在输入…</span>}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="relative border-t bg-background/65 px-4 py-3 backdrop-blur-md">
              <div className="mx-auto max-w-3xl space-y-2">
                {!apiReady ? (
                  <p className="flex items-center gap-1.5 text-xs text-evidence-popular">
                    <IconAlertTriangle className="size-3.5" />
                    还没有配置模型，对方不会有反应。左下角「模型连接」填 API Key。
                  </p>
                ) : null}
                <div className="flex items-end gap-2">
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault()
                        submit()
                      }
                    }}
                    placeholder="像平时发消息那样打一句话。Enter 发送，Shift+Enter 换行。"
                    className="min-h-[52px] resize-none"
                  />
                  {streaming ? (
                    <Button size="icon" variant="outline" onClick={() => simStop()} title="停下">
                      <IconPlayerStopFilled className="size-4" />
                    </Button>
                  ) : (
                    <Button size="icon" onClick={submit} disabled={!input.trim()} title="发送">
                      <IconSend className="size-4" />
                    </Button>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Enter 发送，Shift+Enter 换行。对方的话是模型按人设推演的，不代表那个真人会这样回应。
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 右栏：会话 + 人设 + 复盘 */}
      <aside className="relative hidden w-[330px] shrink-0 flex-col border-l bg-background/65 backdrop-blur-md lg:flex">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">会话</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => void createSession()}
            disabled={Boolean(busy)}
          >
            <IconPlus className="size-3.5" />
            新一局
          </Button>
        </div>
        <div className="max-h-40 shrink-0 overflow-y-auto px-2 py-2">
          {sessions.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">还没有会话。</p>
          ) : (
            <ul className="space-y-1">
              {sessions.map((s) => {
                const r = eqReports.find((x) => x.sessionId === s.id)
                return (
                  <li key={s.id}>
                    <div
                      className={cn(
                        'group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                        s.id === sessionId ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                      )}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left"
                        onClick={() => void selectSession(s.id)}
                        title={s.title}
                      >
                        {s.title}
                      </button>
                      {r ? <span className="shrink-0 tabular-nums text-muted-foreground">{r.overall}</span> : null}
                      <button
                        type="button"
                        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition group-hover:opacity-100"
                        onClick={() => void deleteSession(s.id)}
                        title="删除这一局"
                      >
                        <IconTrash className="size-3.5" />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t px-4 py-4">
          {/* 人设卡摘要 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">对方人设卡</span>
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setPersonaOpen(true)}>
                编辑
              </Button>
            </div>
            {realm.persona ? (
              <dl className="space-y-2 text-xs leading-relaxed">
                {realm.persona.speechStyle ? (
                  <div>
                    <dt className="text-muted-foreground">说话方式</dt>
                    <dd>{realm.persona.speechStyle}</dd>
                  </div>
                ) : null}
                {realm.persona.replyRhythm ? (
                  <div>
                    <dt className="text-muted-foreground">回复节奏</dt>
                    <dd>{realm.persona.replyRhythm}</dd>
                  </div>
                ) : null}
                {realm.persona.turnOffs.length ? (
                  <div>
                    <dt className="text-muted-foreground">会让她退开</dt>
                    <dd>{realm.persona.turnOffs.join('、')}</dd>
                  </div>
                ) : null}
                {realm.persona.catchphrases.length ? (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {realm.persona.catchphrases.slice(0, 6).map((c) => (
                      <Badge key={c} variant="outline" className="font-normal">
                        {c}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                还没有人设卡。现在开一局会用「普通年轻人」的默认设定——那样练不出针对性的东西。
                你可以手填，也可以先在「聊天记录」里导入一批记录，再让人设卡里点「从聊天记录分析」。
              </p>
            )}
          </div>

          {/* 复盘 */}
          <div className="mt-5 space-y-3 border-t pt-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">情商复盘</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                disabled={Boolean(busy) || streaming}
                onClick={() => void analyzeEq()}
              >
                {report ? <IconRefresh className="size-3.5" /> : <IconChartBar className="size-3.5" />}
                {report ? '重新分析' : '分析这次'}
              </Button>
            </div>
            {report ? (
              <EqReportCard report={report} />
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                还没有复盘。至少说满三句之后点「结束并分析」，会给出六个维度的分数与具体的改写建议。
                这些结论会在之后的正式建议里被参考。
              </p>
            )}
            {eqReports.length > 1 ? (
              <p className="text-[11px] text-muted-foreground">
                共 {eqReports.length} 次复盘，最近一次的均分 {Math.round(eqReports.slice(-3).reduce((s, r) => s + r.overall, 0) / Math.min(3, eqReports.length))}。
              </p>
            ) : null}
          </div>

          {session ? (
            <div className="mt-5 border-t pt-4">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-muted-foreground"
                onClick={() => void clearSim()}
              >
                <IconTrash className="size-3.5" />
                清空这一局的对话
              </Button>
            </div>
          ) : null}
        </div>
      </aside>

      <SimPersonaDialog open={personaOpen} onOpenChange={setPersonaOpen} />
      <BackgroundDialog open={bgOpen} onOpenChange={setBgOpen} />
    </div>
  )
}

function SimBubble({ message, realmName }: { message: SimChatMessage; realmName: string }) {
  if (message.role === 'coach') {
    return (
      <div className="rounded-xl border border-primary/25 bg-primary/5 px-3.5 py-2.5">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
          <IconSparkles className="size-3.5" />
          场外点评
        </p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
      </div>
    )
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end gap-2">
        <div className="flex max-w-[76%] flex-col items-end gap-1">
          {message.content ? (
            <div className="whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 text-sm leading-relaxed text-primary-foreground shadow-sm">
              {message.content}
            </div>
          ) : null}
          {message.error ? (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <IconAlertTriangle className="size-3.5" />
              {message.error}
            </p>
          ) : null}
        </div>
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <IconUser className="size-4" />
        </span>
      </div>
    )
  }

  return (
    <div className="flex justify-start gap-2">
      <PartnerAvatar name={realmName} className="mt-0.5" />
      <div className="flex max-w-[76%] flex-col gap-1">
        {message.content ? (
          <div className="whitespace-pre-wrap rounded-2xl rounded-tl-sm border bg-card/95 px-3.5 py-2 text-sm leading-relaxed shadow-sm">
            {message.content}
          </div>
        ) : null}
        {message.error ? (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <IconAlertTriangle className="size-3.5" />
            {message.error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
