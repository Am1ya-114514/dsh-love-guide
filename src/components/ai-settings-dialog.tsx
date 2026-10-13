import { useState } from 'react'
import { IconEye, IconEyeOff, IconPlugConnected, IconRefresh } from '@tabler/icons-react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { Slider } from '#/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { PROVIDERS, PROVIDER_MAP } from '#/lib/providers'
import { useStudio } from '#/lib/store'
import { listModels } from '#/lib/ai'
import { PERSONAS } from '#/lib/prompt'

/** 模型连接设置。密钥只写进本机 IndexedDB，不经过任何服务器。 */
export function AiSettingsDialog({ children }: { children: React.ReactElement }) {
  const ai = useStudio((s) => s.ai)
  const saveAi = useStudio((s) => s.saveAi)
  const toast = useStudio((s) => s.toast)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(ai)
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [probing, setProbing] = useState(false)

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setDraft(ai)
      setModels([])
    }
  }

  const applyPreset = (id: string | null) => {
    if (!id) return
    const preset = PROVIDER_MAP.get(id)
    if (!preset) return
    setDraft((d) => ({
      ...d,
      providerId: id,
      baseUrl: preset.baseUrl || d.baseUrl,
      model: preset.models[0] ?? d.model,
    }))
  }

  const probe = async () => {
    setProbing(true)
    const list = await listModels(draft)
    setModels(list)
    setProbing(false)
    toast(list.length ? 'ok' : 'warn', list.length ? `拿到 ${list.length} 个模型。` : '这个端点没有返回模型列表（不影响使用，手动填模型名即可）。')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={children} />
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>模型连接</DialogTitle>
          <DialogDescription>
            本程序把请求直接发到你自己填的 OpenAI 兼容端点。密钥只保存在这台电脑的浏览器里，
            不经过任何中转服务器。
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="provider">
          <TabsList className="w-full">
            <TabsTrigger value="provider" className="flex-1">服务商</TabsTrigger>
            <TabsTrigger value="generation" className="flex-1">生成参数</TabsTrigger>
            <TabsTrigger value="privacy" className="flex-1">数据边界</TabsTrigger>
          </TabsList>

          <TabsContent value="provider" className="space-y-4 pt-3">
            <div className="grid gap-2">
              <Label>服务商</Label>
              <Select value={draft.providerId} onValueChange={applyPreset}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {PROVIDER_MAP.get(draft.providerId)?.note && (
                <p className="text-xs text-muted-foreground">{PROVIDER_MAP.get(draft.providerId)!.note}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="baseUrl">接口地址</Label>
              <Input
                id="baseUrl"
                value={draft.baseUrl}
                placeholder="https://api.deepseek.com"
                onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                填到域名或 /v1 为止即可，程序会自己补 /chat/completions。
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="apiKey">API Key</Label>
              <div className="flex gap-2">
                <Input
                  id="apiKey"
                  type={showKey ? 'text' : 'password'}
                  value={draft.apiKey}
                  placeholder="sk-..."
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value }))}
                />
                <Button type="button" variant="outline" size="icon" onClick={() => setShowKey((v) => !v)}>
                  {showKey ? <IconEyeOff className="size-4" /> : <IconEye className="size-4" />}
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="model">模型</Label>
                <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={probe} disabled={probing}>
                  <IconRefresh className={probing ? 'size-3.5 animate-spin' : 'size-3.5'} />
                  拉取模型列表
                </Button>
              </div>
              {models.length > 0 ? (
                <Select value={draft.model} onValueChange={(v) => setDraft((d) => ({ ...d, model: v ?? d.model }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {models.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="model"
                  value={draft.model}
                  placeholder="deepseek-chat"
                  onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
                />
              )}
              {PROVIDER_MAP.get(draft.providerId)?.models.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {PROVIDER_MAP.get(draft.providerId)!.models.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, model: m }))}
                      className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground transition hover:border-primary hover:text-foreground"
                    >
                      {m}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </TabsContent>

          <TabsContent value="generation" className="space-y-5 pt-3">
            <div className="grid gap-2.5">
              <Label>说话风格</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {PERSONAS.map((p) => {
                  const active = (draft.persona ?? 'fatfish') === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, persona: p.id }))}
                      className={
                        'rounded-lg border px-3 py-2 text-left transition ' +
                        (active ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/40')
                      }
                    >
                      <span className="block text-sm font-medium">{p.label}</span>
                      <span className="block text-[11px] text-muted-foreground">{p.hint}</span>
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                风格只影响语气，不影响结论口径：五步结构、证据分级、不预测心意这些硬边界在任何风格下都不变。
              </p>
            </div>

            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <Label>温度（越低越稳，越高越发散）</Label>
                <span className="font-mono text-xs text-muted-foreground">{draft.temperature.toFixed(2)}</span>
              </div>
              <Slider
                value={[draft.temperature]}
                min={0}
                max={1.5}
                step={0.05}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, temperature: Array.isArray(v) ? (v[0] ?? d.temperature) : v }))
                }
              />
              <p className="text-xs text-muted-foreground">
                关系建议类任务建议 0.4–0.7：太低会答得像模板，太高会开始编细节。
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="maxTokens">单次回复上限（tokens）</Label>
              <Input
                id="maxTokens"
                type="number"
                min={256}
                max={32000}
                step={128}
                value={draft.maxTokens}
                onChange={(e) => setDraft((d) => ({ ...d, maxTokens: Number(e.target.value) || 2048 }))}
              />
            </div>
          </TabsContent>

          <TabsContent value="privacy" className="space-y-4 pt-3">
            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-1">
                <Label>把知识库片段发给模型</Label>
                <p className="text-xs text-muted-foreground">
                  开启后，本机检索到的 43 篇材料原文片段会随请求发出，回答才能标注出处与证据等级。
                </p>
              </div>
              <Switch
                checked={draft.sendReferences}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, sendReferences: v }))}
              />
            </div>

            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-1">
                <Label>把聊天原文发给模型</Label>
                <p className="text-xs text-muted-foreground">
                  默认关闭。关闭时只发送你确认过的证据摘要与本地算出的指标，原始聊天记录不出本机。
                  只有在你主动点「用原文分析」时才会超出这个设置。
                </p>
              </div>
              <Switch
                checked={draft.sendRawChat}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, sendRawChat: v }))}
              />
            </div>

            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-1">
                <Label>这个模型能看图</Label>
                <p className="text-xs text-muted-foreground">
                  开启后，「聊天记录」页可以直接导入聊天截图，由模型把图里的对话转成文字再走同一套解析。
                  默认关闭——猜错的代价是把图片当纯文本发过去，接口会报错或答非所问。
                  常见能看图的模型：<span className="font-mono">gpt-4o / gpt-5 / claude-* / gemini-* / glm-4v / qwen-vl / *-vl</span>。
                </p>
              </div>
              <Switch
                checked={Boolean(draft.vision)}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, vision: v }))}
              />
            </div>

            <div className="rounded-lg border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">真实的泄露风险在哪里</p>
              <p>
                不在 localStorage，而在「页面里有没有别人塞进来的脚本」。所以本程序：
                不引用任何 CDN 脚本或字体、不接埋点、index.html 里带严格 CSP、依赖全部锁在本机
                node_modules。要更保险，可以用本机 Ollama —— 那样连网络都不出。
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            onClick={async () => {
              await saveAi(draft)
              toast('ok', '连接设置已保存。')
              setOpen(false)
            }}
          >
            <IconPlugConnected className="size-4" />
            保存
          </Button>
          <Button
            type="button"
            onClick={async () => {
              await saveAi(draft)
              // 立刻发一个最小请求，把错误直接暴露出来（401/404/CORS 都能立刻看到）
              toast('ok', '已保存，回对话页发一句话就能验证连通性。')
              setOpen(false)
            }}
          >
            保存并关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
