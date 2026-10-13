import { useMemo, useState } from 'react'
import { IconCopy, IconCheck } from '@tabler/icons-react'
import { cn, copyText } from '#/lib/utils'

/**
 * 两套字号。
 *
 * `compact` 给对话流用——回答很长，行距太大要一直滚。
 * `comfortable` 给知识库全文用——那些是拿来逐字读的材料，光是把 12px 的 <pre>
 * 换成 15px、行高 1.9，可读性就不是一个量级。
 */
export type MarkdownVariant = 'compact' | 'comfortable'

/** 行内标记：`**粗体**`、`` `代码` ``、`[文字](链接)`。 */
function renderInline(text: string, keyPrefix: string) {
  const nodes: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
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
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={`${keyPrefix}-c${i}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] break-all"
        >
          {token.slice(1, -1)}
        </code>,
      )
    } else {
      const label = token.slice(1, token.indexOf(']'))
      const href = token.slice(token.indexOf('](') + 2, -1)
      nodes.push(
        <a
          key={`${keyPrefix}-a${i}`}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
        >
          {label}
        </a>,
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
 * 要么来自用户自己配置的模型。用整套 markdown 渲染器换来的能力（脚注、HTML 透传）
 * 在这里没有价值，反而多一层 XSS 面。这里只支持真正用到的子集，并且完全不做 HTML 透传。
 *
 * 三件专门为知识库做的事：
 * 1. 表格——上游 43 篇里有 12 篇用表格做对照，渲染成一堆竖线等于没写。
 * 2. 嵌套列表——mindmap 那批文档的层次全靠缩进，拍平就全乱了。
 * 3. ```` ```mindmap ```` 围栏——里面本来就是 Markdown，不是代码，按 Markdown 渲染。
 */
export function Markdown({
  text,
  className,
  variant = 'compact',
  dropTitle,
}: {
  text: string
  className?: string
  variant?: MarkdownVariant
  /** 开头与这个标题重复的标题会被丢掉——弹窗顶上已经写着标题了。 */
  dropTitle?: string
}) {
  const nodes = useMemo(() => toNodes(text, variant, dropTitle), [text, variant, dropTitle])
  return (
    <div
      className={cn(
        variant === 'comfortable'
          ? 'space-y-3.5 text-[15px] leading-[1.9]'
          : 'space-y-2 text-sm leading-relaxed',
        className,
      )}
    >
      {nodes}
    </div>
  )
}

type ListItem = { text: string; children: ListNode[] }
type ListNode = { ordered: boolean; items: ListItem[] }

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/

function buildList(entries: { indent: number; ordered: boolean; text: string }[]): ListNode[] {
  const roots: ListNode[] = []
  const stack: { indent: number; node: ListNode }[] = []

  for (const e of entries) {
    while (stack.length > 0 && e.indent < stack[stack.length - 1].indent) stack.pop()

    const top = stack[stack.length - 1]
    if (top && top.indent === e.indent && top.node.ordered === e.ordered) {
      top.node.items.push({ text: e.text, children: [] })
      continue
    }
    // 同缩进但换了列表类型（- 变 1.）：先把这个层级弹出，当成新列表挂上去。
    if (top && top.indent === e.indent) stack.pop()

    const node: ListNode = { ordered: e.ordered, items: [{ text: e.text, children: [] }] }
    const parent = stack[stack.length - 1]
    if (parent) {
      const lastItem = parent.node.items[parent.node.items.length - 1]
      if (lastItem) lastItem.children.push(node)
      else parent.node.items.push({ text: '', children: [node] })
    } else {
      roots.push(node)
    }
    stack.push({ indent: e.indent, node })
  }
  return roots
}

function renderList(nodes: ListNode[], keyPrefix: string, variant: MarkdownVariant): React.ReactNode {
  const tight = variant === 'compact'
  return nodes.map((node, i) => {
    const Tag = node.ordered ? 'ol' : 'ul'
    return (
      <Tag
        key={`${keyPrefix}-l${i}`}
        className={cn(
          node.ordered ? 'list-decimal' : 'list-disc',
          tight ? 'my-1 space-y-0.5 pl-5' : 'my-2 space-y-1.5 pl-5',
          'marker:text-muted-foreground/60',
          // 二级以下换成空心点，层次一眼能分出来
          '[&_&]:list-[circle] [&_&_&]:list-[square]',
        )}
      >
        {node.items.map((item, j) => (
          <li key={`${keyPrefix}-l${i}-i${j}`} className={tight ? '' : 'pl-0.5'}>
            {item.text ? renderInline(item.text, `${keyPrefix}-l${i}-i${j}`) : null}
            {item.children.length > 0
              ? renderList(item.children, `${keyPrefix}-l${i}-i${j}`, variant)
              : null}
          </li>
        ))}
      </Tag>
    )
  })
}

/** 拆表格行：去掉首尾空单元，保留中间的空单元。 */
function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

function toNodes(text: string, variant: MarkdownVariant, dropTitle?: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  let key = 0

  const nextKey = () => `b${key++}`

  while (i < lines.length) {
    const line = lines[i]

    // ---- 围栏代码块 ----
    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim()
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        buf.push(lines[i])
        i++
      }
      i++
      const code = buf.join('\n')
      // mindmap 围栏里装的是 Markdown 大纲，按 Markdown 渲染才读得下去。
      // 直接放进 <pre> 会出现「一屏缩进加横线」，等于把 14 篇材料变成不可读。
      if (lang === 'mindmap') {
        out.push(
          <div key={nextKey()} className="space-y-3">
            {toNodes(code, variant, dropTitle)}
          </div>,
        )
      } else {
        out.push(<CodeBlock key={nextKey()} code={code} lang={lang} />)
      }
      continue
    }

    // ---- 表格 ----
    if (line.includes('|') && i + 1 < lines.length && /^[\s|:-]+$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]))
        i++
      }
      out.push(
        <div key={nextKey()} className="my-3 overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="bg-muted/60">
              <tr>
                {head.map((h, j) => (
                  <th key={j} className="border-b px-3 py-2 font-medium text-foreground">
                    {renderInline(h, `th${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="odd:bg-muted/20">
                  {head.map((_, ci) => (
                    <td key={ci} className="border-t px-3 py-2 align-top">
                      {r[ci] ? renderInline(r[ci], `td${ri}-${ci}`) : ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // ---- 标题 ----
    if (/^\s*#{1,6}\s+/.test(line)) {
      const level = line.match(/^\s*(#{1,6})/)![1].length
      const t = line.replace(/^\s*#{1,6}\s+/, '').trim()
      // 文档开头那个和弹窗标题一模一样的标题直接丢掉——弹窗顶上已经写着它了。
      // 只丢「还没输出任何内容时」遇到的，避免把正文里同名的小节标题也吃掉。
      if (dropTitle && out.length === 0 && t === dropTitle.trim()) {
        i++
        continue
      }
      out.push(renderHeading(level, t, nextKey(), variant))
      i++
      continue
    }

    // ---- 列表（含嵌套）----
    if (LIST_RE.test(line)) {
      const entries: { indent: number; ordered: boolean; text: string }[] = []
      while (i < lines.length && LIST_RE.test(lines[i])) {
        const m = lines[i].match(LIST_RE)!
        entries.push({
          indent: m[1].replace(/\t/g, '  ').length,
          ordered: /\d/.test(m[2]),
          text: m[3].trim(),
        })
        i++
      }
      out.push(<div key={nextKey()}>{renderList(buildList(entries), `k${key}`, variant)}</div>)
      continue
    }

    // ---- 引用 ----
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      out.push(
        <blockquote
          key={nextKey()}
          className={cn(
            'rounded-r-md border-l-2 border-primary/40 bg-muted/40 py-2 pl-3.5 text-muted-foreground',
            variant === 'comfortable' && 'text-[14px]',
          )}
        >
          {renderInline(buf.join('\n'), `q${key}`)}
        </blockquote>,
      )
      continue
    }

    // ---- 分隔线 ----
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push(<hr key={nextKey()} className="my-5 border-border" />)
      i++
      continue
    }

    if (line.trim() === '') {
      i++
      continue
    }

    // ---- 普通段落：合并到下一个空行或块级标记 ----
    const buf: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```)/.test(lines[i])
    ) {
      buf.push(lines[i])
      i++
    }
    out.push(
      <p key={nextKey()} className={cn(variant === 'comfortable' && 'text-pretty')}>
        {renderInline(buf.join('\n'), `p${key}`)}
      </p>,
    )
  }

  return out
}

function renderHeading(
  level: number,
  text: string,
  key: string,
  variant: MarkdownVariant,
): React.ReactNode {
  if (variant === 'compact') {
    return (
      <p
        key={key}
        className={cn(
          level <= 2 ? 'mt-4 text-base font-semibold text-foreground' : 'mt-3 text-sm font-semibold text-foreground',
        )}
      >
        {renderInline(text, key)}
      </p>
    )
  }

  // comfortable：让长文档能"扫"——一级章节有分隔线，二级章节有左侧色条。
  if (level <= 2) {
    return (
      <h2
        key={key}
        className="mt-7 mb-1 border-t border-border pt-5 text-[19px] leading-snug font-semibold tracking-tight text-foreground first:mt-0 first:border-t-0 first:pt-0"
      >
        {renderInline(text, key)}
      </h2>
    )
  }
  if (level === 3) {
    return (
      <h3
        key={key}
        className="mt-6 flex items-baseline gap-2 text-[17px] leading-snug font-semibold tracking-tight text-foreground"
      >
        <span className="mt-1 h-3.5 w-0.5 shrink-0 self-center rounded-full bg-primary/70" />
        <span>{renderInline(text, key)}</span>
      </h3>
    )
  }
  // 第四级是 mindmap 那批文档里的「1. 2. 3.」小标题。它必须比正文大一点点，
  // 否则整篇看下来会分不清哪句是标题、哪句是内容。
  return (
    <h4
      key={key}
      className="mt-5 text-[15.5px] leading-snug font-semibold tracking-tight text-foreground"
    >
      {renderInline(text, key)}
    </h4>
  )
}
