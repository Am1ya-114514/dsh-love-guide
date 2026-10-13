/**
 * 知识库检索层。
 *
 * 上游 skill 的做法是让模型自己「想到」去读哪个文件——那要求模型每轮都在正确的
 * 文件上，且目录一旦有偏差就静默漏掉。这里改成确定性的本地检索：先用中文友好的
 * 分词给 43 篇材料打分，再把命中的原文片段喂给模型，并要求模型逐条标注出处。
 *
 * 中文分词不用外部库：单字 + 二元组（bigram）能覆盖大部分主题词，
 * 且对「投入失衡」「聊天记录」「第一次见面」这类词天然给出正确的重叠度。
 */

import { KNOWLEDGE_DOCS, KNOWLEDGE_META } from '#/data/knowledge.generated'
import type { EvidenceTier, KnowledgeDoc } from './types'

export { KNOWLEDGE_DOCS, KNOWLEDGE_META }

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/
const LATIN = /[a-z0-9]/

/** 把查询切成可比对的原子：中文取单字与二元组，拉丁取整词。 */
export function tokenize(input: string): string[] {
  const text = input.toLowerCase()
  const tokens = new Set<string>()
  let latin = ''
  const flushLatin = () => {
    if (latin.length >= 2) tokens.add(latin)
    latin = ''
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (LATIN.test(ch)) {
      latin += ch
      continue
    }
    flushLatin()
    if (CJK.test(ch)) {
      tokens.add(ch)
      const next = text[i + 1]
      if (next && CJK.test(next)) tokens.add(ch + next)
    }
  }
  flushLatin()
  return [...tokens]
}

/** 领域同义词：用户不会总用知识库里的措辞。 */
const SYNONYMS: Record<string, string[]> = {
  已读不回: ['冷淡', '不回', '投入失衡', '降温'],
  秒回: ['回应速度', '投入', '热情'],
  舔狗: ['投入失衡', '单方面投入', '边界'],
  备胎: ['暧昧', '关系确认', '投入失衡'],
  表白: ['关系确认', '主动表达', '邀约'],
  拉黑: ['退出', '边界', '冲突'],
  扶弟魔: ['家庭', '金钱', '边界'],
  彩礼: ['婚姻', '家庭', '金钱'],
  相亲: ['认识渠道', '第一次见面', '家庭'],
  出轨: ['背叛', '信任', '关系修复'],
  异地: ['长期关系', '沟通频率'],
  pua: ['冷读', '操控', '风险边界'],
  k线: ['证据', '趋势', '可视化'],
  聊天记录: ['导入', '证据', '指标'],
  截图: ['聊天记录', '证据'],
  情绪价值: ['情绪支持', '共情'],
  冷场: ['接话', '尴尬', '话题'],
  尬聊: ['接话', '尴尬', '话题'],
  不会聊天: ['接话', '话术', '话题'],
  推进关系: ['关系确认', '邀约', '主动表达'],
  要不要继续: ['投入失衡', '退出决策', '互惠'],
}

function expand(query: string): string[] {
  const base = tokenize(query)
  const extra: string[] = []
  const lower = query.toLowerCase()
  for (const [key, vals] of Object.entries(SYNONYMS)) {
    if (lower.includes(key.toLowerCase())) extra.push(...vals.flatMap(tokenize))
  }
  return [...new Set([...base, ...extra])]
}

export interface RetrievedDoc {
  doc: KnowledgeDoc
  score: number
  /** 命中的原文片段，按相关度排。 */
  excerpts: string[]
  /** 命中来自标题还是正文。 */
  reason: string
}

export interface RetrieveOptions {
  /** 最多返回几篇，默认 4。上游 skill 的上限是 3；这里放宽到 4 但配合预算裁剪。 */
  limit?: number
  /** 结构预算：参与打分的正文字符数上限，默认整篇。 */
  maxCharsPerDoc?: number
  /** 只要知识库层，或只要实用材料层。 */
  kind?: 'knowledge' | 'practical' | 'all'
}

/** 按查询给全部材料打分并返回前 N 篇。 */
export function retrieve(query: string, options: RetrieveOptions = {}): RetrievedDoc[] {
  const { limit = 4, maxCharsPerDoc, kind = 'all' } = options
  const tokens = expand(query)
  if (tokens.length === 0) return []

  const pool = KNOWLEDGE_DOCS.filter((d) => kind === 'all' || d.kind === kind)

  const scored = pool.map((doc) => {
    const body = maxCharsPerDoc ? doc.text.slice(0, maxCharsPerDoc) : doc.text
    const lowerBody = body.toLowerCase()
    const title = doc.title.toLowerCase()
    const headingText = doc.headings.join(' ').toLowerCase()
    const field = `${doc.slug} ${doc.file}`.toLowerCase()

    let score = 0
    const hits = new Set<string>()
    for (const t of tokens) {
      if (t.length === 1) {
        // 单字太泛，只在标题/字段里计分
        if (title.includes(t)) score += 1.5
        if (field.includes(t)) score += 1
        continue
      }
      if (title.includes(t)) {
        score += 12
        hits.add(t)
      }
      if (field.includes(t)) score += 6
      if (headingText.includes(t)) {
        score += 5
        hits.add(t)
      }
      const occurrences = lowerBody.split(t).length - 1
      if (occurrences > 0) {
        score += Math.min(occurrences, 6) * 1.6
        hits.add(t)
      }
    }
    return { doc, score, hits: [...hits] }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.doc.number - b.doc.number)
    .slice(0, limit)
    .map((s) => ({
      doc: s.doc,
      score: Math.round(s.score * 10) / 10,
      excerpts: extractExcerpts(s.doc.text, s.hits),
      reason: s.hits.length ? `命中：${s.hits.join('、')}` : '标题弱相关',
    }))
}

/** 从正文里找出包含命中词的段落，返回最多 3 段、每段最多 420 字。 */
function extractExcerpts(text: string, hits: string[]): string[] {
  if (hits.length === 0) return []
  // 按空行 / 标题切块，尽量得到语义完整的段落
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 8 && !b.startsWith('```'))
  const ranked = blocks
    .map((b) => {
      const lower = b.toLowerCase()
      const score = hits.reduce((acc, h) => acc + (lower.split(h).length - 1), 0)
      return { b, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
  return ranked.map((x) => (x.b.length > 420 ? `${x.b.slice(0, 420)}…` : x.b))
}

/** 组装给模型的参考资料块，带明确的出处与引用要求。 */
export function buildReferenceBlock(hits: RetrievedDoc[], budgetChars = 5200): string {
  if (hits.length === 0) return ''
  const parts: string[] = []
  let used = 0
  for (const [i, hit] of hits.entries()) {
    const header = `【资料 ${i + 1}】${hit.doc.title}\n出处：references/${hit.doc.kind}/${hit.doc.file}` +
      (hit.doc.reviewDate ? `（复核日期 ${hit.doc.reviewDate}）` : '') +
      `\n相关度：${hit.score}｜${hit.reason}`
    const body = hit.excerpts.length ? hit.excerpts.join('\n…\n') : hit.doc.text.slice(0, 700)
    const chunk = `${header}\n${body}`
    if (used + chunk.length > budgetChars && parts.length > 0) break
    parts.push(chunk)
    used += chunk.length
  }
  return parts.join('\n\n———\n\n')
}

/** 按 tier 找一篇文章（公开案例面板用）。 */
export function findDoc(id: string): KnowledgeDoc | undefined {
  return KNOWLEDGE_DOCS.find((d) => d.id === id)
}

/**
 * 知识库自检：上游仓库里最容易腐坏的是「目录与文件不一致」。
 * 这里复用上游校验器的两条核心断言（编号连续 + 数量下限），
 * 在「知识库」面板里直接展示，改完文件立刻能看出来。
 */
export interface KnowledgeHealth {
  ok: boolean
  knowledge: number
  practical: number
  numbered: boolean
  missingNumbers: number[]
  noTitle: string[]
  noReviewDate: string[]
  empty: string[]
}

export function checkKnowledgeHealth(): KnowledgeHealth {
  const knowledge = KNOWLEDGE_DOCS.filter((d) => d.kind === 'knowledge')
  const practical = KNOWLEDGE_DOCS.filter((d) => d.kind === 'practical')
  const nums = knowledge.map((d) => d.number).filter((n) => n > 0).sort((a, b) => a - b)
  const missingNumbers: number[] = []
  for (let i = 1; i <= (nums.at(-1) ?? 0); i++) if (!nums.includes(i)) missingNumbers.push(i)
  const noTitle = KNOWLEDGE_DOCS.filter((d) => !d.title || d.title === d.file).map((d) => d.file)
  const noReviewDate = KNOWLEDGE_DOCS.filter((d) => !d.reviewDate).map((d) => d.file)
  const empty = KNOWLEDGE_DOCS.filter((d) => d.bytes < 200).map((d) => d.file)
  return {
    ok:
      knowledge.length >= 20 &&
      practical.length >= 23 &&
      missingNumbers.length === 0 &&
      empty.length === 0 &&
      noTitle.length === 0,
    knowledge: knowledge.length,
    practical: practical.length,
    numbered: missingNumbers.length === 0,
    missingNumbers,
    noTitle,
    noReviewDate,
    empty,
  }
}

/** 把检索到的证据等级映射到配色变量名。 */
export function tierColorVar(tier: EvidenceTier): string {
  return `var(--evidence-${tier === 'strong' ? 'strong' : tier === 'framework' ? 'framework' : tier === 'popular' ? 'popular' : tier === 'heuristic' ? 'heuristic' : 'insufficient'})`
}
