import { useMemo, useRef, useState } from 'react'
import {
  IconAlertTriangle,
  IconChartHistogram,
  IconFileImport,
  IconInfoCircle,
  IconListDetails,
  IconLoader2,
  IconPhoto,
  IconSparkles,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { Progress } from '#/components/ui/progress'
import { Separator } from '#/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { Textarea } from '#/components/ui/textarea'
import { EChart, type EChartsCoreOption } from '#/lib/echart'
import { computeReciprocity } from '#/lib/metrics'
import { selectActiveRealm, useStudio } from '#/lib/store'
import { useTokens } from '#/lib/theme'
import { cn, formatBytes } from '#/lib/utils'
import {
  dryRun,
  parse,
  suggestMapping,
  type SenderStat,
  type SpeakerMapping,
} from '#/lib/chatlog'

type Kind = 'self' | 'target' | 'other'

const KIND_LABEL: Record<Kind, string> = {
  self: '我（本人）',
  target: '目标对象',
  other: '其他人（不参与互惠计算）',
}

export function ChatLogView() {
  const realm = useStudio(selectActiveRealm)
  const chatLogs = useStudio((s) => s.chatLogs)
  const importRows = useStudio((s) => s.addChatLogs)
  const deleteImport = useStudio((s) => s.deleteImport)
  const askConfirm = useStudio((s) => s.askConfirm)
  const extract = useStudio((s) => s.extractEvidenceFromLogs)
  const analyze = useStudio((s) => s.analyzeChatLog)
  const aiConfigured = useStudio((s) => Boolean(s.ai.apiKey.trim() || s.ai.baseUrl.startsWith('http://127.0.0.1')))
  const toast = useStudio((s) => s.toast)
  const tokens = useTokens()

  const [raw, setRaw] = useState('')
  const [report, setReport] = useState<ReturnType<typeof dryRun> | null>(null)
  const [mapping, setMapping] = useState<SpeakerMapping>({})
  const [busy, setBusy] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [shotCount, setShotCount] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const shotInput = useRef<HTMLInputElement>(null)
  const vision = useStudio((s) => Boolean(s.ai.vision))
  const transcribeImages = useStudio((s) => s.transcribeImages)

  /** 截图走「模型转文字 → 同一套解析」，所以下游和粘贴文本完全共用一条路。 */
  async function handleScreenshots(files: File[]) {
    const tooBig = files.find((f) => f.size > 8 * 1024 * 1024)
    if (tooBig) {
      toast('warn', `${tooBig.name} 有 ${formatBytes(tooBig.size)}，单张请压到 8MB 以内。`)
      return
    }
    setTranscribing(true)
    setShotCount(files.length)
    try {
      const images = await Promise.all(
        files.map(
          (f) =>
            new Promise<{ name: string; dataUrl: string }>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve({ name: f.name, dataUrl: String(reader.result) })
              reader.onerror = () => reject(new Error(`读不出 ${f.name}`))
              reader.readAsDataURL(f)
            }),
        ),
      )
      const text = await transcribeImages(images)
      if (!text) return
      setRaw(text)
      doDryRun(text)
      toast('ok', `已识别 ${files.length} 张截图，转成了 ${text.split('\n').length} 行。核对完说话人再导入。`)
    } catch (err) {
      toast('err', err instanceof Error ? err.message : String(err))
    } finally {
      setTranscribing(false)
    }
  }

  const batches = useMemo(() => {
    const map = new Map<string, { id: string; count: number; first: string; last: string }>()
    for (const m of chatLogs) {
      const cur = map.get(m.importId)
      if (cur) {
        cur.count++
        if (m.sentAt && (!cur.first || m.sentAt < cur.first)) cur.first = m.sentAt
        if (m.sentAt && (!cur.last || m.sentAt > cur.last)) cur.last = m.sentAt
      } else {
        map.set(m.importId, { id: m.importId, count: 1, first: m.sentAt, last: m.sentAt })
      }
    }
    return [...map.values()].sort((a, b) => (b.last || '').localeCompare(a.last || ''))
  }, [chatLogs])

  const reciprocity = useMemo(() => (chatLogs.length ? computeReciprocity(chatLogs) : null), [chatLogs])

  if (!realm) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="max-w-md text-sm text-muted-foreground">
          聊天记录是按对象隔离的。先在左侧建立或选择一个关系档案，再导入对话。
        </p>
      </div>
    )
  }

  const doDryRun = (text: string) => {
    const r = dryRun(text)
    setReport(r)
    setMapping(suggestMapping(r.senders))
    if (!r.ok) toast('err', r.warnings[0] ?? '解析失败。')
  }

  const doImport = async () => {
    if (!report) return
    if (!mappingSelfAssigned(mapping)) {
      toast('warn', '请先把「我」是谁指定清楚，否则互惠指标会是反的。')
      return
    }
    setBusy(true)
    try {
      const parsed = parse(raw)
      const batch = `imp_${Date.now().toString(36)}`
      const n = await importRows(
        parsed.rows.map((r) => ({
          sender: r.sender,
          speaker: mapping[r.sender] ?? 'other',
          content: r.content,
          sentAt: r.sentAt,
          importId: batch,
        })),
      )
      toast('ok', `已导入 ${n} 条记录（批次 ${batch}）。原始正文只存在本机数据库里。`)
      setRaw('')
      setReport(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-4 p-5">
        <Card className="gap-2 border-dashed p-3.5">
          <div className="flex items-start gap-2">
            <IconInfoCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
              <p>
                 <b className="text-foreground">这里不读你的微信或 QQ。</b>
                微信/QQ 的聊天数据库是加密的，解密读取既违反平台条款也有法律风险，本程序刻意不提供这个能力。
              </p>
              <p>
                可行的做法有三种：用聊天软件自带的「导出聊天记录」；手动复制一段对话粘贴到下面；
                或者<b className="text-foreground">直接导入聊天截图</b>——那走的是你自己填的视觉模型，
                图片只发给你的服务商，转成文字之后的解析、统计、画图仍然全在本机。
                支持带时间戳的纯文本、<code className="rounded bg-muted px-1">名字: 内容</code> 格式，
                以及 ChatLab 导出的 JSON。
              </p>
            </div>
          </div>
        </Card>

        <Tabs defaultValue="import">
          <TabsList>
            <TabsTrigger value="import">导入</TabsTrigger>
            <TabsTrigger value="insight">
              推演
              {reciprocity && (
                <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                  {reciprocity.total}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="import" className="space-y-4">
            <Card className="gap-3 p-4">
              <div className="flex items-center gap-2">
                <IconUpload className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">第 1 步 · 干跑</h3>
                <p className="text-[11px] text-muted-foreground">
                  先只报格式和数量，不把正文摊出来——这是为了让你在导入前确认「读对了没有」。
                </p>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".txt,.json,.md,.csv,text/plain,application/json"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    if (f.size > 12 * 1024 * 1024) {
                      toast('warn', `文件 ${formatBytes(f.size)}，超过 12MB。请先切分再导入。`)
                      return
                    }
                    const text = await f.text()
                    setRaw(text)
                    doDryRun(text)
                  }}
                />
                <input
                  ref={shotInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = [...(e.target.files ?? [])]
                    e.target.value = ''
                    if (files.length === 0) return
                    await handleScreenshots(files)
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto gap-1.5"
                  disabled={transcribing}
                  onClick={() => {
                    if (!vision) {
                      toast('warn', '当前模型没标成「能看图」。到「模型连接 → 生成参数」里打开，或换一个支持视觉的模型。')
                      return
                    }
                    shotInput.current?.click()
                  }}
                >
                  <IconPhoto className="size-3.5" />
                  {transcribing ? `识别中 0/${shotCount}` : '导入截图'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => fileInput.current?.click()}
                >
                  <IconFileImport className="size-3.5" />
                  选择文件
                </Button>
              </div>

              {transcribing && (
                <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2.5 text-[11px]">
                  <IconLoader2 className="size-3.5 animate-spin text-primary" />
                  正在让模型逐张读图转成文字（{shotCount} 张）。这一步会把图片发给模型，
                  解析与统计仍然全部在本机完成。
                </div>
              )}

              <Textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                rows={9}
                placeholder={`把导出的聊天记录整段粘进来。例如：

2026-08-01 20:15:33 小北
今天加班到九点，累死了
2026-08-01 20:17:02 我
那早点休息，别熬了
2026-08-01 20:18:11 小北
嗯 你也是`}
                className="font-mono text-xs"
              />

              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={!raw.trim()} onClick={() => doDryRun(raw)}>
                  干跑一次
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  {raw ? `${raw.length} 字符` : '还没粘内容'}
                </span>
              </div>

              {report && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <MiniStat label="格式" value={report.format} />
                      <MiniStat label="记录条数" value={String(report.total)} />
                      <MiniStat label="说话人" value={String(report.senders.length)} />
                      <MiniStat label="时间跨度" value={report.dateRange} mono />
                    </div>

                    {report.warnings.map((w) => (
                      <div key={w} className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-[11px]">
                        <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                        <span>{w}</span>
                      </div>
                    ))}

                    <div>
                      <p className="mb-1.5 text-xs font-medium">第 2 步 · 锁定说话人映射</p>
                      <p className="mb-2 text-[11px] text-muted-foreground">
                        这一步不能猜。猜错的话，「谁更主动」会整个反过来。下面只是按条数给的默认建议。
                      </p>
                      <div className="space-y-2">
                        {report.senders.map((s) => (
                          <SenderRow
                            key={s.name}
                            stat={s}
                            value={mapping[s.name] ?? 'other'}
                            total={report.total}
                            onChange={(v) => setMapping((m) => ({ ...m, [s.name]: v }))}
                          />
                        ))}
                      </div>
                    </div>

                    <Button disabled={!report.ok || busy} onClick={() => void doImport()} className="gap-1.5">
                      <IconFileImport className="size-4" />
                      {busy ? '正在写入…' : `确认导入 ${report.total} 条`}
                    </Button>
                  </div>
                </>
              )}
            </Card>

            {batches.length > 0 && (
              <Card className="gap-2 p-4">
                <div className="flex items-center gap-2">
                  <IconListDetails className="size-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">已导入批次</h3>
                  <p className="text-[11px] text-muted-foreground">整批撤销，不用一条条删。</p>
                </div>
                <ul className="divide-y">
                  {batches.map((b) => (
                    <li key={b.id} className="flex items-center gap-3 py-2">
                      <span className="font-mono text-[11px]">{b.id}</span>
                      <span className="text-xs text-muted-foreground">{b.count} 条</span>
                      <span className="text-[11px] text-muted-foreground">
                        {b.first && b.last ? `${b.first.slice(0, 10)} ~ ${b.last.slice(0, 10)}` : '无时间戳'}
                      </span>
                      <div className="ml-auto flex items-center gap-1">
                        <Button
                          size="xs"
                          variant="ghost"
                          className="gap-1"
                          disabled={!aiConfigured}
                          title={aiConfigured ? '让 AI 依据指标解释这一批' : '先在左下角配置 API Key'}
                          onClick={() => void analyze(b.id)}
                        >
                          <IconSparkles className="size-3" />
                          让军师解读
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          title="撤销这一批"
                          onClick={async () => {
                            const ok = await askConfirm({
                              title: `撤销这一批记录？`,
                              body: `批次 ${b.id} 的 ${b.count} 条聊天记录会从本机删除。由它抽取出来的证据不会跟着删，需要的话请到「关系进展」里逐条处理。`,
                              confirmLabel: '撤销这一批',
                              destructive: true,
                            })
                            if (ok) await deleteImport(b.id)
                          }}
                        >
                          <IconTrash className="size-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="insight" className="space-y-4">
            {!reciprocity ? (
              <Card className="items-center gap-2 p-10 text-center">
                <IconChartHistogram className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium">还没有可推演的记录</p>
                <p className="max-w-md text-xs text-muted-foreground">
                  先在「导入」里粘一段对话。导入之后，这里会出现按日热度图、发起/回应比例、
                  回复间隔，以及从记录里抽出的候选证据。
                </p>
              </Card>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-4">
                  <MiniCard label="总条数" value={String(reciprocity.total)} />
                  <MiniCard label="我发起" value={String(reciprocity.selfInitiated)} />
                  <MiniCard label="对方发起" value={String(reciprocity.targetInitiated)} />
                  <MiniCard
                    label="覆盖天数"
                    value={String(reciprocity.perDay.length)}
                  />
                </div>

                <Card className="gap-3 p-4">
                  <div className="flex items-center gap-2">
                    <IconChartHistogram className="size-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold">按日热度</h3>
                    <p className="text-[11px] text-muted-foreground">左柱是我，右柱是对方。</p>
                  </div>
                  <EChart option={heatOption(reciprocity, tokens)} height={260} />
                </Card>

                <div className="grid gap-4 md:grid-cols-2">
                  <Card className="gap-3 p-4">
                    <h3 className="text-sm font-semibold">发起 / 回应结构</h3>
                    <Bar label="我主动发起" value={reciprocity.selfInitiated} total={reciprocity.total} />
                    <Bar label="对方主动发起" value={reciprocity.targetInitiated} total={reciprocity.total} />
                    <Bar label="我发出的消息" value={reciprocity.selfCount} total={reciprocity.total} />
                    <Bar label="对方发出的消息" value={reciprocity.targetCount} total={reciprocity.total} />
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      「发起」指的是谁先开口开启一段对话。条数多不等于更主动——话多的人也可能一直在回应。
                    </p>
                  </Card>

                  <Card className="gap-3 p-4">
                    <h3 className="text-sm font-semibold">节奏</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <MiniStat label="我平均回复间隔" value={fmtMin(reciprocity.avgSelfReplyMinutes)} />
                      <MiniStat label="对方平均回复间隔" value={fmtMin(reciprocity.avgTargetReplyMinutes)} />
                      <MiniStat label="正向情绪词" value={String(reciprocity.toneHits.positive)} />
                      <MiniStat label="负向情绪词" value={String(reciprocity.toneHits.negative)} />
                    </div>
                    <Separator />
                    <Button
                      variant="outline"
                      className="gap-1.5"
                      onClick={async () => {
                        const n = await extract()
                        toast(n > 0 ? 'ok' : 'warn', n > 0 ? `抽出了 ${n} 条候选证据，去「关系进展 · 证据台账」逐条确认。` : '没有抽出新的候选证据。')
                      }}
                    >
                      <IconSparkles className="size-3.5" />
                      从记录里抽候选证据
                    </Button>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      抽出来的证据默认标着「待你确认」，不会被当成事实。AI 的判断力在这件事上并不可靠，
                      所以它只负责找，你负责定。
                    </p>
                  </Card>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function mappingSelfAssigned(m: SpeakerMapping): boolean {
  return Object.values(m).some((v) => v === 'self')
}

function SenderRow({
  stat,
  value,
  total,
  onChange,
}: {
  stat: SenderStat
  value: Kind
  total: number
  onChange: (v: Kind) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{stat.name}</p>
        <p className="text-[11px] text-muted-foreground">
          {stat.count} 条 · 占 {total ? Math.round((stat.count / total) * 100) : 0}% · 平均 {stat.avgChars} 字
          {stat.first && ` · ${stat.first.slice(0, 10)} 起`}
        </p>
      </div>
      <div className="flex gap-1">
        {(['self', 'target', 'other'] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            className={cn(
              'rounded-md border px-2 py-1 text-[11px] transition',
              value === k ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {k === 'self' ? '我' : k === 'target' ? '对方' : '其他'}
          </button>
        ))}
      </div>
      <span className="w-full text-[10px] text-muted-foreground sm:w-auto">{KIND_LABEL[value]}</span>
    </div>
  )
}

function MiniStat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border p-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn('truncate text-sm', mono && 'font-mono text-xs')} title={value}>
        {value}
      </p>
    </div>
  )
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="gap-0.5 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </Card>
  )
}

function Bar({ label, value, total }: { label: string; value: number; total: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span>{label}</span>
        <span className="font-mono">{value}</span>
      </div>
      <Progress value={total ? Math.round((value / total) * 100) : 0} />
    </div>
  )
}

function fmtMin(m: number | null): string {
  if (m === null) return '—'
  if (m < 1) return '<1 分钟'
  if (m < 90) return `${Math.round(m)} 分钟`
  if (m < 60 * 36) return `${(m / 60).toFixed(1)} 小时`
  return `${(m / 60 / 24).toFixed(1)} 天`
}

function heatOption(
  r: ReturnType<typeof computeReciprocity>,
  t: ReturnType<typeof useTokens>,
): EChartsCoreOption {
  return {
    animation: false,
    grid: { left: 44, right: 16, top: 30, bottom: 44 },
    legend: { bottom: 0, textStyle: { color: t.muted, fontSize: 11 }, icon: 'roundRect', itemWidth: 10, itemHeight: 8 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: t.card,
      borderColor: t.border,
      textStyle: { color: t.fg, fontSize: 12 },
    },
    xAxis: {
      type: 'category',
      data: r.perDay.map((d) => d.date),
      axisLabel: { color: t.muted, fontSize: 10, rotate: r.perDay.length > 14 ? 45 : 0 },
      axisLine: { lineStyle: { color: t.border } },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: t.border, type: 'dashed' } },
      axisLabel: { color: t.muted, fontSize: 10 },
      minInterval: 1,
    },
    series: [
      {
        name: '我',
        type: 'bar',
        stack: 'total',
        data: r.perDay.map((d) => d.self),
        itemStyle: { color: t.primary },
        barMaxWidth: 18,
      },
      {
        name: '对方',
        type: 'bar',
        stack: 'total',
        data: r.perDay.map((d) => d.target),
        itemStyle: { color: t.up, opacity: 0.75 },
        barMaxWidth: 18,
      },
    ],
  }
}
