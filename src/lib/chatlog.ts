/**
 * 聊天记录解析层。
 *
 * 上游流程（documentation/flows.md 第 4 条 / ChatLab 适配文档）对这一步有三条硬要求：
 *  1. 先做「干跑」——只报格式与数量，不把正文摊到屏幕上；
 *  2. 长记录必须先锁定「说话人映射」，否则后面所有互惠指标都是错的；
 *  3. 原始聊天不写入长期记忆。
 *
 * 因此这里只做「文本 → 结构化行」的确定性工作，不做任何推断：
 * 谁是用户自己、谁是目标对象，一律由用户在 UI 上确认，不靠猜。
 */

export interface ParsedRow {
  sender: string
  content: string
  sentAt: string
}

export interface SenderStat {
  name: string
  count: number
  first: string
  last: string
  /** 平均字数，用来粗判谁是「话多的那一方」。 */
  avgChars: number
}

export interface ParseResult {
  ok: boolean
  format: string
  rows: ParsedRow[]
  senders: SenderStat[]
  /** 有多少行没带时间戳。 */
  withoutTime: number
  /** 被当成上一条续行的行数（多行消息）。 */
  continuations: number
  warnings: string[]
}

const TS_BODY = String.raw`\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?`

const RE_TS_FIRST = new RegExp(
  String.raw`^\s*[\[\(【]?\s*(${TS_BODY})\s*[\]\)】]?\s*[-–—|]?\s*([^:：]{1,24}?)\s*[:：]?\s*(.*)$`,
)
const RE_NAME_FIRST = new RegExp(
  String.raw`^\s*[\[\(【]?\s*([^:：\[\]\(\)【】]{1,24}?)\s*[\]\)】]?\s*[:：]?\s*[\[\(【]?\s*(${TS_BODY})\s*[\]\)】]?\s*[:：]?\s*(.*)$`,
)
const RE_ANGLE = /^\s*[<＜【[]\s*([^>＞】\]]{1,24})\s*[>＞】\]]\s*(?:[:：]\s*)?(.*)$/
const RE_NAME_ONLY = /^\s*([^:：\s]{1,24})\s*[:：]\s*(.+)$/

/** 归一成 `YYYY-MM-DD HH:mm:ss`；认不出来就返回空串。 */
export function normalizeSentAt(input: string | number | undefined | null): string {
  if (input === undefined || input === null || input === '') return ''
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return ''
    // 10 位当秒，13 位当毫秒。
    const ms = input > 1e11 ? input : input * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? '' : fmt(d)
  }
  const s = String(input).trim()
  if (/^\d{10}$/.test(s)) return normalizeSentAt(Number(s))
  if (/^\d{13}$/.test(s)) return normalizeSentAt(Number(s))

  const m = s.match(
    /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  )
  if (m) {
    const [, y, mo, d, h = '0', mi = '0', sec = '0'] = m
    return `${y}-${pad(+mo)}-${pad(+d)} ${pad(+h)}:${pad(+mi)}:${pad(+sec)}`
  }
  const t = Date.parse(s)
  if (Number.isFinite(t)) return fmt(new Date(t))
  return ''
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 清掉 QQ 导出里的 `小北(123456)`、`小北<abc@qq.com>` 之类后缀。 */
function cleanSender(raw: string): string {
  return raw
    .replace(/[（(][^）)]*[）)]\s*$/, '')
    .replace(/<[^>]*>\s*$/, '')
    .replace(/^(?:\[|\(|【)|(?:\]|\)|】)$/g, '')
    .trim()
}

function looksLikeNoise(line: string): boolean {
  return (
    /^=+.*(消息记录|聊天记录|Message|Export).*=+$/i.test(line) ||
    /^(消息记录|聊天记录|导出时间|导出工具|Message Record)/.test(line) ||
    /^-{2,}$/.test(line)
  )
}

/* ----------------------------------------------------------------------------
 * JSON（ChatLab / 通用导出）
 * ------------------------------------------------------------------------- */

const SENDER_KEYS = ['sender', 'talker', 'from', 'name', 'nickName', 'nickname', 'userName', 'speaker', 'author', 'accountName']
const CONTENT_KEYS = ['content', 'text', 'message', 'msg', 'body', 'plainText']
const TIME_KEYS = ['sentAt', 'time', 'createTime', 'timestamp', 'date', 'datetime', 'sendTime', 'ts']

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim()) return v
    if (typeof v === 'number') return String(v)
  }
  return undefined
}

function tryJson(raw: string): ParseResult | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch {
    return null
  }

  let arr: unknown[] | null = null
  let format = 'JSON 数组'
  if (Array.isArray(data)) {
    arr = data
  } else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    for (const key of ['messages', 'records', 'list', 'items', 'data', 'chatRecords']) {
      if (Array.isArray(o[key])) {
        arr = o[key] as unknown[]
        format = `JSON 对象（${key}）`
        break
      }
    }
    // ChatLab 风格的 sessions[].messages
    if (!arr && Array.isArray(o.sessions)) {
      const flat: unknown[] = []
      for (const s of o.sessions as unknown[]) {
        if (s && typeof s === 'object') {
          const sm = (s as Record<string, unknown>).messages
          if (Array.isArray(sm)) flat.push(...sm)
        }
      }
      if (flat.length) {
        arr = flat
        format = 'ChatLab sessions（已合并全部会话）'
      }
    }
  }
  if (!arr) return null

  const warnings: string[] = []
  const rows: ParsedRow[] = []
  let skipped = 0
  for (const item of arr) {
    if (!item || typeof item !== 'object') {
      skipped++
      continue
    }
    const o = item as Record<string, unknown>
    const sender = pickString(o, SENDER_KEYS)
    const content = pickString(o, CONTENT_KEYS)
    if (!sender || !content) {
      skipped++
      continue
    }
    const timeRaw = TIME_KEYS.map((k) => o[k]).find((v) => v !== undefined)
    rows.push({
      sender: cleanSender(sender),
      content: content.replace(/\r\n?/g, '\n').trim(),
      sentAt:
        normalizeSentAt(typeof timeRaw === 'number' ? timeRaw : (timeRaw as string | undefined)) || '',
    })
  }
  if (skipped) warnings.push(`有 ${skipped} 条记录缺少说话人或内容，已跳过。`)

  return finish(rows, format, warnings)
}

/* ----------------------------------------------------------------------------
 * 纯文本
 * ------------------------------------------------------------------------- */

function parseText(raw: string): ParseResult {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  const rows: ParsedRow[] = []
  const warnings: string[] = []
  let continuations = 0
  let withoutTime = 0
  let format = '纯文本'

  const push = (sender: string, content: string, sentAt: string) => {
    rows.push({ sender: cleanSender(sender), content: content.trim(), sentAt })
  }

  for (const line of lines) {
    if (!line.trim() || looksLikeNoise(line)) continue

    // 顺序很关键：先试「时间在前」，再试「名字在前」——否则时间串会被当成说话人。
    let m = line.match(RE_TS_FIRST)
    if (m && /\d/.test(m[1]) && cleanSender(m[2])) {
      const content = m[3]
      if (!content.trim() && rows.length === 0) continue
      if (!content.trim()) {
        push(m[2], '', normalizeSentAt(m[1]))
        continue
      }
      push(m[2], content, normalizeSentAt(m[1]))
      format = '带时间戳（时间在前）'
      continue
    }

    m = line.match(RE_NAME_FIRST)
    if (m && /\d/.test(m[2]) && cleanSender(m[1]) && normalizeSentAt(m[2])) {
      const content = m[3]
      if (!content.trim()) {
        push(m[1], '', normalizeSentAt(m[2]))
        continue
      }
      push(m[1], content, normalizeSentAt(m[2]))
      format = '带时间戳（名字在前）'
      continue
    }

    m = line.match(RE_ANGLE)
    if (m && cleanSender(m[1])) {
      push(m[1], m[2], '')
      withoutTime++
      format = '尖括号说话人（无时间）'
      continue
    }

    m = line.match(RE_NAME_ONLY)
    if (m && cleanSender(m[1]) && !/\d{4}[-/.]\d{1,2}/.test(m[1])) {
      push(m[1], m[2], '')
      withoutTime++
      if (format === '纯文本') format = '说话人冒号（无时间）'
      continue
    }

    // 续行：接到上一条上（多行消息很常见）。
    if (rows.length > 0) {
      const last = rows[rows.length - 1]
      last.content = `${last.content}\n${line.trim()}`.trim()
      continuations++
    }
  }

  if (withoutTime === rows.length && rows.length > 0) {
    warnings.push('全部记录都没有时间戳，互惠指标里的「回复间隔」和热度图的按日统计将不可用；方向判断仍然可用。')
  } else if (withoutTime > 0) {
    warnings.push(`有 ${withoutTime} 条记录没有时间戳，这些行不会进入按日统计。`)
  }

  return finish(rows, format, warnings)
}

function finish(rows: ParsedRow[], format: string, warnings: string[]): ParseResult {
  const stats = new Map<string, { count: number; chars: number; first: string; last: string }>()
  let withoutTime = 0
  for (const r of rows) {
    if (!r.sentAt) withoutTime++
    const cur = stats.get(r.sender)
    if (cur) {
      cur.count++
      cur.chars += r.content.length
      if (r.sentAt) {
        if (!cur.first || r.sentAt < cur.first) cur.first = r.sentAt
        if (!cur.last || r.sentAt > cur.last) cur.last = r.sentAt
      }
    } else {
      stats.set(r.sender, { count: 1, chars: r.content.length, first: r.sentAt, last: r.sentAt })
    }
  }

  const senders: SenderStat[] = [...stats.entries()]
    .map(([name, s]) => ({
      name,
      count: s.count,
      first: s.first,
      last: s.last,
      avgChars: Math.round(s.chars / s.count),
    }))
    .sort((a, b) => b.count - a.count)

  if (senders.length > 2) {
    warnings.push(
      `识别到 ${senders.length} 个说话人。群聊或转发记录里第三人称的消息会被归到「其他」，不参与互惠计算。`,
    )
  }
  if (senders.length === 0) {
    return { ok: false, format, rows: [], senders: [], withoutTime: 0, continuations: 0, warnings: ['没有解析出任何一条记录。检查一下格式：至少要能看出「谁说的」和「说了什么」。'] }
  }

  return { ok: true, format, rows, senders, withoutTime, continuations: 0, warnings }
}

/**
 * 干跑：只报格式与数量，不返回正文。
 * 上游要求「先报格式数量、不展示正文」，所以这里刻意只回统计。
 */
export function dryRun(raw: string): { ok: boolean; format: string; senders: SenderStat[]; total: number; dateRange: string; warnings: string[] } {
  const r = parse(raw)
  const dated = r.rows.filter((x) => x.sentAt).map((x) => x.sentAt).sort()
  return {
    ok: r.ok,
    format: r.format,
    senders: r.senders,
    total: r.rows.length,
    dateRange: dated.length ? `${dated[0]} ~ ${dated[dated.length - 1]}` : '无时间戳',
    warnings: r.warnings,
  }
}

export function parse(raw: string): ParseResult {
  const asJson = tryJson(raw)
  return asJson ?? parseText(raw)
}

export interface SpeakerMapping {
  [senderName: string]: 'self' | 'target' | 'other'
}

/**
 * 给一个「建议映射」：条数最多的两个说话人分别当 target / self。
 * 只是建议，UI 必须让用户改——猜错说话人会让后面所有指标反向。
 */
export function suggestMapping(senders: SenderStat[]): SpeakerMapping {
  const out: SpeakerMapping = {}
  const sorted = [...senders].sort((a, b) => b.count - a.count)
  sorted.forEach((s, i) => {
    out[s.name] = i === 0 ? 'target' : i === 1 ? 'self' : 'other'
  })
  return out
}
