import { useMemo, useState } from 'react'
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconPlus,
  IconTargetArrow,
  IconTrash,
  IconTrendingDown,
  IconTrendingUp,
  IconClockHour4,
} from '@tabler/icons-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Progress } from '#/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { Textarea } from '#/components/ui/textarea'
import { EChart, type EChartsCoreOption } from '#/lib/echart'
import { buildCandles, buildKline, computeReciprocity, computeMetrics, type Candle, type KlineSeries } from '#/lib/metrics'
import { selectActiveRealm, useStudio } from '#/lib/store'
import { useTokens } from '#/lib/theme'
import { EVIDENCE_TIER_DESC, EVIDENCE_TIER_LABEL, POLARITY_LABEL } from '#/lib/types'
import type { Evidence, EvidenceCompleteness, EvidencePolarity, EvidenceTier } from '#/lib/types'
import { cn, toDateKey } from '#/lib/utils'

const PHASE_STYLE: Record<string, { cls: string; icon: typeof IconTrendingUp }> = {
  升温: { cls: 'text-[var(--chart-up)]', icon: IconTrendingUp },
  降温: { cls: 'text-[var(--chart-down)]', icon: IconTrendingDown },
  平台: { cls: 'text-muted-foreground', icon: IconTargetArrow },
  证据不足: { cls: 'text-muted-foreground', icon: IconAlertTriangle },
}

export function EvidenceView() {
  const realm = useStudio(selectActiveRealm)
  const evidence = useStudio((s) => s.evidence)
  const chatLogs = useStudio((s) => s.chatLogs)
  const tokens = useTokens()

  // 注意：这里必须用 useMemo 自己派生，不能写成 useStudio(selectCandles) 那种选择器。
  // Zustand v5 内部走 useSyncExternalStore，选择器每次返回新数组就会被判定成
  // 「快照一直在变」，触发 setState-in-render 的无限循环（实测直接把页面打崩）。
  const candles = useMemo(() => buildCandles(evidence), [evidence])
  const kline = useMemo(() => buildKline(candles), [candles])
  const reciprocity = useMemo(() => (chatLogs.length ? computeReciprocity(chatLogs) : null), [chatLogs])
  const metrics = useMemo(() => computeMetrics(evidence, reciprocity), [evidence, reciprocity])

  if (!realm) return <NoRealm />

  const judged = evidence.filter((e) => e.polarity !== 'insufficient').length
  const ratio = judged ? Math.round((evidence.filter((e) => e.polarity === 'positive').length / judged) * 100) : 0
  const Phase = PHASE_STYLE[metrics.phase]

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            icon={<Phase.icon className={cn('size-4', Phase.cls)} />}
            label="相位判读"
            value={metrics.phase}
            hint={`近 14 天净额 ${metrics.recentNet >= 0 ? '+' : ''}${metrics.recentNet.toFixed(2)}（上一周期 ${metrics.previousNet >= 0 ? '+' : ''}${metrics.previousNet.toFixed(2)}）`}
            valueClass={Phase.cls}
          />
          <MetricCard
            icon={<IconCircleCheck className="size-4" />}
            label="可判定证据"
            value={`${judged}/${evidence.length}`}
            hint={`升温占比 ${ratio}% · 活跃 ${metrics.activeDays} 天`}
          />
          <MetricCard
            icon={<IconAlertTriangle className="size-4" />}
            label="平均完整度"
            value={`${metrics.avgCompleteness}%`}
            hint="完整度低说明单条记录的信息量不足以定方向"
          />
          <MetricCard
            icon={<IconClockHour4 className="size-4" />}
            label="距上次证据"
            value={metrics.daysSinceLast === null ? '—' : `${metrics.daysSinceLast} 天`}
            hint="间隔本身就说明节奏，不用急着补"
          />
        </div>

        <Tabs defaultValue="chart">
          <TabsList>
            <TabsTrigger value="chart">推演图</TabsTrigger>
            <TabsTrigger value="ledger">
              证据台账
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                {evidence.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chart" className="space-y-4">
            <KlinePanel candles={candles} kline={kline} option={buildOption(candles, kline, tokens)} />
            <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
              <DecisionPanel />
              <MetricDetail metrics={metrics} reciprocity={reciprocity} />
            </div>
          </TabsContent>

          <TabsContent value="ledger">
            <EvidenceLedger evidence={evidence} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function NoRealm() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md space-y-2 text-center">
        <h2 className="text-base font-semibold">还没有选中的档案</h2>
        <p className="text-sm text-muted-foreground">
          先在左侧「建立关系档案」，或载入一个公开合成案例。证据是按对象隔离存储的——
          不同对象之间的记录不会互相污染。
        </p>
      </div>
    </div>
  )
}

function MetricCard({
  icon,
  label,
  value,
  hint,
  valueClass,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint: string
  valueClass?: string
}) {
  return (
    <Card className="gap-1 p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className={cn('text-xl font-semibold tracking-tight', valueClass)}>{value}</p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
    </Card>
  )
}

function KlinePanel({
  candles,
  kline,
  option,
}: {
  candles: Candle[]
  kline: KlineSeries
  option: EChartsCoreOption
}) {
  const [picked, setPicked] = useState<Candle | null>(null)
  const detail = picked ?? candles[candles.length - 1] ?? null

  if (candles.length === 0) {
    return (
      <Card className="items-center gap-2 p-10 text-center">
        <IconTargetArrow className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">还没有任何证据</p>
        <p className="max-w-md text-xs text-muted-foreground">
          推演图不是凭空生成的：它只编码你记录下来的证据方向与完整度。先在「证据台账」里录两条，
          或者去「聊天记录」导入一段对话让系统抽出候选证据。
        </p>
      </Card>
    )
  }

  return (
    <Card className="gap-3 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-[var(--chart-up)]" />
            升温
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-[var(--chart-down)]" />
            降温
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-[var(--chart-flat)]" />
            证据不足
          </span>
          <span className="text-border">|</span>
          <span>柱高 = 当日证据条数</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          共 {kline.dates.length} 根 · 最新 {kline.dates.at(-1)}
        </p>
      </div>

      <EChart option={option} height={340} onEvents={{ click: (p) => {
        const params = p as { componentType?: string; dataIndex?: number }
        if (params.componentType === 'series' && typeof params.dataIndex === 'number') {
          setPicked(candles[params.dataIndex] ?? null)
        }
      } }} />

      {detail && <CandleDetail candle={detail} onClear={picked ? () => setPicked(null) : undefined} />}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        这不是行情预测模型。K 线只是把「已经记录下来的证据」按方向和完整度做了一次可视化编码；
        完整度低于阈值的日子会被标成「证据不足」，那种时候正确的动作是补证据，不是下结论。
      </p>
    </Card>
  )
}

function CandleDetail({ candle, onClear }: { candle: Candle; onClear?: () => void }) {
  const tierCount = new Map<EvidenceTier, number>()
  for (const it of candle.items) tierCount.set(it.tier, (tierCount.get(it.tier) ?? 0) + 1)

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-xs">{candle.date}</span>
        <Badge variant="secondary" className="h-4 px-1 text-[10px]">
          {candle.total} 条
        </Badge>
        <Badge variant={candle.tradable ? 'secondary' : 'outline'} className="h-4 px-1 text-[10px]">
          完整度 {candle.completeness}%
        </Badge>
        {!candle.tradable && (
          <Badge variant="outline" className="h-4 border-amber-500/50 px-1 text-[10px] text-amber-600">
            证据不足
          </Badge>
        )}
        {onClear && (
          <button type="button" onClick={onClear} className="ml-auto text-[11px] text-muted-foreground hover:text-foreground">
            返回最新
          </button>
        )}
      </div>
      <ul className="space-y-1.5">
        {candle.items.map((it) => (
          <li key={it.id} className="flex items-start gap-2 text-xs">
            <span
              className={cn(
                'mt-1 size-1.5 shrink-0 rounded-full',
                it.polarity === 'positive' && 'bg-[var(--chart-up)]',
                it.polarity === 'negative' && 'bg-[var(--chart-down)]',
                it.polarity === 'neutral' && 'bg-muted-foreground',
                it.polarity === 'insufficient' && 'bg-[var(--evidence-insufficient)]',
              )}
            />
            <span className="min-w-0 flex-1">{it.summary}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {EVIDENCE_TIER_LABEL[it.tier]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DecisionPanel() {
  const messages = useStudio((s) => s.messages)
  const realm = useStudio(selectActiveRealm)
  const toast = useStudio((s) => s.toast)

  const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.action)
  const action = last?.action

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center gap-2">
        <IconTargetArrow className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">当前一步</h3>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {realm ? `对象：${realm.name}` : ''}
        </span>
      </div>

      {!action ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          还没有可执行的结论。去「对话」里问一次，军师会给出一张行动卡：下一步、观察窗口、
          停止条件，以及能直接复制走的话术。那张卡会自动出现在这里。
        </p>
      ) : (
        <div className="space-y-3">
          <Field label="下一步" value={action.next} />
          <Field label="观察窗口" value={action.window} />
          <Field label="停止条件" value={action.stop} tone="danger" />

          {action.scripts.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground">可直接发送的话术</p>
              {action.scripts.map((s) => (
                <div key={s.label} className="rounded-lg border p-2.5">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                      {s.label}
                    </Badge>
                    <button
                      type="button"
                      className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={async () => {
                        await navigator.clipboard.writeText(s.text)
                        toast('ok', '已复制。发送前请自己再读一遍——话术要像你说的话。')
                      }}
                    >
                      复制
                    </button>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{s.text}</p>
                  {s.cost && (
                    <p className="mt-1.5 border-t pt-1.5 text-[11px] text-muted-foreground">代价：{s.cost}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <Button
            className="w-full"
            onClick={() => toast('ok', '已标记为「采用这一步」。去对话里说说执行结果，军师会据此更新判断。')}
          >
            标记为已采用
          </Button>
        </div>
      )}
    </Card>
  )
}

function Field({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="rounded-lg border p-2.5">
      <p className="mb-1 text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={cn('text-sm leading-relaxed whitespace-pre-wrap', tone === 'danger' && 'text-destructive')}>
        {value || '—'}
      </p>
    </div>
  )
}

function MetricDetail({
  metrics,
  reciprocity,
}: {
  metrics: ReturnType<typeof computeMetrics>
  reciprocity: ReturnType<typeof computeReciprocity> | null
}) {
  return (
    <Card className="gap-4 p-4">
      <h3 className="text-sm font-semibold">互惠观察</h3>
      {!reciprocity ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          还没有导入聊天记录，所以算不出「谁在主动、谁在回应」。这一项刻意留空而不是猜——
          投入是否失衡，取决于发起与回应的比例，不取决于感觉。
        </p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span>我发起</span>
              <span className="font-mono">{reciprocity.selfInitiated}</span>
            </div>
            <Progress value={pct(reciprocity.selfInitiated, reciprocity.total)} />
            <div className="flex items-center justify-between text-xs">
              <span>对方发起</span>
              <span className="font-mono">{reciprocity.targetInitiated}</span>
            </div>
            <Progress value={pct(reciprocity.targetInitiated, reciprocity.total)} />
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="我的消息" value={String(reciprocity.selfCount)} />
            <Stat label="对方消息" value={String(reciprocity.targetCount)} />
            <Stat
              label="情绪词比"
              value={`${reciprocity.toneHits.positive}/${reciprocity.toneHits.negative}`}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 text-center">
            <Stat
              label="我的平均回复间隔"
              value={fmtMinutes(reciprocity.avgSelfReplyMinutes)}
            />
            <Stat
              label="对方的平均回复间隔"
              value={fmtMinutes(reciprocity.avgTargetReplyMinutes)}
            />
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            情绪词只做关键词计数，不做情感模型。回复间隔受作息和场合影响极大，只能和你自己的日常节奏比，
            不要跨人比较。
          </p>
        </div>
      )}

      {metrics.reciprocity === null && reciprocity !== null && (
        <p className="text-[11px] text-muted-foreground">（互惠数据已计算，但未接入上面的相位判读。）</p>
      )}
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="font-mono text-sm">{value}</p>
    </div>
  )
}

function pct(part: number, total: number): number {
  if (!total) return 0
  return Math.round((part / total) * 100)
}

function fmtMinutes(m: number | null): string {
  if (m === null) return '—'
  if (m < 1) return '<1 分钟'
  if (m < 90) return `${Math.round(m)} 分钟`
  if (m < 60 * 36) return `${(m / 60).toFixed(1)} 小时`
  return `${(m / 60 / 24).toFixed(1)} 天`
}

/* ----------------------------------------------------------------------------
 * 证据台账
 * ------------------------------------------------------------------------- */

const POLARITIES: EvidencePolarity[] = ['positive', 'negative', 'neutral', 'insufficient']
const COMPLETENESS: EvidenceCompleteness[] = ['low', 'mid', 'high']
const TIERS: EvidenceTier[] = ['strong', 'framework', 'popular', 'heuristic', 'insufficient']

const COMPLETENESS_LABEL: Record<EvidenceCompleteness, string> = {
  low: '低 · 只有一句半句',
  mid: '中 · 有来龙去脉',
  high: '高 · 有原文与上下文',
}

function EvidenceLedger({ evidence }: { evidence: Evidence[] }) {
  const addEvidence = useStudio((s) => s.addEvidence)
  const [open, setOpen] = useState(false)
  // 日期输入框的默认值只在挂载时算一次：放在渲染期直接调 Date.now() 会在
  // 并发渲染下给出不稳定的结果，React Compiler 也会因此跳过这个组件。
  const [today] = useState(() => toDateKey(Date.now()))

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">证据台账</h3>
        <p className="text-[11px] text-muted-foreground">
          每条证据 = 一个「可判定的单元」。判不了方向的，就诚实标成证据不足。
        </p>
        <Button size="sm" variant={open ? 'secondary' : 'outline'} className="ml-auto gap-1.5" onClick={() => setOpen((v) => !v)}>
          <IconPlus className="size-3.5" />
          {open ? '收起' : '手动加一条'}
        </Button>
      </div>

      {open && (
        <form
          className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            const created = await addEvidence({
              summary: String(fd.get('summary') ?? ''),
              polarity: fd.get('polarity') as EvidencePolarity,
              completeness: fd.get('completeness') as EvidenceCompleteness,
              tier: fd.get('tier') as EvidenceTier,
              occurredAt: String(fd.get('occurredAt') ?? ''),
              rawExcerpt: String(fd.get('rawExcerpt') ?? '') || undefined,
              origin: 'manual',
              tags: [],
            })
            if (created) (e.target as HTMLFormElement).reset()
          }}
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ev-summary">这条证据是什么（一句话）</Label>
            <Input id="ev-summary" name="summary" required placeholder="例如：她主动把周末的安排发给我，并问我要不要一起" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-date">发生日期</Label>
            <Input id="ev-date" name="occurredAt" type="date" defaultValue={today} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-pol">方向</Label>
            <select id="ev-pol" name="polarity" defaultValue="positive" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm">
              {POLARITIES.map((p) => (
                <option key={p} value={p}>
                  {POLARITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-comp">完整度</Label>
            <select id="ev-comp" name="completeness" defaultValue="mid" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm">
              {COMPLETENESS.map((c) => (
                <option key={c} value={c}>
                  {COMPLETENESS_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-tier">来源等级</Label>
            <select id="ev-tier" name="tier" defaultValue="heuristic" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm">
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {EVIDENCE_TIER_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ev-raw">原始片段（可选，只存在本机）</Label>
            <Textarea id="ev-raw" name="rawExcerpt" rows={2} placeholder="粘贴原话。默认不会发给模型。" />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm">
              记入台账
            </Button>
          </div>
        </form>
      )}

      {evidence.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">台账是空的。先记两条，推演图才会有东西可画。</p>
      ) : (
        <ul className="divide-y">
          {[...evidence].reverse().map((e) => (
            <EvidenceRow key={e.id} e={e} />
          ))}
        </ul>
      )}
    </Card>
  )
}

function EvidenceRow({ e }: { e: Evidence }) {
  const update = useStudio((s) => s.updateEvidence)
  const remove = useStudio((s) => s.deleteEvidence)

  return (
    <li className="group flex items-start gap-3 py-2.5">
      <span
        className={cn(
          'mt-1.5 size-2 shrink-0 rounded-full',
          e.polarity === 'positive' && 'bg-[var(--chart-up)]',
          e.polarity === 'negative' && 'bg-[var(--chart-down)]',
          e.polarity === 'neutral' && 'bg-muted-foreground',
          e.polarity === 'insufficient' && 'bg-[var(--evidence-insufficient)]',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{e.summary}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="font-mono">{e.occurredAt || toDateKey(e.createdAt)}</span>
          <span>·</span>
          <span>{POLARITY_LABEL[e.polarity]}</span>
          <span>·</span>
          <span title={EVIDENCE_TIER_DESC[e.tier]}>{EVIDENCE_TIER_LABEL[e.tier]}</span>
          <span>·</span>
          <span>完整度 {e.completeness === 'high' ? '高' : e.completeness === 'mid' ? '中' : '低'}</span>
          {e.origin !== 'manual' && (
            <>
              <span>·</span>
              <span>{e.origin === 'chat' ? '来自聊天记录' : e.origin === 'ai' ? 'AI 抽取' : '公开案例'}</span>
            </>
          )}
          {e.needsReview && (
            <Badge variant="outline" className="h-4 border-amber-500/50 px-1 text-[10px] text-amber-600">
              待你确认
            </Badge>
          )}
        </div>
        {e.rawExcerpt && (
          <p className="mt-1.5 border-l-2 pl-2 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
            {e.rawExcerpt}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
        {e.polarity !== 'insufficient' && (
          <Button
            size="xs"
            variant="ghost"
            title="标成证据不足"
            onClick={() => void update(e.id, { polarity: 'insufficient' })}
          >
            存疑
          </Button>
        )}
        {e.needsReview && (
          <Button size="xs" variant="ghost" title="确认这条" onClick={() => void update(e.id, { needsReview: false })}>
            确认
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-destructive"
          title="删除"
          onClick={() => void remove(e.id)}
        >
          <IconTrash className="size-3.5" />
        </Button>
      </div>
    </li>
  )
}

/* ----------------------------------------------------------------------------
 * ECharts option
 * ------------------------------------------------------------------------- */

function buildOption(
  candles: Candle[],
  kline: KlineSeries,
  t: ReturnType<typeof useTokens>,
): EChartsCoreOption {
  const axis = { type: 'category' as const, data: kline.dates, boundaryGap: true }
  return {
    animation: false,
    grid: [
      { left: 56, right: 18, top: 28, height: 232 },
      { left: 56, right: 18, top: 288, height: 56 },
    ],
    xAxis: [
      { ...axis, axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.muted, fontSize: 10 }, splitLine: { show: false } },
      { ...axis, gridIndex: 1, axisLine: { lineStyle: { color: t.border } }, axisLabel: { show: false }, splitLine: { show: false } },
    ],
    yAxis: [
      {
        scale: true,
        splitLine: { lineStyle: { color: t.border, type: 'dashed' } },
        axisLabel: { color: t.muted, fontSize: 10 },
      },
      {
        gridIndex: 1,
        splitLine: { show: false },
        axisLabel: { color: t.muted, fontSize: 10 },
        minInterval: 1,
      },
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      backgroundColor: t.card,
      borderColor: t.border,
      textStyle: { color: t.fg, fontSize: 12 },
      formatter: (raw: unknown) => {
        const params = raw as { axisValue?: string; seriesName?: string; value?: unknown }[]
        const date = params[0]?.axisValue ?? ''
        const i = kline.dates.indexOf(date)
        const c = candles[i]
        if (!c) return date
        const dirs = [
          c.positive ? `升温 ${c.positive}` : '',
          c.negative ? `降温 ${c.negative}` : '',
          c.neutral ? `持平 ${c.neutral}` : '',
          c.insufficient ? `不足 ${c.insufficient}` : '',
        ].filter(Boolean)
        const lines = [
          `<b>${date}</b>`,
          `证据 ${c.total} 条（${dirs.join(' / ') || '—'}）`,
          `完整度 ${c.completeness}%${c.tradable ? '' : ' · 证据不足'}`,
          `水位 开 ${c.open.toFixed(2)} 收 ${c.close.toFixed(2)}`,
          c.items.length ? `· ${c.items[0].summary.slice(0, 40)}` : '',
        ].filter(Boolean)
        return lines.join('<br/>')
      },
    },
    legend: {
      data: ['水位', 'MA5', 'MA10', 'MA20'],
      bottom: 0,
      textStyle: { color: t.muted, fontSize: 11 },
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 3,
    },
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1], start: 0, end: 100 }],
    series: [
      {
        name: '水位',
        type: 'candlestick',
        data: kline.ohlc,
        barMaxWidth: 16,
        itemStyle: {
          color: t.up,
          color0: t.down,
          borderColor: t.up,
          borderColor0: t.down,
        },
      },
      ...[
        { name: 'MA5', data: kline.ma5 },
        { name: 'MA10', data: kline.ma10 },
        { name: 'MA20', data: kline.ma20 },
      ].map((m, i) => ({
        name: m.name,
        type: 'line' as const,
        data: m.data,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 1.2, opacity: 0.75 },
        color: [t.primary, '#d97706', '#0d9488'][i],
        connectNulls: true,
      })),
      {
        name: '证据条数',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: candles.map((c) => ({
          value: c.total,
          itemStyle: {
            color:
              c.negative > c.positive
                ? t.down
                : c.positive > c.negative
                  ? t.up
                  : t.flat,
            opacity: c.tradable ? 0.9 : 0.35,
          },
        })),
        barMaxWidth: 14,
      },
    ],
  }
}
