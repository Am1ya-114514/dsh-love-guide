import { useMemo, useState } from 'react'
import { IconCopy, IconCheck } from '@tabler/icons-react'
import { cn, copyText } from '#/lib/utils'

/** 行内标记：`**粗体**` 与 `` `代码` ``。 */
function renderInline(text: string, keyPrefix: string) {
  const nodes: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const token = m[0]
    if (token.startsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      )
    } else {
      nodes.push(
        <code key={`${keyPrefix}-c${i}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      )
    }
    last = m.index + token.length
    i++
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/** 代码块 + 一键复制。话术就靠这个才真的"能直接发出去"。 */
function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="group/code relative my-3 overflow-hidden rounded-lg border bg-muted/40">
      <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-1.5">
        <span className="text-xs text-muted-foreground">{lang || '话术'}</span>
        <button
          type="button"
          onClick={async () => {
            const ok = await copyText(code)
            setCopied(ok)
            window.setTimeout(() => setCopied(false), 1600)
          }}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition hover:bg-background hover:text-foreground"
        >
          {copied ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-sm leading-relaxed whitespace-pre-wrap">{code}</pre>
    </div>
  )
}

/**
 * 极简 Markdown 渲染。
 *
 * 为什么不用 react-markdown：这里渲染的全部内容要么来自本机知识库，
 * 要么来自用户自己配置的模型。用整套 markdown 渲染器换来的能力（表格、脚注、
 * HTML 透传）在这里没有价值，反而多一层 XSS 面。这里只支持真正用到的子集，
 * 并且完全不做 HTML 透传。
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => splitBlocks(text), [text])
  return <div className={cn('space-y-2 text-sm leading-relaxed', className)}>{blocks}</div>
}

type Block =
  | { kind: 'code'; code: string; lang: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'p'; text: string }

function splitBlocks(text: string): React.ReactNode[] {
  const parsed: Block[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim()
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        buf.push(lines[i])
        i++
      }
      i++ // 跳过结束围栏
      parsed.push({ kind: 'code', code: buf.join('\n'), lang })
      continue
    }
    if (/^\s*#{1,6}\s+/.test(line)) {
      const level = line.match(/^\s*(#{1,6})/)![1].length
      parsed.push({ kind: 'heading', level, text: line.replace(/^\s*#{1,6}\s+/, '').trim() })
      i++
      continue
    }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && (/^\s*[-*+]\s+/.test(lines[i]) || /^\s*\d+[.)]\s+/.test(lines[i]))) {
        items.push(lines[i].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim())
        i++
      }
      parsed.push({ kind: 'ul', items })
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      parsed.push({ kind: 'quote', text: buf.join('\n') })
      continue
    }
    if (line.trim() === '') {
      i++
      continue
    }
    // 普通段落：合并到下一个空行
    const buf: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !/^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```)/.test(lines[i])) {
      buf.push(lines[i])
      i++
    }
    parsed.push({ kind: 'p', text: buf.join('\n') })
  }

  return parsed.map((b, idx) => {
    const key = `b${idx}`
    switch (b.kind) {
      case 'code':
        return <CodeBlock key={key} code={b.code} lang={b.lang} />
      case 'heading': {
        const cls =
          b.level <= 2
            ? 'mt-4 text-base font-semibold text-foreground'
            : 'mt-3 text-sm font-semibold text-foreground'
        return (
          <p key={key} className={cls}>
            {renderInline(b.text, key)}
          </p>
        )
      }
      case 'ul':
        return (
          <ul key={key} className="ml-1 space-y-1">
            {b.items.map((it, j) => (
              <li key={`${key}-${j}`} className="flex gap-2">
                <span className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                <span>{renderInline(it, `${key}-${j}`)}</span>
              </li>
            ))}
          </ul>
        )
      case 'quote':
        return (
          <blockquote
            key={key}
            className="border-l-2 border-primary/40 bg-muted/40 py-1.5 pl-3 text-muted-foreground"
          >
            {renderInline(b.text, key)}
          </blockquote>
        )
      default:
        return (
          <p key={key} className="whitespace-pre-wrap">
            {renderInline(b.text, key)}
          </p>
        )
    }
  })
}
