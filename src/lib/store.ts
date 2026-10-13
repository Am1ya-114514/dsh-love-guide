/**
 * 全局状态与业务动作。
 *
 * 分层：db.ts 只管存取，本文件管「一次操作要动哪几张表」。
 * 所有写操作都先落库再更新内存态，这样刷新页面不会出现"界面还在、数据没了"。
 */

import { create } from 'zustand'
import { AiError, complete, extractJson, streamChat } from './ai'
import * as db from './db'
import { computeMetrics, computeReciprocity } from './metrics'
import { buildReferenceBlock, retrieve } from './knowledge'
import {
  EVIDENCE_EXTRACTION_PROMPT,
  buildSystemPrompt,
  chatlogAnalysisPrompt,
} from './prompt'
import { PROVIDER_MAP } from './providers'
import { formatDateTime, toDateKey, uid } from './utils'
import type {
  ActionCard,
  AiSettings,
  ChatLogMessage,
  ChatMessage,
  Citation,
  Evidence,
  EvidenceCompleteness,
  EvidencePolarity,
  EvidenceTier,
  Realm,
} from './types'
import type { ReciprocityMetrics, RelationMetrics } from './metrics'

export type WorkspaceView = 'dialogue' | 'evidence' | 'chatlog' | 'knowledge' | 'settings'

/**
 * 同时保留的关系档案上限。
 *
 * 这个 5 不是这个程序自己定的——上游 skill 明确规定最多同时跟踪 5 个对象，
 * 超过之后建议先归档。档案页与公开案例载入都要走同一个上限，不能各写各的。
 */
export const MAX_REALMS = 5

export const CONSENT_KEY = 'memory.consentAt'
export const AI_KEY = 'ai.settings'
export const WEIGHTS_KEY = 'evidence.weights'

export const DEFAULT_AI: AiSettings = {
  providerId: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.6,
  maxTokens: 2400,
  sendRawChat: false,
  sendReferences: true,
}

interface Toast {
  id: string
  kind: 'ok' | 'warn' | 'err'
  text: string
}

export interface ConfirmRequest {
  id: string
  title: string
  body?: string
  confirmLabel?: string
  destructive?: boolean
  resolve: (ok: boolean) => void
}

interface StudioState {
  ready: boolean
  realms: Realm[]
  activeRealmId: string
  view: WorkspaceView
  messages: ChatMessage[]
  evidence: Evidence[]
  chatLogs: ChatLogMessage[]
  memory: db.MemoryEntry[]
  ai: AiSettings
  consentAt: number | null
  streaming: boolean
  streamText: string
  toasts: Toast[]
  lastError: string | null
  confirmRequest: ConfirmRequest | null

  init: () => Promise<void>
  toast: (kind: Toast['kind'], text: string) => void
  dismissToast: (id: string) => void
  askConfirm: (req: Omit<ConfirmRequest, 'id' | 'resolve'>) => Promise<boolean>
  answerConfirm: (ok: boolean) => void

  selectRealm: (id: string) => Promise<void>
  setView: (v: WorkspaceView) => void
  createRealm: (name: string, temporary?: boolean) => Promise<Realm>
  renameRealm: (id: string, name: string) => Promise<void>
  updateProfile: (id: string, patch: Partial<Realm['profile']>) => Promise<void>
  setArchived: (id: string, archived: boolean) => Promise<void>
  setTemporary: (id: string, temporary: boolean) => Promise<void>
  deleteRealm: (id: string) => Promise<void>

  saveAi: (patch: Partial<AiSettings>) => Promise<void>
  setConsent: (on: boolean) => Promise<void>

  send: (text: string) => Promise<void>
  stop: () => void
  regenerate: () => Promise<void>
  clearDialogue: () => Promise<void>

  addEvidence: (input: Partial<Evidence> & { summary: string }) => Promise<Evidence | null>
  updateEvidence: (id: string, patch: Partial<Evidence>) => Promise<void>
  deleteEvidence: (id: string) => Promise<void>
  extractEvidenceFromLogs: (importId?: string) => Promise<number>

  addChatLogs: (rows: Omit<ChatLogMessage, 'id' | 'realmId' | 'createdAt'>[]) => Promise<number>
  deleteImport: (importId: string) => Promise<void>
  analyzeChatLog: (importId?: string) => Promise<void>

  applyPublicCase: (caseId: PublicCaseId) => Promise<void>
}

/* ---------------------------------------------------------------------------
 * 公开案例：合成数据，用来在没有真实记录时也能看懂整套流程
 * ------------------------------------------------------------------------- */

export type PublicCaseId = 'steady-warm' | 'fading' | 'one-sided'

export interface PublicCase {
  id: PublicCaseId
  label: string
  summary: string
  realmName: string
  profile: Realm['profile']
  evidence: { date: string; summary: string; polarity: EvidencePolarity; completeness: EvidenceCompleteness; tier: EvidenceTier; tags: string[] }[]
}

export const PUBLIC_CASES: PublicCase[] = [
  {
    id: 'steady-warm',
    label: '稳步升温',
    summary: '认识三周，对方回应稳定但不主动；用户想确认要不要推进邀约。',
    realmName: '岸',
    profile: {
      mbti: 'ISTP',
      subjectiveScore: 6,
      relationshipBackground: '线下活动认识，加了联系方式，目前每周聊三到四次。',
      boundaries: '不接受半夜突然打电话；不希望被问行程细节。',
      communicationPreferences: '短句、有事说事、不喜欢连续追问。',
    },
    evidence: [
      { date: '', summary: '对方主动发来一张活动现场照片', polarity: 'positive', completeness: 'mid', tier: 'heuristic', tags: ['主动'] },
      { date: '', summary: '用户约周末，对方说"这周有点忙，下周看看"', polarity: 'negative', completeness: 'high', tier: 'framework', tags: ['邀约'] },
      { date: '', summary: '对方在用户没找她的那天先发了一句"在干嘛"', polarity: 'positive', completeness: 'high', tier: 'framework', tags: ['主动'] },
      { date: '', summary: '连续两天消息只回单字', polarity: 'negative', completeness: 'mid', tier: 'heuristic', tags: ['回应速度'] },
      { date: '', summary: '对方主动提起共同朋友的事，聊了四十分钟', polarity: 'positive', completeness: 'high', tier: 'heuristic', tags: ['对话长度'] },
    ],
  },
  {
    id: 'fading',
    label: '持续降温',
    summary: '交往四个月，近一个月回应变慢、取消过一次见面。',
    realmName: '岚',
    profile: {
      mbti: 'ISFJ',
      subjectiveScore: 4,
      relationshipBackground: '同事介绍认识，前三个月每天联系，近一个月明显变淡。',
      boundaries: '不希望被查手机；不接受情绪化的质问。',
      communicationPreferences: '需要提前约时间，不喜欢临时决定。',
    },
    evidence: [
      { date: '', summary: '原定周末见面，对方在前一晚说临时有事', polarity: 'negative', completeness: 'high', tier: 'heuristic', tags: ['取消'] },
      { date: '', summary: '回复间隔从平均十分钟变成三小时以上', polarity: 'negative', completeness: 'mid', tier: 'framework', tags: ['回应速度'] },
      { date: '', summary: '用户主动发起话题五次，对方主动发起一次', polarity: 'negative', completeness: 'high', tier: 'framework', tags: ['投入失衡'] },
      { date: '', summary: '对方在聊天里提到"最近想把生活理顺一点"', polarity: 'insufficient', completeness: 'low', tier: 'popular', tags: ['信号'] },
    ],
  },
  {
    id: 'one-sided',
    label: '单方面投入',
    summary: '半年来一直是用户在推动，对方接受但不回馈。',
    realmName: '穗',
    profile: {
      mbti: '',
      subjectiveScore: 3,
      relationshipBackground: '学长相认，用户长期主动约饭、送东西，对方会来但不主动联系。',
      boundaries: '',
      communicationPreferences: '',
    },
    evidence: [
      { date: '', summary: '用户本周第三次主动发消息，对方当天回复' , polarity: 'neutral', completeness: 'high', tier: 'heuristic', tags: ['主动'] },
      { date: '', summary: '对方接受邀约但从未反过来约用户', polarity: 'negative', completeness: 'high', tier: 'framework', tags: ['互惠'] },
      { date: '', summary: '对方在需要帮忙时主动联系，事后又恢复低频', polarity: 'negative', completeness: 'mid', tier: 'heuristic', tags: ['工具化'] },
    ],
  },
]

/* ---------------------------------------------------------------------------
 * store
 * ------------------------------------------------------------------------- */

let bootPromise: Promise<void> | null = null
let abortController: AbortController | null = null

export const useStudio = create<StudioState>((set, get) => ({
  ready: false,
  realms: [],
  activeRealmId: '',
  view: 'dialogue',
  messages: [],
  evidence: [],
  chatLogs: [],
  memory: [],
  ai: DEFAULT_AI,
  consentAt: null,
  streaming: false,
  streamText: '',
  toasts: [],
  lastError: null,
  confirmRequest: null,

  async init() {
    if (get().ready) return
    const [realms, ai, consentAt] = await Promise.all([
      db.db.realms.toArray(),
      db.getSetting<AiSettings>(AI_KEY, DEFAULT_AI),
      db.getSetting<number | null>(CONSENT_KEY, null),
    ])
    const sorted = realms.sort((a, b) => b.updatedAt - a.updatedAt)
    const active = sorted.find((r) => !r.archived) ?? sorted[0]
    set({ realms: sorted, ai: { ...DEFAULT_AI, ...ai }, consentAt })
    if (active) await loadRealm(set, active.id)
    set({ ready: true })
  },

  toast(kind, text) {
    const id = uid('t_')
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    window.setTimeout(() => get().dismissToast(id), kind === 'err' ? 9000 : 4200)
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  /**
   * 用应用内的确认框替代 window.confirm。
   * 原生 confirm 会冻住整个渲染进程（在自动化里表现为页面永久无响应），
   * 而且外观和这个程序完全不是一套东西。
   */
  askConfirm(req) {
    return new Promise<boolean>((resolve) => {
      set({ confirmRequest: { ...req, id: uid('cf_'), resolve } })
    })
  },

  answerConfirm(ok) {
    const req = get().confirmRequest
    if (!req) return
    set({ confirmRequest: null })
    req.resolve(ok)
  },

  async selectRealm(id) {
    await loadRealm(set, id)
  },

  setView(view) {
    set({ view })
  },

  async createRealm(name, temporary = false) {
    const now = Date.now()
    const realm: Realm = {
      id: uid('realm_'),
      name: name.trim() || '新',
      archived: false,
      temporary,
      profile: {
        mbti: '',
        subjectiveScore: 0,
        relationshipBackground: '',
        boundaries: '',
        communicationPreferences: '',
      },
      createdAt: now,
      updatedAt: now,
    }
    await db.db.realms.put(realm)
    set((s) => ({ realms: [realm, ...s.realms] }))
    await loadRealm(set, realm.id)
    return realm
  },

  async renameRealm(id, name) {
    const realm = get().realms.find((r) => r.id === id)
    if (!realm) return
    const next = { ...realm, name: name.trim() || realm.name, updatedAt: Date.now() }
    await db.db.realms.put(next)
    set((s) => ({ realms: s.realms.map((r) => (r.id === id ? next : r)) }))
  },

  async updateProfile(id, patch) {
    const realm = get().realms.find((r) => r.id === id)
    if (!realm) return
    const next = { ...realm, profile: { ...realm.profile, ...patch }, updatedAt: Date.now() }
    await db.db.realms.put(next)
    set((s) => ({ realms: s.realms.map((r) => (r.id === id ? next : r)) }))
  },

  async setArchived(id, archived) {
    const realm = get().realms.find((r) => r.id === id)
    if (!realm) return
    const next = { ...realm, archived, updatedAt: Date.now() }
    await db.db.realms.put(next)
    set((s) => ({ realms: s.realms.map((r) => (r.id === id ? next : r)) }))
  },

  async setTemporary(id, temporary) {
    const realm = get().realms.find((r) => r.id === id)
    if (!realm) return
    const next = { ...realm, temporary, updatedAt: Date.now() }
    await db.db.realms.put(next)
    set((s) => ({ realms: s.realms.map((r) => (r.id === id ? next : r)) }))
  },

  async deleteRealm(id) {
    await db.db.realms.delete(id)
    await Promise.all([
      db.db.chatMessages.where('realmId').equals(id).delete(),
      db.db.chatLogs.where('realmId').equals(id).delete(),
      db.db.evidence.where('realmId').equals(id).delete(),
      db.db.memory.where('realmId').equals(id).delete(),
      db.db.memoryOps.where('realmId').equals(id).delete(),
    ])
    const realms = get().realms.filter((r) => r.id !== id)
    set({ realms })
    if (get().activeRealmId === id) {
      const next = realms.find((r) => !r.archived) ?? realms[0]
      if (next) await loadRealm(set, next.id)
      else {
        set({ activeRealmId: '', messages: [], evidence: [], chatLogs: [], memory: [] })
      }
    }
  },

  async saveAi(patch) {
    const ai = { ...get().ai, ...patch }
    await db.putSetting(AI_KEY, ai)
    set({ ai })
  },

  async setConsent(on) {
    const consentAt = on ? Date.now() : null
    await db.putSetting(CONSENT_KEY, consentAt)
    set({ consentAt })
    get().toast(on ? 'ok' : 'warn', on ? '已开启长期记忆：档案字段会随 AI 请求一起发送。' : '已关闭长期记忆：AI 请求里不再包含任何档案字段。')
  },

  async send(text) {
    const trimmed = text.trim()
    if (!trimmed) return
    const { activeRealmId } = get()
    if (!activeRealmId) {
      get().toast('warn', '先建立一个关系档案，或使用「临时问问」。')
      return
    }
    const userMsg: ChatMessage = {
      id: uid('msg_'),
      realmId: activeRealmId,
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
    }
    await db.db.chatMessages.put(db.fromChatMessage(userMsg))
    set((s) => ({ messages: [...s.messages, userMsg] }))
    await runAssistant(set, get, activeRealmId)
  },

  stop() {
    abortController?.abort()
    abortController = null
    set({ streaming: false })
  },

  async regenerate() {
    const { activeRealmId, messages } = get()
    if (!activeRealmId || messages.length === 0) return
    // 把最后一条助手消息删掉，重跑
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
    if (lastAssistant) {
      await db.db.chatMessages.delete(lastAssistant.id)
      set((s) => ({ messages: s.messages.filter((m) => m.id !== lastAssistant.id) }))
    }
    await runAssistant(set, get, activeRealmId)
  },

  async clearDialogue() {
    const { activeRealmId } = get()
    if (!activeRealmId) return
    await db.db.chatMessages.where('realmId').equals(activeRealmId).delete()
    set({ messages: [] })
  },

  async addEvidence(input) {
    const { activeRealmId } = get()
    if (!activeRealmId) return null
    const row: Evidence = {
      id: uid('ev_'),
      realmId: activeRealmId,
      occurredAt: toDateKey(input.occurredAt) || toDateKey(input.createdAt ?? Date.now()),
      summary: input.summary.trim(),
      polarity: input.polarity ?? 'insufficient',
      completeness: input.completeness ?? 'mid',
      tier: input.tier ?? 'heuristic',
      origin: input.origin ?? 'manual',
      rawExcerpt: input.rawExcerpt,
      messageId: input.messageId,
      tags: input.tags ?? [],
      createdAt: input.createdAt ?? Date.now(),
      needsReview: input.needsReview,
    }
    await db.db.evidence.put(row)
    set((s) => ({
      evidence: [...s.evidence, row].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.createdAt - b.createdAt),
    }))
    return row
  },

  async updateEvidence(id, patch) {
    const cur = get().evidence.find((e) => e.id === id)
    if (!cur) return
    const next = { ...cur, ...patch, id: cur.id, realmId: cur.realmId }
    await db.db.evidence.put(next)
    set((s) => ({ evidence: s.evidence.map((e) => (e.id === id ? next : e)) }))
  },

  async deleteEvidence(id) {
    await db.db.evidence.delete(id)
    set((s) => ({ evidence: s.evidence.filter((e) => e.id !== id) }))
  },

  async extractEvidenceFromLogs(importId) {
    const { ai, activeRealmId, chatLogs } = get()
    if (!activeRealmId) return 0
    if (!ai.apiKey.trim()) {
      get().toast('warn', '先在「设置」里填入 API Key，才能让模型帮你抽证据。')
      return 0
    }
    const pool = importId ? chatLogs.filter((m) => m.importId === importId) : chatLogs
    if (pool.length === 0) {
      get().toast('warn', '没有可分析的聊天记录。')
      return 0
    }
    // 分批：一次最多 200 条，避免超出上下文也避免一次失败全丢
    const CHUNK = 200
    let added = 0
    for (let i = 0; i < pool.length; i += CHUNK) {
      const slice = pool.slice(i, i + CHUNK)
      const text = slice
        .map((m) => `${m.sentAt || '未标时间'} ${m.speaker === 'self' ? '我' : m.speaker === 'target' ? '对方' : m.sender}：${m.content}`)
        .join('\n')
      try {
        const raw = await complete(ai, [
          { role: 'system', content: EVIDENCE_EXTRACTION_PROMPT },
          { role: 'user', content: text },
        ])
        const parsed = extractJson<{ evidence: RawEvidence[] }>(raw)
        for (const item of parsed?.evidence ?? []) {
          if (!item.summary?.trim()) continue
          const created = await get().addEvidence({
            summary: item.summary.trim(),
            occurredAt: item.date || slice[0]?.sentAt || '',
            polarity: normalizePolarity(item.polarity),
            completeness: normalizeCompleteness(item.completeness),
            tier: 'heuristic',
            origin: 'ai',
            rawExcerpt: item.quote,
            tags: item.tags ?? [],
            needsReview: true,
          })
          if (created) added++
        }
      } catch (err) {
        get().toast('err', err instanceof AiError ? err.message : `抽取证据失败：${String(err)}`)
      }
    }
    get().toast(added > 0 ? 'ok' : 'warn', added > 0 ? `已抽取 ${added} 条候选证据，请逐条确认或删除。` : '模型没有返回可用的证据。')
    return added
  },

  async addChatLogs(rows) {
    const { activeRealmId } = get()
    if (!activeRealmId || rows.length === 0) return 0
    const now = Date.now()
    const withIds: ChatLogMessage[] = rows.map((r) => ({
      ...r,
      id: uid('log_'),
      realmId: activeRealmId,
      createdAt: now,
    }))
    await db.db.chatLogs.bulkPut(withIds)
    set((s) => ({ chatLogs: [...s.chatLogs, ...withIds] }))
    return withIds.length
  },

  async deleteImport(importId) {
    await db.db.chatLogs.where('importId').equals(importId).delete()
    set((s) => ({ chatLogs: s.chatLogs.filter((m) => m.importId !== importId) }))
  },

  async analyzeChatLog(importId) {
    const { ai, activeRealmId, chatLogs } = get()
    if (!activeRealmId) return
    if (!ai.apiKey.trim()) {
      get().toast('warn', '先在「设置」里填入 API Key。')
      return
    }
    const pool = importId ? chatLogs.filter((m) => m.importId === importId) : chatLogs
    if (pool.length === 0) {
      get().toast('warn', '没有可分析的聊天记录。')
      return
    }
    const metrics = computeReciprocity(
      pool.map((m) => ({ sender: m.sender, speaker: m.speaker, content: m.content, sentAt: m.sentAt })),
    )
    const summary = renderReciprocity(metrics)
    const userMsg: ChatMessage = {
      id: uid('msg_'),
      realmId: activeRealmId,
      role: 'user',
      content: `【聊天记录体检】共 ${pool.length} 条，来源批次 ${importId ?? '全部'}。请按指标解释，不要重算数字。`,
      createdAt: Date.now(),
    }
    await db.db.chatMessages.put(db.fromChatMessage(userMsg))
    set((s) => ({ messages: [...s.messages, userMsg] }))
    await runAssistant(set, get, activeRealmId, {
      extraSystem: chatlogAnalysisPrompt(summary),
      // 只有用户显式允许时才把原文一起发出去
      rawLogBlock: ai.sendRawChat ? pool.slice(-300).map((m) => `${m.sentAt} ${m.sender}：${m.content}`).join('\n') : '',
    })
    set({ view: 'dialogue' })
  },

  async applyPublicCase(caseId) {
    const item = PUBLIC_CASES.find((c) => c.id === caseId)
    if (!item) return
    // 公开案例也是建档案，所以同样要受上限约束；否则点几次就能绕过 5 个的上限，
    // 上游 skill 那条「最多同时保留 5 个对象」的边界就形同虚设。
    if (get().realms.filter((r) => !r.archived).length >= MAX_REALMS) {
      get().toast(
        'warn',
        `已经有 ${MAX_REALMS} 个档案了。公开案例也会占用一个名额：请先归档或删除一个，再载入案例。`,
      )
      return
    }
    const realm = await get().createRealm(item.realmName)
    await get().updateProfile(realm.id, item.profile)
    const now = Date.now()
    const rows: Evidence[] = item.evidence.map((e, i) => ({
      id: uid('ev_'),
      realmId: realm.id,
      // 合成案例没有真实日期，按"距今每三天一条"倒推，保证 K 线能画出来
      occurredAt: toDateKey(now - (item.evidence.length - i) * 3 * 86400000),
      summary: e.summary,
      polarity: e.polarity,
      completeness: e.completeness,
      tier: e.tier,
      origin: 'case',
      tags: e.tags,
      createdAt: now + i,
    }))
    await db.db.evidence.bulkPut(rows)
    set((s) => ({ evidence: [...s.evidence, ...rows] }))
    get().toast('ok', `已载入公开案例「${item.label}」。这些是合成数据，只用来演示流程。`)
  },
}))

/* ---------------------------------------------------------------------------
 * 内部动作
 * ------------------------------------------------------------------------- */

type Set = (partial: Partial<StudioState> | ((s: StudioState) => Partial<StudioState>)) => void
type Get = () => StudioState

async function loadRealm(set: Set, id: string) {
  const [messages, evidence, chatLogs, memory] = await Promise.all([
    db.db.chatMessages.where('realmId').equals(id).sortBy('createdAt'),
    db.db.evidence.where('realmId').equals(id).sortBy('createdAt'),
    db.db.chatLogs.where('realmId').equals(id).sortBy('sentAt'),
    db.db.memory.where('realmId').equals(id).toArray(),
  ])
  set({
    activeRealmId: id,
    messages: messages.map(db.toChatMessage),
    evidence: evidence.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.createdAt - b.createdAt),
    chatLogs,
    memory,
  })
}

interface RawEvidence {
  date?: string
  summary?: string
  polarity?: string
  completeness?: string
  quote?: string
  tags?: string[]
}

function normalizePolarity(v: string | undefined): EvidencePolarity {
  const allow: EvidencePolarity[] = ['positive', 'negative', 'neutral', 'insufficient']
  return allow.includes(v as EvidencePolarity) ? (v as EvidencePolarity) : 'insufficient'
}

function normalizeCompleteness(v: string | undefined): EvidenceCompleteness {
  const allow: EvidenceCompleteness[] = ['low', 'mid', 'high']
  return allow.includes(v as EvidenceCompleteness) ? (v as EvidenceCompleteness) : 'low'
}

/** 组装一轮助手回答：检索资料 → 拼系统提示 → 流式回答 → 落库。 */
async function runAssistant(
  set: Set,
  get: Get,
  realmId: string,
  extra?: { extraSystem?: string; rawLogBlock?: string },
) {
  const { ai, messages, evidence, consentAt, realms } = get()
  const realm = realms.find((r) => r.id === realmId)
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')

  if (!ai.apiKey.trim() && !ai.baseUrl.startsWith('http://127.0.0.1')) {
    const msg: ChatMessage = {
      id: uid('msg_'),
      realmId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      error: '还没有配置模型。打开左下角「模型连接」，填入 API Key 后重试；如果你用的是本机 Ollama，可以忽略密钥。',
    }
    await db.db.chatMessages.put(db.fromChatMessage(msg))
    set((s) => ({ messages: [...s.messages, msg] }))
    return
  }

  // 1. 本地检索（不依赖模型），把命中的资料原文喂进去
  const query = [lastUser?.content ?? '', realm?.profile.relationshipBackground ?? '', extra?.extraSystem ? '聊天记录 指标 互惠' : '']
    .filter(Boolean)
    .join(' ')
  const hits = ai.sendReferences && query ? retrieve(query, { limit: 4 }) : []
  const referenceBlock = buildReferenceBlock(hits)

  const metrics = computeMetrics(evidence)
  const system = buildSystemPrompt({
    realm,
    memoryEnabled: consentAt !== null,
    evidence,
    referenceBlock,
    metricsSummary: renderMetrics(metrics),
  })

  const turns: { role: 'system' | 'user' | 'assistant'; content: string }[] = [{ role: 'system', content: system }]
  if (extra?.extraSystem) {
    turns.push({ role: 'system', content: extra.extraSystem })
    if (extra.rawLogBlock) {
      turns.push({ role: 'system', content: `【聊天原文（用户已允许外发）】\n${extra.rawLogBlock}` })
    }
  }
  // 只带最近 12 轮，避免上下文无限增长
  for (const m of messages.slice(-12)) {
    if (m.role === 'system') continue
    if (m.error) continue
    turns.push({ role: m.role, content: m.content })
  }

  abortController = new AbortController()
  set({ streaming: true, streamText: '', lastError: null })

  let full = ''
  let usage: { prompt: number; completion: number } | undefined
  let model: string | undefined

  try {
    await streamChat(
      ai,
      turns,
      {
        onDelta: (t) => {
          full += t
          set({ streamText: full })
        },
        onDone: (info) => {
          usage = info.usage
          model = info.model
        },
        onError: (err) => set({ lastError: err.message }),
        signal: abortController.signal,
      },
    )
  } catch (err) {
    const message = err instanceof AiError ? err.message : String(err)
    set({ lastError: message })
    if (!full) full = ''
  }

  if (!full.trim()) {
    full = full || '（本次没有拿到回答。检查网络、密钥与模型名，或点「重试」。）'
  }

  const action = parseActionCard(full)
  const citations: Citation[] = hits.map((h) => ({
    docId: h.doc.id,
    title: h.doc.title,
    tier: 'framework',
    excerpt: h.excerpts[0]?.slice(0, 220),
  }))

  const assistant: ChatMessage = {
    id: uid('msg_'),
    realmId,
    role: 'assistant',
    content: full,
    createdAt: Date.now(),
    citations,
    action,
    usage,
    model,
  }
  await db.db.chatMessages.put(db.fromChatMessage(assistant))
  set((s) => ({ messages: [...s.messages, assistant], streaming: false, streamText: '' }))
  abortController = null
}

/**
 * 从回答里尝试解析出结构化的行动卡（下一步/观察窗口/停止条件/话术）。
 * 模型不总是按格式来，所以解析失败就返回 undefined，UI 会退回纯文本展示——
 * 这里绝不能因为格式不合就丢掉整段回答。
 */
export function parseActionCard(text: string): ActionCard | undefined {
  const grab = (labels: string[]): string => {
    for (const label of labels) {
      const re = new RegExp(`(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:\\*\\*)?${label}(?:\\*\\*)?\\s*[:：]?\\s*([^\\n]+(?:\\n(?!\\s*(?:#{1,6}\\s*)?(?:\\*\\*)?[\\u4e00-\\u9fff]{2,6}(?:\\*\\*)?\\s*[:：])[^\\n]*)*)`, 'i')
      const m = text.match(re)
      if (m?.[1]?.trim()) return m[1].trim()
    }
    return ''
  }
  const next = grab(['下一步', '现在的动作', '建议动作'])
  const window_ = grab(['观察窗口', '观察期'])
  const stop = grab(['停止条件', '止损条件'])
  const scripts = extractScripts(text)
  if (!next && !window_ && !stop && scripts.length === 0) return undefined
  return { next, window: window_, stop, scripts }
}

/** 抽出代码块里的可发送话术。一行一句，最多 6 版。 */
export function extractScripts(text: string): { label: string; text: string; cost: string }[] {
  const out: { label: string; text: string; cost: string }[] = []
  const blocks = [...text.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)]
  for (const b of blocks) {
    const lines = b[1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('//'))
    if (lines.length === 0) continue
    // 形如「稳健版：……」的标注行当作标签
    const labeled = lines.filter((l) => /^(稳健|会撩|直接|保守|推进|退出|轻度)/.test(l))
    if (labeled.length > 0) {
      for (const l of labeled) {
        const m = l.match(/^([^：:]{1,8})[：:]\s*(.+)$/)
        if (m) out.push({ label: m[1], text: m[2].trim(), cost: '' })
      }
    } else {
      out.push({ label: `话术 ${out.length + 1}`, text: lines.join('\n'), cost: '' })
    }
    if (out.length >= 6) break
  }
  return out.slice(0, 6)
}

export function renderMetrics(m: RelationMetrics): string {
  const parts = [
    `证据总数 ${m.evidenceCount} 条，覆盖 ${m.activeDays} 天`,
    `相位判读：${m.phase}`,
    `平均完整度 ${m.avgCompleteness}%`,
    `近 14 天方向净额 ${m.recentNet}（前一个 14 天 ${m.previousNet}）`,
    m.polarityRatio === null
      ? '正负证据比：暂无可比'
      : `升温/降温证据比 ${Number.isFinite(m.polarityRatio) ? m.polarityRatio : '∞（没有降温证据）'}`,
    m.daysSinceLast === null ? '最后一条证据日期：未知' : `最后一条证据在 ${m.daysSinceLast} 天前`,
  ]
  if (m.reciprocity) parts.push(renderReciprocity(m.reciprocity))
  return parts.map((p) => `- ${p}`).join('\n')
}

export function renderReciprocity(r: ReciprocityMetrics): string {
  return [
    `聊天记录 ${r.total} 条（我 ${r.selfCount}｜对方 ${r.targetCount}）`,
    `我发起 ${r.selfInitiated} 次会话，对方发起 ${r.targetInitiated} 次`,
    r.avgSelfReplyMinutes === null ? '我的平均回复间隔：样本不足' : `我的平均回复间隔 ${r.avgSelfReplyMinutes} 分钟`,
    r.avgTargetReplyMinutes === null ? '对方的平均回复间隔：样本不足' : `对方的平均回复间隔 ${r.avgTargetReplyMinutes} 分钟`,
    `粗略语气词命中：正向 ${r.toneHits.positive}｜负向 ${r.toneHits.negative}`,
  ].join('；')
}

/* ---------------------------------------------------------------------------
 * 派生选择器
 * ------------------------------------------------------------------------- */

export function selectActiveRealm(s: StudioState): Realm | undefined {
  return s.realms.find((r) => r.id === s.activeRealmId)
}

/*
 * 这里不要提供 selectCandles / selectKline / selectHeadline 这类「每次调用都造一个
 * 新数组或新对象」的选择器：Zustand v5 内部是 useSyncExternalStore，选择器返回的
 * 引用每次都不同时，React 会认为快照一直在变，于是无限重渲染（实测把整个页面打崩，
 * 报 "The result of getSnapshot should be cached to avoid an infinite loop"）。
 * 这类派生值请在选择器里只取原始数组（引用稳定），再用 useMemo 在组件内算。
 */

export function selectAiConfigured(s: StudioState): boolean {
  return s.ai.apiKey.trim().length > 0 || s.ai.baseUrl.startsWith('http://127.0.0.1')
}

export { formatDateTime }

/** 首次打开时把 store 拉起来（幂等）。 */
export function bootStudio(): Promise<void> {
  if (!bootPromise) bootPromise = useStudio.getState().init()
  return bootPromise
}

/** 解析当前服务商的展示名，用于设置页。 */
export function providerLabel(id: string): string {
  return PROVIDER_MAP.get(id)?.label ?? id
}
