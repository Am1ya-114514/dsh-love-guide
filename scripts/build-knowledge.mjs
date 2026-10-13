// 把上游仓库 references/ 下的全部 Markdown 打包成一份可被前端直接检索的数据。
//
// 为什么要生成而不是运行时 fetch：
//  1. 本程序是纯本地单页应用，不联网也能用（只在你主动调用 AI 时才出网）；
//  2. 知识库是上游仓库里最硬的资产（20 篇知识 + 23 篇实用材料），
//     用 import.meta.glob 之外的确定性产物，避免打包器把 240KB 文本塞进主 chunk；
//  3. 生成物里同时抽出标题、编号、分级、链接等结构化字段，供检索层排序使用。
//
// 用法：node scripts/build-knowledge.mjs
// 知识库源目录按优先级查找：
//   1. GTJS_REFERENCES 环境变量
//   2. 本仓库内自带的 knowledge/（克隆下来就能直接构建）
//   3. 同级目录 ../goutoujunshi/references（开发时的上游工作副本）

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const CANDIDATES = [
  process.env.GTJS_REFERENCES ? resolve(process.env.GTJS_REFERENCES) : null,
  resolve(ROOT, 'knowledge'),
  resolve(ROOT, '..', 'goutoujunshi', 'references'),
].filter(Boolean)
const REFERENCES = CANDIDATES.find((p) => existsSync(p) && statSync(p).isDirectory())
const OUT = resolve(ROOT, 'src', 'data', 'knowledge.generated.ts')

if (!REFERENCES) {
  console.error('[kb] 找不到知识库目录。已尝试：')
  for (const p of CANDIDATES) console.error(`[kb]   ${p}`)
  console.error('[kb] 用 GTJS_REFERENCES=<仓库>/references 指定，或把知识库放到本仓库的 knowledge/ 下。')
  process.exit(1)
}

/** 从 Markdown 里抽第一个一级标题；没有就退回文件名。 */
function extractTitle(md, fallback) {
  const m = md.match(/^#\s+(.+?)\s*$/m)
  return m ? m[1].trim() : fallback
}

/** 抽出所有二级标题，作为检索层的关键词来源。 */
function extractHeadings(md) {
  return [...md.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1].trim())
}

/** 抽出正文里的外链（用于「证据可溯源」面板显示引用出处）。 */
function extractLinks(md) {
  const out = new Set()
  for (const m of md.matchAll(/]\((https?:\/\/[^)\s]+)\)/g)) out.add(m[1])
  for (const m of md.matchAll(/<(https?:\/\/[^>\s]+)>/g)) out.add(m[1])
  return [...out]
}

/** 文件里若标注了复核日期，抽出来；知识库更新规则要求「引用前复核日期」。 */
function extractReviewDate(md) {
  const m = md.match(/(?:复核|更新日期|核对)[^\d]{0,12}(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

function classify(md) {
  // 15 篇是整篇塞在 mindmap 代码块里的提纲；8 篇是普通标题体。
  return /^\s*```mindmap/m.test(md) ? 'mindmap' : 'prose'
}

function collect(dir, kind) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    .map((file) => {
      const raw = readFileSync(join(dir, file), 'utf8').replace(/^\uFEFF/, '')
      const base = file.replace(/\.md$/, '')
      // 编号形如 01-xxx；实用材料里还有 00-导读。
      const numMatch = base.match(/^(\d{1,2})-(.*)$/)
      return {
        id: `${kind}/${base}`,
        kind,
        file,
        number: numMatch ? Number(numMatch[1]) : -1,
        slug: numMatch ? numMatch[2] : base,
        title: extractTitle(raw, base),
        headings: extractHeadings(raw),
        links: extractLinks(raw),
        reviewDate: extractReviewDate(raw),
        style: classify(raw),
        bytes: Buffer.byteLength(raw, 'utf8'),
        text: raw,
      }
    })
}

const docs = [...collect(join(REFERENCES, 'knowledge'), 'knowledge'), ...collect(join(REFERENCES, 'practical'), 'practical')]

const payload = {
  generatedAt: new Date().toISOString(),
  source: REFERENCES.replace(/\\/g, '/'),
  counts: {
    knowledge: docs.filter((d) => d.kind === 'knowledge').length,
    practical: docs.filter((d) => d.kind === 'practical').length,
  },
  docs,
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(
  OUT,
  `// 本文件由 scripts/build-knowledge.mjs 自动生成，请勿手工编辑。\n` +
    `// 来源：${payload.source}\n` +
    `// 生成时间：${payload.generatedAt}\n` +
    `/* eslint-disable */\n` +
    `import type { KnowledgeDoc } from '../lib/types'\n\n` +
    `export const KNOWLEDGE_META = ${JSON.stringify(
      { generatedAt: payload.generatedAt, source: payload.source, counts: payload.counts },
      null,
      2,
    )} as const\n\n` +
    `export const KNOWLEDGE_DOCS: KnowledgeDoc[] = ${JSON.stringify(docs, null, 2)}\n`,
  'utf8',
)

console.log(
  `[kb] 已生成 ${OUT}\n[kb] knowledge=${payload.counts.knowledge} practical=${payload.counts.practical} 合计 ${docs.length} 篇`,
)
