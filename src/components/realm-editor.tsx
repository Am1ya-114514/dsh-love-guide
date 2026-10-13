import { useEffect, useState } from 'react'
import { IconDeviceFloppy, IconPlus, IconTrash } from '@tabler/icons-react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Slider } from '#/components/ui/slider'
import { Switch } from '#/components/ui/switch'
import { Textarea } from '#/components/ui/textarea'
import { useStudio } from '#/lib/store'
import type { Realm, RealmProfile } from '#/lib/types'

const MBTI = ['', 'INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP', 'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP']

export function MbtiSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {MBTI.map((m) => (
        <option key={m || 'none'} value={m}>
          {m || '未填'}
        </option>
      ))}
    </select>
  )
}

/**
 * 新建档案。
 *
 * 这里刻意没有沿用上游那种「先弹一个 prompt 问代号、建完再补齐字段」的做法：
 * 原生 prompt 会冻住整个渲染进程，样式也不受控。这个对话框一次收齐最关键的几项，
 * 剩下的字段之后随时可以在同一个档案里补。
 */
export function NewRealmDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const createRealm = useStudio((s) => s.createRealm)
  const updateProfile = useStudio((s) => s.updateProfile)
  const setView = useStudio((s) => s.setView)
  const toast = useStudio((s) => s.toast)

  const [name, setName] = useState('')
  const [mbti, setMbti] = useState('')
  const [score, setScore] = useState(5)
  const [background, setBackground] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setMbti('')
      setScore(5)
      setBackground('')
    }
  }, [open])

  const submit = async () => {
    if (!name.trim()) {
      toast('warn', '至少给这个对象起一个代号——不必是真名，你认得出就行。')
      return
    }
    setBusy(true)
    try {
      const realm = await createRealm(name.trim())
      await updateProfile(realm.id, {
        mbti,
        subjectiveScore: score,
        relationshipBackground: background,
      })
      setView('dialogue')
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建关系档案</DialogTitle>
          <DialogDescription>
            只问最必要的几项。代号用单字或昵称就行，不需要真实姓名；后面随时可以补其他字段。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-realm-name">对象代号</Label>
            <Input
              id="new-realm-name"
              value={name}
              maxLength={8}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
              placeholder="例如：小北"
            />
          </div>

          <div className="space-y-1.5">
            <Label>MBTI（可选，且只当沟通偏好参考）</Label>
            <MbtiSelect value={mbti} onChange={setMbti} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>我对这段关系的主观评分</Label>
              <span className="font-mono text-sm">{score}/10</span>
            </div>
            <Slider
              value={[score]}
              min={0}
              max={10}
              step={1}
              onValueChange={(v) => setScore(Array.isArray(v) ? (v[0] ?? 0) : v)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-realm-bg">关系背景（可选）</Label>
            <Textarea
              id="new-realm-bg"
              value={background}
              rows={3}
              onChange={(e) => setBackground(e.target.value)}
              placeholder="怎么认识的、认识多久、现在是什么状态。"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            <IconPlus className="size-4" />
            建立档案
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RealmEditorDialog({
  realm,
  open,
  onOpenChange,
}: {
  realm: Realm
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const updateProfile = useStudio((s) => s.updateProfile)
  const renameRealm = useStudio((s) => s.renameRealm)
  const deleteRealm = useStudio((s) => s.deleteRealm)
  const askConfirm = useStudio((s) => s.askConfirm)
  const toast = useStudio((s) => s.toast)

  const [name, setName] = useState(realm.name)
  const [profile, setProfile] = useState<RealmProfile>(realm.profile)

  useEffect(() => {
    if (open) {
      setName(realm.name)
      setProfile(realm.profile)
    }
  }, [open, realm])

  const set = <K extends keyof RealmProfile>(k: K, v: RealmProfile[K]) =>
    setProfile((p) => ({ ...p, [k]: v }))

  const save = async () => {
    if (name.trim() !== realm.name) await renameRealm(realm.id, name.trim())
    await updateProfile(realm.id, profile)
    toast('ok', '档案字段已保存在本机。')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>关系档案 · {realm.name}</DialogTitle>
          <DialogDescription>
            这些字段是「用户明确陈述」的部分，会随每次提问一起交给模型。写不确定的猜测没关系，
            但请标成猜测——军师会按你给的性质区别对待。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="realm-name">对象代号（不必填真名）</Label>
              <Input
                id="realm-name"
                value={name}
                maxLength={8}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：小北"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="realm-mbti">MBTI（可选，且只当沟通偏好参考）</Label>
              <select
                id="realm-mbti"
                value={profile.mbti}
                onChange={(e) => set('mbti', e.target.value)}
                className="h-9 w-full rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {MBTI.map((m) => (
                  <option key={m || 'none'} value={m}>
                    {m || '未填'}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                上游知识库把 MBTI 归为「流行说法」档：可以用来决定你说话的方式，不能用来预测结果。
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>我对这段关系的主观评分</Label>
              <span className="font-mono text-sm">{profile.subjectiveScore}/10</span>
            </div>
            <Slider
              value={[profile.subjectiveScore]}
              min={0}
              max={10}
              step={1}
              onValueChange={(v) => set('subjectiveScore', Array.isArray(v) ? (v[0] ?? 0) : v)}
            />
            <p className="text-[11px] text-muted-foreground">
              这是你的主观感受，不是客观测量。它只用来让军师知道你的处境有多急，不参与任何指标计算。
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="realm-bg">关系背景</Label>
            <Textarea
              id="realm-bg"
              value={profile.relationshipBackground}
              onChange={(e) => set('relationshipBackground', e.target.value)}
              rows={3}
              placeholder="怎么认识的、认识多久、现在是什么状态、有没有共同圈子。"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="realm-boundaries">我的边界（哪些事我不做）</Label>
            <Textarea
              id="realm-boundaries"
              value={profile.boundaries}
              onChange={(e) => set('boundaries', e.target.value)}
              rows={2}
              placeholder="例如：不接受冷暴力；不做备胎；不查对方手机。"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="realm-comm">已知的沟通偏好</Label>
            <Textarea
              id="realm-comm"
              value={profile.communicationPreferences}
              onChange={(e) => set('communicationPreferences', e.target.value)}
              rows={2}
              placeholder="例如：不喜欢语音、回复慢但不是冷淡、讨厌被追问。"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="pr-4">
              <p className="text-sm font-medium">临时问问（不建档、不写长期记忆）</p>
              <p className="text-[11px] text-muted-foreground">
                适合一次性提问。临时档案不会被长期记忆召回，也不会出现在写档案的流程里。
              </p>
            </div>
            <Switch
              checked={realm.temporary}
              onCheckedChange={(v) => void useStudio.getState().setTemporary(realm.id, v)}
            />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={async () => {
              const ok = await askConfirm({
                title: `彻底删除「${realm.name}」？`,
                body: '聊天记录、证据、档案字段会一起删除，无法撤销。\n\n只是暂时不想看，请改用侧栏的「归档」——归档可以随时恢复。',
                confirmLabel: '彻底删除',
                destructive: true,
              })
              if (!ok) return
              await deleteRealm(realm.id)
              toast('warn', '档案已删除。')
              onOpenChange(false)
            }}
          >
            <IconTrash className="size-4" />
            删除档案
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button onClick={() => void save()}>
              <IconDeviceFloppy className="size-4" />
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
