import { useState } from 'react'
import {
  IconAlertTriangle,
  IconBrandGithub,
  IconDatabaseExport,
  IconLock,
  IconLockOpen,
  IconScale,
  IconShieldCheck,
  IconTrash,
} from '@tabler/icons-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { Separator } from '#/components/ui/separator'
import { Switch } from '#/components/ui/switch'
import { AiSettingsDialog } from './ai-settings-dialog'
import { exportAll, wipeAll } from '#/lib/db'
import { KNOWLEDGE_META } from '#/lib/knowledge'
import { providerLabel, useStudio } from '#/lib/store'

export function SettingsView() {
  const ai = useStudio((s) => s.ai)
  const consentAt = useStudio((s) => s.consentAt)
  const setConsent = useStudio((s) => s.setConsent)
  const askConfirm = useStudio((s) => s.askConfirm)
  const toast = useStudio((s) => s.toast)
  const [busy, setBusy] = useState(false)

  const doExport = async () => {
    setBusy(true)
    try {
      const bundle = await exportAll()
      const text = JSON.stringify(bundle, null, 2)
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `goutoujunshi-studio-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast('ok', `已导出 ${bundle.realms.length} 个档案、${bundle.evidence.length} 条证据、${bundle.chatLogs.length} 条聊天记录。`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-4 p-5">
        <Card className="gap-3 p-4">
          <div className="flex items-center gap-2">
            <IconShieldCheck className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">这个程序是什么</h3>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            「dsh-Love Guide」是把上游开源项目{' '}
            <a
              className="text-primary hover:underline"
              href="https://github.com/shengjidaguai-china/goutoujunshi"
              target="_blank"
              rel="noreferrer noopener"
            >
              shengjidaguai-china/goutoujunshi
            </a>{' '}
            的关系决策方法论做成了一个独立可运行的本地程序。它复用了上游的 43 篇知识库材料与行为契约，
            但把「靠模型自觉记得去读文件」换成了确定性的本地检索 + 可视化推演。
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <Fact label="运行方式" value="纯本地单页应用" />
            <Fact label="服务端" value="没有" />
            <Fact label="出网时机" value="只有你主动提问时" />
          </div>

          <Separator />

          <p className="text-xs font-medium">它刻意不做的事</p>
          <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            {[
              '不解密、不直接读取微信/QQ 的聊天数据库，也不绕过任何平台权限。',
              '不后台监控、不持续抓取，不代替你发送任何消息。',
              '不预测对方爱不爱你、忠不忠诚、成功率多少。',
              '不用 MBTI 预测关系结果（只当沟通方式参考）。',
              '不把 AI 的推测写进「用户稳定档案」——那种内容只能进假设区。',
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground" />
                {t}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="gap-3 p-4">
          <div className="flex items-center gap-2">
            <IconScale className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">模型连接</h3>
            <Badge variant={ai.apiKey.trim() ? 'secondary' : 'outline'} className="h-4 px-1 text-[10px]">
              {ai.apiKey.trim() ? '已配置' : '未配置'}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Fact label="服务商" value={providerLabel(ai.providerId)} />
            <Fact label="模型" value={ai.model} mono />
            <Fact label="端点" value={ai.baseUrl || '—'} mono />
            <Fact label="温度" value={String(ai.temperature)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AiSettingsDialog>
              <Button size="sm" variant="outline">
                修改连接
              </Button>
            </AiSettingsDialog>
            <p className="text-[11px] text-muted-foreground">
              Key 只保存在这台电脑的浏览器本地存储里，请求由浏览器直接发往你填的端点。
              {ai.sendRawChat ? ' 当前已允许发送聊天原文。' : ' 当前不会发送聊天原文，只发摘要与证据。'}
            </p>
          </div>
        </Card>

        <Card className="gap-3 p-4">
          <div className="flex items-center gap-2">
            {consentAt ? (
              <IconLock className="size-4 text-emerald-600" />
            ) : (
              <IconLockOpen className="size-4 text-muted-foreground" />
            )}
            <h3 className="text-sm font-semibold">长期记忆</h3>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
              <p>
                开启后，军师会把「会影响未来建议的有限字段与关键事件」记到本地数据库，
                下次打开还在。它接受的对象事实只来自你的明确陈述，模型自己的推断只能进假设区。
              </p>
              <p>
                {consentAt
                  ? `已于 ${new Date(consentAt).toLocaleString()} 获得同意。可以随时关掉，已有记录不会自动删除。`
                  : '当前未启用。档案字段仍然会保存，但不会被当作跨会话的长期记忆召回。'}
              </p>
            </div>
            <Switch
              checked={Boolean(consentAt)}
              onCheckedChange={async (v) => {
                const ok = await askConfirm(
                  v
                    ? {
                        title: '开启长期记忆？',
                        body: '这意味着程序会把有限的关系字段与关键事件保存在本机数据库里。同意范围仅限「会影响未来建议的内容」，每次变更都会提示你，并且可以随时撤销。',
                        confirmLabel: '开启',
                      }
                    : {
                        title: '关掉长期记忆？',
                        body: '已经存下的记录不会自动删除，但之后不再写入、也不再召回。想删掉已有记录，请到档案里逐条处理或用「撤销」。',
                        confirmLabel: '关掉',
                      },
                )
                if (!ok) return
                await setConsent(v)
              }}
            />
          </div>
        </Card>

        <Card className="gap-3 p-4">
          <div className="flex items-center gap-2">
            <IconDatabaseExport className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">数据与备份</h3>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            全部数据存在浏览器的 IndexedDB 里。换浏览器、清缓存、或用无痕窗口都可能导致数据不见，
            所以重要的档案请定期导出。导出的 JSON 里包含聊天原文，请自己保管好。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void doExport()}>
              <IconDatabaseExport className="size-3.5" />
              导出全部数据
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={async () => {
                const ok = await askConfirm({
                  title: '清空本机全部数据？',
                  body: '所有档案、聊天记录、证据、长期记忆都会删除，且无法恢复。强烈建议先导出备份。',
                  confirmLabel: '全部清空',
                  destructive: true,
                })
                if (!ok) return
                await wipeAll()
                window.location.reload()
              }}
            >
              <IconTrash className="size-3.5" />
              清空本机数据
            </Button>
          </div>
        </Card>

        <Card className="gap-3 p-4">
          <div className="flex items-center gap-2">
            <IconBrandGithub className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">来源与许可</h3>
          </div>
          <ul className="space-y-2 text-xs leading-relaxed text-muted-foreground">
            <li>
              方法论、知识库与行为契约来自{' '}
              <a
                className="text-primary hover:underline"
                href="https://github.com/shengjidaguai-china/goutoujunshi"
                target="_blank"
                rel="noreferrer noopener"
              >
                shengjidaguai-china/goutoujunshi
              </a>
              ，MIT License，Copyright (c) 2026 powerycy。
            </li>
            <li>
              知识库规模：核心知识 {KNOWLEDGE_META.counts.knowledge} 篇 + 实用材料{' '}
              {KNOWLEDGE_META.counts.practical} 篇，打包于 {new Date(KNOWLEDGE_META.generatedAt).toLocaleString()}。
            </li>
            <li className="flex items-start gap-2">
              <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
              <span>
                知识库里的外部链接与日期未经本程序独立核实。涉及法律、医疗、人身安全的问题，
                请以当地官方渠道为最终依据。本程序不提供心理诊断，也不替代专业帮助。
              </span>
            </li>
            <li>
              如果你或他人正处于危险中，请优先联系当地紧急服务或可信赖的人——这一条比这个程序里任何建议都重要。
            </li>
          </ul>
          <Separator />
          <p className="text-[11px] text-muted-foreground">
            本程序界面使用 shadcn/ui（Base UI 预设）与 Tabler Icons 构建，图表使用 Apache ECharts。
            这些项目的许可与版权归各自作者所有。
          </p>
        </Card>

        <div className="h-4" />
      </div>
    </div>
  )
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border p-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={mono ? 'truncate font-mono text-[11px]' : 'truncate text-xs'} title={value}>
        {value || '—'}
      </p>
    </div>
  )
}
