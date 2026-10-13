/**
 * 本地指标计算。
 *
 * 上游比赛项目把 K 线定义为「证据方向与完整度的可视化编码，不是概率模型」。
 * 这里延续该定义，并把它做成可复算的：同样的证据集合，算出来的指标必须一样。
 * 所以本文件全部是纯函数，不碰数据库、不碰网络。
 */

import { toDateKey } from './utils'
import type { Evidence, EvidenceCompleteness, EvidenceTier } from './types'

/** 把证据归集到交易日（这里是自然日）。 */
export interface Candle {
  date: string
  /** 当日证据数。 */
  total: number
  positive: number
  negative: number
  neutral: number
  insufficient: number
  /** 用于 K 线的开高低收：按证据权重累积出的「水位」。 */
  open: number
  close: number
  low: number
  high: number
  /** 完整度 0-100：有多少比例的当日证据是可判定的。 */
  completeness: number
  /** 这一根有没有资格被解释。 */
  tradable: boolean
  items: Evidence[]
}

export interface EvidenceWeights {
  polarity: Record<'positive' | 'negative' | 'neutral' | 'insufficient', number>
  tier: Record<EvidenceTier, number>
  completeness: Record<EvidenceCompleteness, number>
}

/**
 * 权重是可解释的，不是调出来的：
 *  - 方向只决定符号，不决定大小；
 *  - 等级决定这次「算不算数」（较强证据 1.0，经验策略 0.5）；
 *  - 完整度决定这条证据的可信折减。
 * 这三个都在 UI 里显示给用户，允许她质疑权重本身。
 */
export const DEFAULT_WEIGHTS: EvidenceWeights = {
  polarity: { positive: 1, negative: -1, neutral: 0, insufficient: 0 },
  tier: { strong: 1, framework: 0.8, popular: 0.45, heuristic: 0.55, insufficient: 0.1 },
  completeness: { high: 1, mid: 0.75, low: 0.5 },
}

function weightOf(e: Evidence, w: EvidenceWeights): number {
  return w.polarity[e.polarity] * w.tier[e.tier] * w.completeness[e.completeness]
}

/** 把证据按日聚合成 K 线。返回按日期升序的蜡烛序列。 */
export function buildCandles(evidence: Evidence[], weights: EvidenceWeights = DEFAULT_WEIGHTS): Candle[] {
  const byDate = new Map<string, Evidence[]>()
  for (const e of evidence) {
    const key = toDateKey(e.occurredAt) || toDateKey(e.createdAt) || '未标日期'
    const arr = byDate.get(key)
    if (arr) arr.push(e)
    else byDate.set(key, [e])
  }

  const dates = [...byDate.keys()].sort((a, b) => {
    if (a === '未标日期') return 1
    if (b === '未标日期') return -1
    return a.localeCompare(b)
  })

  const candles: Candle[] = []
  let level = 50 // 起始水位；只用相对变化，绝对值没有意义

  for (const date of dates) {
    const items = (byDate.get(date) ?? []).slice().sort((a, b) => a.createdAt - b.createdAt)
    const open = level
    let positive = 0
    let negative = 0
    let neutral = 0
    let insufficient = 0
    let judged = 0
    let weighted = 0

    for (const e of items) {
      // K 线每根内部的极值由逐条累加得到，这样单日多条证据也能画出身影
      weighted += weightOf(e, weights) * 6
      level += weightOf(e, weights) * 6
      if (e.polarity === 'positive') positive++
      else if (e.polarity === 'negative') negative++
      else if (e.polarity === 'neutral') neutral++
      else insufficient++
      if (e.completeness !== 'low' && e.polarity !== 'insufficient') judged++
    }

    const close = level
    const completeness = items.length === 0 ? 0 : Math.round((judged / items.length) * 100)
    candles.push({
      date,
      total: items.length,
      positive,
      negative,
      neutral,
      insufficient,
      open: round2(open),
      close: round2(close),
      low: round2(Math.min(open, close, close - Math.abs(weighted) * 0.15)),
      high: round2(Math.max(open, close, close + Math.abs(weighted) * 0.15)),
      completeness,
      // 与上游一致：低于阈值就归为「证据不足」，不许解释
      tradable: completeness >= 40 && items.length >= 1,
      items,
    })
  }
  return candles
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** 简单移动平均；周期不足的位置返回 null，让 ECharts 断开而不是画错。 */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    out.push(i >= period - 1 ? round2(sum / period) : null)
  }
  return out
}

export interface RelationMetrics {
  /** 证据总数。 */
  evidenceCount: number
  /** 有证据的天数。 */
  activeDays: number
  /** 正负比（升温证据 / 降温证据），分母为 0 时为 null。 */
  polarityRatio: number | null
  /** 平均完整度 0-100。 */
  avgCompleteness: number
  /** 最近一次证据距今天数。 */
  daysSinceLast: number | null
  /** 最近 14 天的方向净额（加权）。 */
  recentNet: number
  /** 更早 14 天的方向净额，用于看趋势拐点。 */
  previousNet: number
  /** 相位判读。 */
  phase: '升温' | '平台' | '降温' | '证据不足'
  /** 互惠观察：主动发起 vs 回应的比例（来自聊天记录，没有记录则为 null）。 */
  reciprocity: ReciprocityMetrics | null
}

export function computeMetrics(
  evidence: Evidence[],
  reciprocity: ReciprocityMetrics | null = null,
  now = Date.now(),
): RelationMetrics {
  const candles = buildCandles(evidence)
  const positive = evidence.filter((e) => e.polarity === 'positive').length
  const negative = evidence.filter((e) => e.polarity === 'negative').length
  const judged = evidence.filter((e) => e.polarity !== 'insufficient')
  const avgCompleteness = judged.length
    ? Math.round(
        (evidence.reduce(
          (acc, e) => acc + (e.completeness === 'high' ? 100 : e.completeness === 'mid' ? 70 : 40),
          0,
        ) /
          evidence.length) || 0,
      )
    : 0

  const dated = evidence
    .map((e) => toDateKey(e.occurredAt) || toDateKey(e.createdAt))
    .filter((d) => d.length > 0)
    .sort()
  const last = dated.at(-1)
  const daysSinceLast = last ? Math.floor((now - new Date(`${last}T00:00:00`).getTime()) / 86400000) : null

  const dayMs = 86400000
  const recentNet = netBetween(evidence, now - 14 * dayMs, now)
  const previousNet = netBetween(evidence, now - 28 * dayMs, now - 14 * dayMs)

  let phase: RelationMetrics['phase'] = '证据不足'
  if (candles.length >= 2) {
    const delta = recentNet - previousNet
    if (recentNet > 0.8 && delta >= 0) phase = '升温'
    else if (recentNet < -0.8 && delta <= 0) phase = '降温'
    else if (Math.abs(recentNet) <= 0.8) phase = '平台'
    else phase = delta > 0 ? '升温' : '降温'
  } else if (candles.length === 1) {
    phase = recentNet > 0 ? '升温' : recentNet < 0 ? '降温' : '平台'
  }

  return {
    evidenceCount: evidence.length,
    activeDays: candles.length,
    polarityRatio: negative === 0 ? (positive === 0 ? null : Number.POSITIVE_INFINITY) : Math.round((positive / negative) * 100) / 100,
    avgCompleteness,
    daysSinceLast,
    recentNet: round2(recentNet),
    previousNet: round2(previousNet),
    phase,
    reciprocity,
  }
}

function netBetween(evidence: Evidence[], from: number, to: number): number {
  let sum = 0
  for (const e of evidence) {
    const key = toDateKey(e.occurredAt) || toDateKey(e.createdAt)
    if (!key) continue
    const t = new Date(`${key}T00:00:00`).getTime()
    if (t >= from && t < to) sum += weightOf(e, DEFAULT_WEIGHTS)
  }
  return sum
}

/* ---------------------------------------------------------------------------
 * 聊天记录指标（对应上游 ChatLab 适配文档里的四步工作流）
 * ------------------------------------------------------------------------- */

export interface ReciprocityMetrics {
  total: number
  selfCount: number
  targetCount: number
  /** 由用户主动发起、且对象有回应的次数。 */
  selfInitiated: number
  /** 由对象主动发起、且用户有回应的次数。 */
  targetInitiated: number
  /** 平均回复间隔（分钟），按"上一条是对方、下一条是用户"统计。 */
  avgSelfReplyMinutes: number | null
  avgTargetReplyMinutes: number | null
  /** 按日期的消息条数，用于热力图。 */
  perDay: { date: string; self: number; target: number }[]
  /** 情绪词粗统计：只数关键词，不做情感模型。 */
  toneHits: { positive: number; negative: number }
}

const POSITIVE_WORDS = ['哈哈', '开心', '好呀', '好的', '想看', '期待', '喜欢', '抱抱', '晚安', '么么', '!', '！', '~']
const NEGATIVE_WORDS = ['忙', '算了', '不用', '没空', '再说', '嗯', '哦', '好吧', '累', '烦', '不想']

export function computeReciprocity(
  messages: { sender: string; speaker: 'self' | 'target' | 'other'; content: string; sentAt: string }[],
): ReciprocityMetrics {
  const parsed = messages
    .map((m) => ({ ...m, t: Date.parse(normalizeTime(m.sentAt)) }))
    .filter((m) => Number.isFinite(m.t))
    .sort((a, b) => a.t - b.t)

  const perDayMap = new Map<string, { self: number; target: number }>()
  let selfCount = 0
  let targetCount = 0
  let selfInitiated = 0
  let targetInitiated = 0
  let selfReplies: number[] = []
  let targetReplies: number[] = []
  let positive = 0
  let negative = 0

  for (const m of parsed) {
    const day = toDateKey(m.t)
    if (day) {
      const cur = perDayMap.get(day) ?? { self: 0, target: 0 }
      if (m.speaker === 'self') cur.self++
      if (m.speaker === 'target') cur.target++
      perDayMap.set(day, cur)
    }
    if (m.speaker === 'self') selfCount++
    if (m.speaker === 'target') targetCount++
    for (const w of POSITIVE_WORDS) if (m.content.includes(w)) positive++
    for (const w of NEGATIVE_WORDS) if (m.content.includes(w)) negative++
  }

  // 会话切分：间隔超过 6 小时算新的一次会话，会话首条是谁发的即为谁发起
  const SESSION_GAP = 6 * 3600 * 1000
  let sessionStart = 0
  for (let i = 0; i < parsed.length; i++) {
    const cur = parsed[i]
    if (i === 0 || cur.t - parsed[i - 1].t > SESSION_GAP) {
      sessionStart = i
      if (cur.speaker === 'self') selfInitiated++
      else if (cur.speaker === 'target') targetInitiated++
    }
    // 回复间隔：紧邻的两条，方向决定是谁在回谁
    if (i > sessionStart) {
      const prev = parsed[i - 1]
      const gapMin = (cur.t - prev.t) / 60000
      if (gapMin <= 6 * 60) {
        if (prev.speaker === 'target' && cur.speaker === 'self') selfReplies.push(gapMin)
        if (prev.speaker === 'self' && cur.speaker === 'target') targetReplies.push(gapMin)
      }
    }
  }

  return {
    total: parsed.length,
    selfCount,
    targetCount,
    selfInitiated,
    targetInitiated,
    avgSelfReplyMinutes: avg(selfReplies),
    avgTargetReplyMinutes: avg(targetReplies),
    perDay: [...perDayMap.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    toneHits: { positive, negative },
  }
}

function avg(xs: number[]): number | null {
  if (xs.length === 0) return null
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
}

/** 容忍 2026/8/2 15:03、2026-08-02 15:03:00、08-02 15:03 等写法。 */
export function normalizeTime(input: string): string {
  const s = input.trim()
  if (!s) return ''
  const m = s.match(
    /^(?:(\d{4})[-/.年])?(\d{1,2})[-/.月](\d{1,2})日?\s*(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?/,
  )
  if (!m) return s
  const year = m[1] ? Number(m[1]) : new Date().getFullYear()
  const p = (n?: string) => String(Number(n ?? 0)).padStart(2, '0')
  return `${year}-${p(m[2])}-${p(m[3])}T${p(m[4])}:${p(m[5])}:${p(m[6])}`
}

/* ---------------------------------------------------------------------------
 * 证据 → ECharts 的 candlestick 数据
 * ------------------------------------------------------------------------- */

export interface KlineSeries {
  dates: string[]
  /** ECharts candlestick 的顺序：[open, close, low, high]。 */
  ohlc: [number, number, number, number][]
  volumes: number[]
  /** 供 tooltip 用的还原信息。 */
  candles: Candle[]
  /** 均线。 */
  ma5: (number | null)[]
  ma10: (number | null)[]
  ma20: (number | null)[]
}

export function buildKline(candles: Candle[]): KlineSeries {
  const closes = candles.map((c) => c.close)
  return {
    dates: candles.map((c) => c.date),
    ohlc: candles.map((c) => [c.open, c.close, c.low, c.high] as [number, number, number, number]),
    volumes: candles.map((c) => c.total),
    candles,
    ma5: sma(closes, 5),
    ma10: sma(closes, 10),
    ma20: sma(closes, 20),
  }
}
