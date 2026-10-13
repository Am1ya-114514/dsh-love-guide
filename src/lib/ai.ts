/**
 * AI 客户端：OpenAI 兼容的 /chat/completions 直连。
 *
 * 为什么不做本地代理：DeepSeek / Moonshot / 智谱 / 硅基流动 / OpenAI 的官方端点都已实测
 * 对来自 127.0.0.1 页面、带 Authorization 头的预检请求返回放行的 CORS 头，
 * 因此纯前端直连可行。少一个本地服务就少一份「它到底把你的聊天记录发去哪了」的疑问。
 *
 * 密钥只存在本机 IndexedDB（settings 表）。唯一的真实风险面是页面里被注入第三方脚本，
 * 所以 index.html 里配了严格 CSP，且本项目不引任何 CDN 脚本或字体。
 */

import type { AiSettings } from './types'

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant'
  /** 纯文本，或多模态内容数组（看图任务用）。两种服务商都收。 */
  content: string | ChatContentPart[]
}

export class AiError extends Error {
  readonly status?: number
  readonly detail?: string

  constructor(message: string, status?: number, detail?: string) {
    super(message)
    this.name = 'AiError'
    this.status = status
    this.detail = detail
  }
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

function endpoint(baseUrl: string, path: string): string {
  const base = normalizeBase(baseUrl)
  // 允许用户直接填 https://api.deepseek.com 或 .../v1
  if (/\/v\d+$/.test(base)) return `${base}${path}`
  return `${base}/v1${path}`
}

function friendlyStatus(status: number, body: string): AiError {
  const snippet = body.slice(0, 600)
  if (status === 401 || status === 403) {
    return new AiError('密钥被拒绝（401/403）。检查 API Key 是否填对、是否有该模型的权限。', status, snippet)
  }
  if (status === 404) {
    return new AiError('接口或模型不存在（404）。检查「接口地址」是否是该服务商的 OpenAI 兼容端点，以及模型名是否正确。', status, snippet)
  }
  if (status === 429) {
    return new AiError('触发限流或余额不足（429）。稍后重试，或到服务商后台确认配额。', status, snippet)
  }
  if (status >= 500) {
    return new AiError(`服务商内部错误（${status}）。稍后重试。`, status, snippet)
  }
  return new AiError(`请求失败（${status}）。`, status, snippet)
}

/**
 * 网络层错误的可读化。浏览器直连最容易遇到的是两类：
 *  - 预检被拒：TypeError: Failed to fetch，控制台里能看到 CORS 报错；
 *  - 代理/证书问题：同一句话，但换成 curl 能通。
 * 这两种在代码里无法区分，所以提示里把两条路都写出来。
 */
function wrapNetworkError(err: unknown, baseUrl: string): AiError {
  if (err instanceof AiError) return err
  const msg = err instanceof Error ? err.message : String(err)
  return new AiError(
    `无法连接到 ${baseUrl}。若浏览器控制台显示 CORS 预检失败，说明该服务商没有对本机页面放行；` +
      `若显示 net::ERR_* ，检查网络或代理设置。原始错误：${msg}`,
  )
}

export interface StreamHandlers {
  onDelta: (text: string) => void
  onDone: (info: { usage?: { prompt: number; completion: number }; model?: string }) => void
  onError: (err: AiError) => void
  signal?: AbortSignal
}

export interface UsageInfo {
  prompt: number
  completion: number
}

/** 逐块流式请求。返回一个可 await 的 Promise，done 时 resolve 完整文本。 */
export async function streamChat(
  settings: AiSettings,
  turns: ChatTurn[],
  handlers: StreamHandlers,
): Promise<string> {
  const { onDelta, onDone, onError, signal } = handlers
  const url = endpoint(settings.baseUrl, '/chat/completions')
  let full = ''

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: turns,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw friendlyStatus(res.status, body)
    }
    if (!res.body) {
      // 有些服务商在 stream:true 下仍返回一次性 JSON
      const text = await res.text()
      const parsed = safeParse(text)
      const content = parsed?.choices?.[0]?.message?.content ?? text
      full = content
      onDelta(content)
      onDone({ usage: readUsage(parsed), model: parsed?.model })
      return full
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let usage: UsageInfo | undefined
    let model: string | undefined

    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE 以空行分隔事件；兼容 \r\n
      const events = buffer.split(/\r?\n\r?\n/)
      buffer = events.pop() ?? ''
      for (const evt of events) {
        for (const line of evt.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (!data || data === '[DONE]') continue
          const json = safeParse(data)
          if (!json) continue
          if (json.usage) usage = readUsage(json)
          if (typeof json.model === 'string') model = json.model
          const delta = json.choices?.[0]?.delta
          const piece =
            (typeof delta?.content === 'string' ? delta.content : '') ||
            (typeof json.choices?.[0]?.text === 'string' ? json.choices[0].text : '')
          if (piece) {
            full += piece
            onDelta(piece)
          }
          const finish = json.choices?.[0]?.finish_reason
          if (finish === 'length') {
            onDelta('\n\n> 注意：回答因达到 max_tokens 被截断。可在「设置」里调大上限。')
          }
        }
      }
    }

    onDone({ usage, model })
    return full
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      onDone({})
      return full
    }
    const e = wrapNetworkError(err, url)
    onError(e)
    throw e
  }
}

/** 非流式补全，用于结构化任务（抽证据、生成指标）。 */
export async function complete(settings: AiSettings, turns: ChatTurn[], signal?: AbortSignal): Promise<string> {
  const url = endpoint(settings.baseUrl, '/chat/completions')
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: turns,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      stream: false,
    }),
    signal,
  }).catch((err) => {
    throw wrapNetworkError(err, url)
  })
  if (!res.ok) throw friendlyStatus(res.status, await res.text().catch(() => ''))
  const json = safeParse(await res.text())
  const content = json?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new AiError('服务商返回了无法解析的响应。')
  return content
}

/**
 * 把聊天截图转成文字时用的提示词。
 *
 * 输出格式必须和 chatlog.ts 的解析器对得上（"时间 说话人" 一行、内容跟在后面），
 * 否则识别完还得让用户手动整理，等于没做。所以格式约束写得非常死。
 */
export const VISION_TRANSCRIBE_PROMPT = `你在把一张聊天记录的截图转写成纯文本，供程序解析。

严格按下面的格式输出，不要有任何前言、解释、总结或代码围栏：

YYYY-MM-DD HH:mm 说话人
消息内容
YYYY-MM-DD HH:mm 说话人
消息内容

规则：
1. 按截图里从上到下的顺序逐条转写，一条消息占「时间说话人」一行 + 内容行。
2. 说话人用截图里能看到的昵称。看不到昵称时：靠右的（自己发的）写"我"，靠左的写"对方"。
3. 时间：截图上只有时分就写 HH:mm；有日期才写完整 YYYY-MM-DD；完全看不到时间就省略，
   写成「说话人: 内容」一行式。
4. 表情、图片、语音、转账、撤回等非文字消息，写成 [图片]、[语音 12"]、[表情]、[转账 200 元]、
   [撤回了一条消息] 这样的方括号标记。
5. 看不清的字用 [看不清] 占位，绝不猜测、绝不补全。
6. 不要合并连续消息，不要改标点，不要纠正错别字，不要翻译。
7. 如果这张图不是聊天记录，只回复一行：NOT_A_CHAT_SCREENSHOT`

/** 把模型输出里的代码围栏和寒暄剥掉，只留干净正文。 */
export function stripTranscription(text: string): string {
  let t = text.trim()
  const fenced = t.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n?```$/)
  if (fenced) t = fenced[1].trim()
  return t
}

/**
 * 逐张把聊天截图转成文字。一张一个请求：
 * 一次塞多张容易顶到 max_tokens 被截断，而截断的中间部分最难发现。
 */
export async function transcribeChatScreenshots(
  settings: AiSettings,
  images: { name: string; dataUrl: string }[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const out: string[] = []
  // 转写是长输出任务，用比聊天更大的上限，否则一张长截图会被拦腰截断。
  const visionSettings: AiSettings = { ...settings, maxTokens: Math.max(settings.maxTokens, 8000) }
  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    const content: ChatContentPart[] = [
      { type: 'text', text: VISION_TRANSCRIBE_PROMPT },
      { type: 'image_url', image_url: { url: img.dataUrl } },
    ]
    const text = stripTranscription(await complete(visionSettings, [{ role: 'user', content }], signal))
    onProgress?.(i + 1, images.length)
    if (/^NOT_A_CHAT_SCREENSHOT\b/.test(text)) {
      out.push(`（${img.name} 看起来不是聊天记录截图，已跳过）`)
      continue
    }
    out.push(text)
  }
  return out.join('\n\n')
}

/** 拉取模型列表；不是所有服务商都实现，失败时返回空数组。 */
export async function listModels(settings: AiSettings): Promise<string[]> {
  const url = endpoint(settings.baseUrl, '/models')
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${settings.apiKey.trim()}` },
    })
    if (!res.ok) return []
    const json = safeParse(await res.text())
    const data = json?.data
    if (!Array.isArray(data)) return []
    return data
      .map((d: { id?: unknown }) => (typeof d?.id === 'string' ? d.id : ''))
      .filter((s: string) => s.length > 0)
      .sort()
  } catch {
    return []
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function safeParse(text: string): any | undefined {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function readUsage(json: any): UsageInfo | undefined {
  if (!json?.usage) return undefined
  const p = Number(json.usage.prompt_tokens ?? json.usage.input_tokens ?? 0)
  const c = Number(json.usage.completion_tokens ?? json.usage.output_tokens ?? 0)
  return { prompt: p, completion: c }
}

/**
 * 从模型回答里抠出 JSON。模型经常把 JSON 包在 ```json 里，或前后带一句解释。
 * 结构化抽取失败时返回 undefined，调用方必须能退回纯文本流程。
 */
export function extractJson<T>(text: string): T | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidates = [fenced?.[1], text]
  for (const c of candidates) {
    if (!c) continue
    const trimmed = c.trim()
    const start = Math.min(
      ...[trimmed.indexOf('['), trimmed.indexOf('{')].filter((i) => i >= 0).concat([Number.POSITIVE_INFINITY]),
    )
    if (!Number.isFinite(start)) continue
    const slice = trimmed.slice(start)
    // 从后往前找闭合，容忍尾随说明文字
    for (let end = slice.length; end > 0; end--) {
      const ch = slice[end - 1]
      if (ch !== '}' && ch !== ']') continue
      try {
        return JSON.parse(slice.slice(0, end)) as T
      } catch {
        /* 继续缩短 */
      }
    }
  }
  return undefined
}
