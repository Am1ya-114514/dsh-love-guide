/**
 * 悬浮窗：盯住一个聊天窗口，把「对方在说什么」和「我可以怎么回」浮在最上面。
 *
 * 和主窗口的关系：**同一个 origin**（都是 http://127.0.0.1:41730），所以它直接
 * 读同一个 IndexedDB，模型连接、人格、语气这些设置不用再配一遍。
 *
 * 三条产品上的取舍：
 *
 * 1. **只填进输入框，绝不自动发送**。底部那排按钮点下去只是把字放进聊天软件的
 *    输入框，发送键永远由人按——回错一句话的社交代价由人承担，所以最后一下
 *    必须是人来按。这也是 `overlay/service.py` 里根本不存在"发送"代码路径的原因。
 *
 * 2. **不做全自动轮询分析**。截图便宜（25ms）但 OCR 贵（2~5s），所以后端只在
 *    画面真的变了才识别一次；而"要不要调用模型"完全由用户按按钮决定。这种工具
 *    一旦自动烧 token，用户第一反应就是把它关掉。
 *
 * 3. **认不出来的信息要显示成"不知道"**。OCR 会把发送按钮、侧边栏、下载提示
 *    一起认成文本，左右也偶尔判反。与其让模型一本正经地基于错信息给建议，
 *    不如把原始行摊开给用户看一眼——所以下面有个可折叠的"识别原文"。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { complete, type ChatTurn } from '#/lib/ai'
import { getSetting } from '#/lib/db'
import { IconChevronDown, IconX } from '@tabler/icons-react'
import brand from '#/assets/brand.png'
import { AI_KEY, DEFAULT_AI } from '#/lib/ai-defaults'
import { CORE_PERSONA, HARD_BOUNDARIES, personaBlock } from '#/lib/prompt'
import type { AiSettings } from '#/lib/types'

interface WinInfo {
  hwnd: number
  title: string
  class: string
  rect: [number, number, number, number]
  iconic: boolean
  width: number
  height: number
}

interface ChatMessage {
  speaker: 'self' | 'other' | 'unknown'
  text: string
  score: number
}

interface ReadResult {
  window: { hwnd: number; width: number; height: number }
  timing: { capture_ms: number; ocr_ms: number }
  line_count: number
  messages: ChatMessage[]
}

interface Suggestion {
  intent: string
  read: string
  caution: string
  replies: { label: string; text: string }[]
}

declare global {
  interface Window {
    overlayAPI?: {
      status: () => Promise<{
        dir: string
        python: string
        running: boolean
        ready: boolean
        collapsed: boolean
        hotkey: string
      }>
      listWindows: () => Promise<WinInfo[]>
      read: (hwnd: number, max?: number) => Promise<ReadResult>
      watch: (hwnd: number, interval?: number) => Promise<unknown>
      unwatch: () => Promise<unknown>
      inject: (hwnd: number, text: string) => Promise<{ ok: boolean; filled: number; sent: boolean }>
      setCollapsed: (collapsed: boolean) => Promise<boolean>
      hide: () => Promise<boolean>
      hotkey: () => Promise<string>
      onEvent: (handler: (payload: Record<string, unknown>) => void) => () => void
    }
    ClipboardItem?: unknown
  }
}

const SPEAKER_LABEL: Record<string, string> = { self: '我', other: '对方', unknown: '?' }

/**
 * 让模型输出的分析提示词。
 *
 * 刻意不用主程序那套完整 System Prompt：悬浮窗要的是**快**（用户在等着一句
 * 能马上发的话），不是一份带证据分级的完整报告。所以核心人格 + 硬边界保留，
 * 输出压成一段固定结构的 JSON。
 */
function analyzerPrompt(messages: ChatMessage[], selfName: string): string {
  const lines = messages
    .map((m) => `${SPEAKER_LABEL[m.speaker] ?? '?'}: ${m.text}`)
    .join('\n')
  return `${CORE_PERSONA}

${personaBlock('fatfish')}

${HARD_BOUNDARIES}

下面是刚刚从聊天窗口截图 OCR 出来的最近几条消息。**OCR 会认错字，也可能把界面上
的按钮、提示认成聊天内容**，所以你要先判断这些内容里哪些是真的对话。如果信息不足
以下判断，就直说信息不足，不要硬编。

我在这段对话里的名字/身份：${selfName}

———— 识别到的内容 ————
${lines}
———— 内容结束 ————

请只输出一个 JSON 对象，不要输出别的任何文字，结构如下：
{
  "intent": "对方这句话大概想表达什么，一到两句，用平视的语气说人话",
  "read": "现在这段关系的状态判断，一到两句。允许给判断，但要说清依据是哪几句话",
  "caution": "有什么是我可能想岔了、或者这条信息不足以判断的地方。如果没什么可提醒的，写空字符串",
  "replies": [
    {"label": "这句话的打法，四五个字，例如「接住情绪」「给个台阶」", "text": "可以直接发出去的原文，口语，别太长"}
  ]
}

replies 给 3 条，风格要有区别：一条稳、一条更主动、一条给对方留退路。
每条 text 都要能直接复制去发，不要带「你可以说」这种前缀，也不要写占位符。`
}

function extractSuggestion(raw: string): Suggestion | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Suggestion
    if (!Array.isArray(obj.replies)) return null
    return obj
  } catch {
    return null
  }
}

export function OverlayApp() {
  const [wins, setWins] = useState<WinInfo[]>([])
  const [target, setTarget] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [timing, setTiming] = useState<ReadResult['timing'] | null>(null)
  const [busy, setBusy] = useState<'' | 'scan' | 'think'>('')
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [error, setError] = useState('')
  const [log, setLog] = useState<string[]>([])
  const [status, setStatus] = useState<{ dir: string; python: string; ready: boolean } | null>(null)
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [injected, setInjected] = useState('')
  const api = typeof window !== 'undefined' ? window.overlayAPI : undefined
  const bootstrapped = useRef(false)

  const pushLog = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-40), `${new Date().toLocaleTimeString()} ${line}`])
  }, [])

  useEffect(() => {
    if (!api || bootstrapped.current) return
    bootstrapped.current = true
    void (async () => {
      const st = await api.status()
      setStatus({ dir: st.dir, python: st.python, ready: st.ready })
      setCollapsed(st.collapsed)
      const s = await getSetting<AiSettings>(AI_KEY, DEFAULT_AI)
      setSettings(s)
      try {
        const list = await api.listWindows()
        setWins(list)
      } catch (e) {
        setError(`拿不到窗口列表：${(e as Error).message}`)
      }
    })()
  }, [api])

  useEffect(() => {
    if (!api) return
    return api.onEvent((payload) => {
      const ev = payload.event as string
      if (ev === 'changed') {
        const data = payload as unknown as ReadResult & { event: string }
        setMessages(data.messages ?? [])
        setTiming(data.timing ?? null)
        setSuggestion(null)
        setInjected('')
      } else if (ev === 'minimized') {
        setError('目标窗口被最小化了。最小化的窗口截不到内容，先把它还原。')
      } else if (ev === 'unavailable') {
        setError(`后端起不来。检查 Python 路径：${String(payload.python ?? '')}`)
      } else if (ev === 'log') {
        pushLog(String(payload.line ?? ''))
      }
    })
  }, [api, pushLog])

  const startWatch = async () => {
    if (!api || !target) return
    setError('')
    setBusy('scan')
    try {
      await api.watch(target, 2)
      const first = await api.read(target, 12)
      setMessages(first.messages ?? [])
      setTiming(first.timing ?? null)
      pushLog(`已开始盯着 hwnd=${target}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const scanOnce = async () => {
    if (!api || !target) return
    setError('')
    setBusy('scan')
    try {
      const r = await api.read(target, 12)
      setMessages(r.messages ?? [])
      setTiming(r.timing ?? null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const analyze = async () => {
    if (!settings) return
    if (!settings.apiKey) {
      setError('还没配模型连接。回主窗口的「模型连接」里填一个 API Key。')
      return
    }
    if (messages.length === 0) {
      setError('还没有识别到内容，先扫一次。')
      return
    }
    setError('')
    setBusy('think')
    setSuggestion(null)
    try {
      const turns: ChatTurn[] = [
        { role: 'system', content: analyzerPrompt(messages, '我') },
        { role: 'user', content: '按上面的格式给判断和建议回复。' },
      ]
      const raw = await complete(settings, turns)
      const parsed = extractSuggestion(raw)
      if (!parsed) {
        setError('模型没有按格式返回。原文已放进下面的日志里。')
        pushLog(raw.slice(0, 400))
      } else {
        setSuggestion(parsed)
      }
    } catch (e) {
      setError(`调用模型失败：${(e as Error).message}`)
    } finally {
      setBusy('')
    }
  }

  const doInject = async (text: string) => {
    if (!api || !target) return
    try {
      const r = await api.inject(target, text)
      setInjected(`已填进输入框（${r.filled} 字）。发送键由你自己按。`)
      pushLog('注入完成，未发送')
    } catch (e) {
      setError(`填入失败：${(e as Error).message}`)
    }
  }

  const toggleCollapsed = async () => {
    if (!api) return
    const next = await api.setCollapsed(!collapsed)
    setCollapsed(next)
  }

  const grouped = useMemo(() => messages.slice(-12), [messages])

  if (!api) {
    return (
      <div className="ov-root">
        <div className="ov-note">
          这个页面要在桌面程序里打开（浏览器里没有截图和注入需要的能力）。
        </div>
      </div>
    )
  }

  if (collapsed) {
    return (
      <div className="ov-root ov-collapsed">
        <button className="ov-drag" onClick={toggleCollapsed} title="展开">
          <img className="ov-brand" src={brand} alt="" />
          <span className="ov-dot" data-on={status?.ready ? '1' : '0'} />
          dsh-Love Guide
        </button>
        <button className="ov-mini" onClick={() => void api.hide()} title="关闭悬浮窗" aria-label="关闭悬浮窗">
          <IconX size={14} stroke={2} />
        </button>
      </div>
    )
  }

  return (
    <div className="ov-root">
      <header className="ov-bar">
        <img className="ov-brand" src={brand} alt="" />
        <span className="ov-dot" data-on={status?.ready ? '1' : '0'} />
        <strong>实时建议</strong>
        <span className="ov-spacer" />
        <button className="ov-mini" onClick={() => void toggleCollapsed()} title="收起" aria-label="收起">
          <IconChevronDown size={14} stroke={2} />
        </button>
        <button className="ov-mini" onClick={() => void api.hide()} title="关闭悬浮窗" aria-label="关闭悬浮窗">
          <IconX size={14} stroke={2} />
        </button>
      </header>

      <div className="ov-pick">
        <select
          value={target ?? ''}
          onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">选择要盯的窗口…</option>
          {wins
            .filter((w) => w.width > 300 && w.height > 300)
            .map((w) => (
              <option key={w.hwnd} value={w.hwnd}>
                {w.title.slice(0, 40)} · {w.width}×{w.height}
              </option>
            ))}
        </select>
        <button className="ov-btn" disabled={!target || busy !== ''} onClick={() => void startWatch()}>
          监视
        </button>
        <button className="ov-btn ghost" disabled={!target || busy !== ''} onClick={() => void scanOnce()}>
          扫一次
        </button>
      </div>

      {error && <div className="ov-err">{error}</div>}

      <div className="ov-stream">
        {grouped.length === 0 ? (
          <div className="ov-note">
            还没有内容。选一个 QQ 或微信窗口，点「扫一次」。
            <br />
            窗口最小化的时候截不到画面，先把它还原成正常大小。
          </div>
        ) : (
          grouped.map((m, i) => (
            <div key={i} className={`ov-msg ${m.speaker}`}>
              <span className="ov-who">{SPEAKER_LABEL[m.speaker] ?? '?'}</span>
              <span className="ov-text">{m.text}</span>
            </div>
          ))
        )}
      </div>

      {timing && (
        <button className="ov-raw-toggle" onClick={() => setShowRaw((v) => !v)}>
          {showRaw ? '收起识别原文' : `识别原文（截图 ${timing.capture_ms}ms · 识别 ${timing.ocr_ms}ms）`}
        </button>
      )}
      {showRaw && (
        <div className="ov-raw">
          {messages.map((m, i) => (
            <div key={i}>
              [{SPEAKER_LABEL[m.speaker]}] {m.text}
              <span className="ov-score">{m.score.toFixed(2)}</span>
            </div>
          ))}
          <div className="ov-hint">
            OCR 会把按钮、下载提示、会话列表一起认进来，左右也可能判反。觉得不对就以上面的
            原文为准。
          </div>
        </div>
      )}

      <div className="ov-actions">
        <button
          className="ov-primary"
          disabled={busy !== '' || messages.length === 0}
          onClick={() => void analyze()}
        >
          {busy === 'think' ? '在想…' : '分析并给建议'}
        </button>
        {injected && <span className="ov-ok">{injected}</span>}
      </div>

      {suggestion && (
        <div className="ov-suggest">
          <div className="ov-field">
            <b>对方在说什么</b>
            <p>{suggestion.intent}</p>
          </div>
          <div className="ov-field">
            <b>我的判断</b>
            <p>{suggestion.read}</p>
          </div>
          {suggestion.caution && (
            <div className="ov-field warn">
              <b>先别急着下结论</b>
              <p>{suggestion.caution}</p>
            </div>
          )}
          <div className="ov-replies">
            {suggestion.replies.map((r, i) => (
              <div key={i} className="ov-reply">
                <div className="ov-reply-head">
                  <span className="ov-tag">{r.label}</span>
                  <button className="ov-btn tiny" onClick={() => void doInject(r.text)}>
                    填进输入框
                  </button>
                </div>
                <p>{r.text}</p>
              </div>
            ))}
          </div>
          <div className="ov-hint">
            点「填进输入框」只会把字放进聊天窗口，不会发出去。按错一句话的代价由你承担，
            所以最后那一下留给你自己。
          </div>
        </div>
      )}

      {log.length > 0 && (
        <details className="ov-log">
          <summary>运行日志</summary>
          <pre>{log.join('\n')}</pre>
        </details>
      )}

      <footer className="ov-foot">
        {status?.ready ? '后端就绪' : '后端未就绪'} · 收起/展开 <kbd>Ctrl</kbd>+
        <kbd>Shift</kbd>+<kbd>L</kbd> · 只填不发
      </footer>
    </div>
  )
}
