import { useMemo, useState } from 'react'
import {
  IconAlertTriangle,
  IconBook2,
  IconCircleCheck,
  IconExternalLink,
  IconFileSearch,
  IconSearch,
} from '@tabler/icons-react'
import { Badge } from '#/components/ui/badge'
import { Card } from '#/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Separator } from '#/components/ui/separator'
import { Markdown } from '#/components/markdown'
import {
  KNOWLEDGE_DOCS,
  KNOWLEDGE_META,
  checkKnowledgeHealth,
  retrieve,
  type RetrievedDoc,
} from '#/lib/knowledge'
import { cn, formatBytes } from '#/lib/utils'
import type { KnowledgeDoc } from '#/lib/types'

const EXAMPLES = ['投入失衡', '对方变冷淡', '第一次约出来', '被拒绝怎么办', '边界与同意', '吵架之后修复', '彩礼与家庭']

export function KnowledgeView() {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'all' | 'knowledge' | 'practical'>('all')
  const [openDoc, setOpenDoc] = useState<KnowledgeDoc | null>(null)

  const hits = useMemo<RetrievedDoc[]>(() => (q.trim() ? retrieve(q, { limit: 6, kind }) : []), [q, kind])
  const health = useMemo(() => checkKnowledgeHealth(), [])
  const docs = useMemo(
    () => KNOWLEDGE_DOCS.filter((d) => kind === 'all' || d.kind === kind),
    [kind],
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-4 p-5">
        <Card className="gap-3 p-4">
          <div className="flex items-center gap-2">
            <IconFileSearch className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">检索</h3>
            <p className="text-[11px] text-muted-foreground">
              这里用的就是军师回答你时用的同一套检索。命中的原文片段会连出处一起交给模型，
              并要求它按证据等级标注——所以你也可以自己先搜一遍，看它到底引了什么。
            </p>
          </div>

          <div className="relative">
            <IconSearch className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="例如：她总是隔很久才回，我该不该继续主动"
              className="pl-8"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(['all', 'knowledge', 'practical'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px] transition',
                  kind === k ? 'border-primary bg-primary/10' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {k === 'all' ? '全部' : k === 'knowledge' ? '核心知识（20）' : '实用材料（23）'}
              </button>
            ))}
            <span className="text-border">|</span>
            {EXAMPLES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setQ(e)}
                className="rounded-full border border-dashed px-2.5 py-1 text-[11px] text-muted-foreground transition hover:bg-muted"
              >
                {e}
              </button>
            ))}
          </div>

          {q.trim() && (
            <>
              <Separator />
              {hits.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  没命中任何一篇。试试换一个更具体的说法，或者直接去「对话」里问——模型可以自己组织措辞。
                </p>
              ) : (
                <ul className="space-y-3">
                  {hits.map((h) => (
                    <li key={h.doc.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{h.doc.title}</span>
                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                          {h.doc.kind === 'knowledge' ? '核心知识' : '实用材料'}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">相关度 {h.score}</span>
                        <button
                          type="button"
                          onClick={() => setOpenDoc(h.doc)}
                          className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          全文
                        </button>
                      </div>
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                        references/{h.doc.kind}/{h.doc.file}
                        {h.doc.reviewDate && ` · 复核 ${h.doc.reviewDate}`}
                      </p>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">{h.reason}</p>
                      {h.excerpts.map((ex, i) => (
                        <p
                          key={i}
                          className="mt-2 border-l-2 border-primary/30 pl-2.5 text-xs leading-relaxed whitespace-pre-wrap text-foreground/90"
                        >
                          {ex}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>

        <HealthCard health={health} meta={KNOWLEDGE_META} />

        <Card className="gap-2 p-4">
          <div className="flex items-center gap-2">
            <IconBook2 className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">全部材料</h3>
            <span className="text-[11px] text-muted-foreground">{docs.length} 篇</span>
          </div>
          <ul className="divide-y">
            {docs.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => setOpenDoc(d)}
                  className="flex w-full items-center gap-2 py-2 text-left transition hover:bg-muted/40"
                >
                  <span className="w-7 shrink-0 font-mono text-[10px] text-muted-foreground">
                    {d.number >= 0 ? String(d.number).padStart(2, '0') : '—'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{d.title}</span>
                  {d.style === 'mindmap' && (
                    <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">
                      提纲
                    </Badge>
                  )}
                  {d.reviewDate && (
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{d.reviewDate}</span>
                  )}
                  <span className="shrink-0 text-[10px] text-muted-foreground">{formatBytes(d.bytes)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Dialog open={Boolean(openDoc)} onOpenChange={(v) => !v && setOpenDoc(null)}>
        <DialogContent className="flex max-h-[88vh] w-[min(54rem,94vw)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
          {openDoc && (
            <>
              <DialogHeader className="gap-1.5 border-b px-6 py-4 pr-14">
                <DialogTitle className="text-[17px] leading-snug">{openDoc.title}</DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px]">
                  <span>
                    references/{openDoc.kind}/{openDoc.file}
                  </span>
                  {openDoc.reviewDate && <span>· 复核日期 {openDoc.reviewDate}</span>}
                  <span>· {formatBytes(openDoc.bytes)}</span>
                  {openDoc.style === 'mindmap' && <span>· 大纲体</span>}
                </DialogDescription>
              </DialogHeader>

              {/* 正文限宽：中文一行 40 个字符左右最好读，全程横跨 860px 时眼睛找不到下一行。 */}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
                <div className="mx-auto max-w-[40rem]">
                  {openDoc.links.length > 0 && (
                    <div className="mb-5 rounded-lg border bg-muted/30 p-3.5">
                      <p className="mb-2 text-[11px] font-medium text-muted-foreground">
                        文中引用的外部来源（未经本程序独立核实，引用前请自行复核）
                      </p>
                      <ul className="space-y-1.5">
                        {openDoc.links.slice(0, 12).map((l) => (
                          <li key={l}>
                            <a
                              href={l}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-start gap-1.5 text-[11px] break-all text-primary hover:underline"
                            >
                              <IconExternalLink className="mt-0.5 size-3 shrink-0" />
                              <span>{l.length > 90 ? `${l.slice(0, 90)}…` : l}</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <Markdown
                    text={openDoc.text}
                    variant="comfortable"
                    dropTitle={openDoc.title}
                    className="text-foreground/90"
                  />

                  <div className="mt-8 flex items-center gap-2 border-t pt-4 text-[11px] text-muted-foreground">
                    <IconBook2 className="size-3.5 shrink-0" />
                    <span>
                      出自上游参考资料，共 {KNOWLEDGE_META.counts.knowledge + KNOWLEDGE_META.counts.practical} 篇。
                      这里是原文呈现，不是本程序的结论。
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function HealthCard({
  health,
  meta,
}: {
  health: ReturnType<typeof checkKnowledgeHealth>
  meta: { generatedAt: string; source: string; counts: { knowledge: number; practical: number } }
}) {
  return (
    <Card className={cn('gap-2 p-4', !health.ok && 'border-amber-500/50')}>
      <div className="flex items-center gap-2">
        {health.ok ? (
          <IconCircleCheck className="size-4 text-emerald-600" />
        ) : (
          <IconAlertTriangle className="size-4 text-amber-600" />
        )}
        <h3 className="text-sm font-semibold">知识库自检</h3>
        <span className="text-[11px] text-muted-foreground">
          生成于 {new Date(meta.generatedAt).toLocaleString()} · 来源 {meta.source}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="核心知识" value={String(health.knowledge)} ok={health.knowledge >= 20} />
        <Cell label="实用材料" value={String(health.practical)} ok={health.practical >= 23} />
        <Cell label="编号连续" value={health.numbered ? '是' : `缺 ${health.missingNumbers.join(',')}`} ok={health.numbered} />
        <Cell label="空壳文件" value={String(health.empty.length)} ok={health.empty.length === 0} />
      </div>

      {(health.noTitle.length > 0 || health.empty.length > 0) && (
        <p className="text-[11px] text-amber-600">
          {health.noTitle.length > 0 && `缺标题：${health.noTitle.join('、')}。`}
          {health.empty.length > 0 && `疑似空壳：${health.empty.join('、')}。`}
        </p>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        这四项对应上游 <code className="rounded bg-muted px-1">scripts/validate_skill.py</code> 的核心断言。
        改完 references/ 之后需要重跑 <code className="rounded bg-muted px-1">node scripts/build-knowledge.mjs</code>，
        这里才会反映新内容。{health.noReviewDate.length > 0 && `另有 ${health.noReviewDate.length} 篇没标复核日期。`}
      </p>
    </Card>
  )
}

function Cell({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className={cn('rounded-lg border p-2', !ok && 'border-amber-500/50')}>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn('truncate text-sm', !ok && 'text-amber-600')} title={value}>
        {value}
      </p>
    </div>
  )
}
