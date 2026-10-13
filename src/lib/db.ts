/**
 * 本地数据库（IndexedDB / Dexie）。
 *
 * 这里存的是最敏感的东西：真实聊天记录、对象档案、证据。
 * 因此遵守三条硬约束：
 *  1. 只落在本机浏览器里，本程序没有任何上传端点，也不引第三方脚本、字体或埋点；
 *  2. 长期记忆必须由你显式开启（consentAt），关闭后 AI 请求里不再带任何档案字段；
 *  3. 导出是明文 JSON，删除是真删除（Dexie 的 deleteDatabase 可由 UI 触发）。
 */

import Dexie, { type EntityTable } from 'dexie'
import type {
  ActionCard,
  ChatLogMessage,
  ChatMessage,
  Citation,
  EqReport,
  Evidence,
  Realm,
  SimAsset,
  SimChatMessage,
  SimSession,
} from './types'

export interface MemoryEntry {
  id: string
  realmId: string
  /** 字段名，例如「关系背景」「边界」。同一 realm + field 只保留一行。 */
  field: string
  value: string
  /** 只有 user 明确陈述或转述才允许写 object 事实，其余进 hypothesis。 */
  source: 'user_explicit' | 'user_report' | 'assistant_inference'
  scope: 'object' | 'hypothesis' | 'user'
  confidence: 'high' | 'mid' | 'low'
  updatedAt: number
}

export interface MemoryOperation {
  id: string
  realmId: string
  op: 'apply' | 'update' | 'undo' | 'delete'
  field: string
  before: string
  after: string
  at: number
}

export interface SettingRow {
  key: string
  value: unknown
}

/** 对话行的持久化形态：citations / action 存 JSON 字符串，避免 Dexie 索引复杂化。 */
interface ChatRow {
  id: string
  realmId: string
  role: ChatMessage['role']
  content: string
  createdAt: number
  citationsJson?: string
  actionJson?: string
  error?: string
  model?: string
  promptTokens?: number
  completionTokens?: number
}

class StudioDb extends Dexie {
  realms!: EntityTable<Realm, 'id'>
  chatMessages!: EntityTable<ChatRow, 'id'>
  chatLogs!: EntityTable<ChatLogMessage, 'id'>
  evidence!: EntityTable<Evidence, 'id'>
  memory!: EntityTable<MemoryEntry, 'id'>
  memoryOps!: EntityTable<MemoryOperation, 'id'>
  settings!: EntityTable<SettingRow, 'key'>
  simSessions!: EntityTable<SimSession, 'id'>
  simMessages!: EntityTable<SimChatMessage, 'id'>
  simAssets!: EntityTable<SimAsset, 'id'>
  eqReports!: EntityTable<EqReport, 'id'>

  constructor() {
    super('goutoujunshi-studio')
    this.version(1).stores({
      realms: 'id, archived, updatedAt',
      chatMessages: 'id, realmId, createdAt',
      chatLogs: 'id, realmId, importId, sentAt',
      evidence: 'id, realmId, occurredAt, polarity',
      memory: 'id, realmId, [realmId+field], field',
      memoryOps: 'id, realmId, at',
      settings: 'key',
    })
    // v2：模拟对练。老库走增量升级，已有档案与聊天记录不动。
    this.version(2).stores({
      realms: 'id, archived, updatedAt',
      chatMessages: 'id, realmId, createdAt',
      chatLogs: 'id, realmId, importId, sentAt',
      evidence: 'id, realmId, occurredAt, polarity',
      memory: 'id, realmId, [realmId+field], field',
      memoryOps: 'id, realmId, at',
      settings: 'key',
      simSessions: 'id, realmId, updatedAt',
      simMessages: 'id, realmId, sessionId, createdAt',
      simAssets: 'id, createdAt',
      eqReports: 'id, realmId, sessionId, at',
    })
  }
}

export const db = new StudioDb()

export function toChatMessage(row: ChatRow): ChatMessage {
  return {
    id: row.id,
    realmId: row.realmId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
    citations: row.citationsJson ? (JSON.parse(row.citationsJson) as Citation[]) : undefined,
    action: row.actionJson ? (JSON.parse(row.actionJson) as ActionCard) : undefined,
    error: row.error,
    model: row.model,
    usage:
      row.promptTokens !== undefined || row.completionTokens !== undefined
        ? { prompt: row.promptTokens ?? 0, completion: row.completionTokens ?? 0 }
        : undefined,
  }
}

export function fromChatMessage(m: ChatMessage): ChatRow {
  return {
    id: m.id,
    realmId: m.realmId,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
    citationsJson: m.citations?.length ? JSON.stringify(m.citations) : undefined,
    actionJson: m.action ? JSON.stringify(m.action) : undefined,
    error: m.error,
    model: m.model,
    promptTokens: m.usage?.prompt,
    completionTokens: m.usage?.completion,
  }
}

/* ---------------------------------------------------------------------------
 * 设置项
 * ------------------------------------------------------------------------- */

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key)
  return row === undefined ? fallback : (row.value as T)
}

export async function putSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value })
}

/* ---------------------------------------------------------------------------
 * 导出 / 清空
 * ------------------------------------------------------------------------- */

export interface ExportBundle {
  app: 'goutoujunshi-studio'
  version: 1
  exportedAt: string
  realms: Realm[]
  evidence: Evidence[]
  chatLogs: ChatLogMessage[]
  chatMessages: ChatMessage[]
  memory: MemoryEntry[]
  memoryOps: MemoryOperation[]
  simSessions: SimSession[]
  simMessages: SimChatMessage[]
  eqReports: EqReport[]
}

export async function exportAll(): Promise<ExportBundle> {
  const [realms, evidence, chatLogs, rows, memory, memoryOps, simSessions, simMessages, eqReports] =
    await Promise.all([
      db.realms.toArray(),
      db.evidence.toArray(),
      db.chatLogs.toArray(),
      db.chatMessages.toArray(),
      db.memory.toArray(),
      db.memoryOps.toArray(),
      db.simSessions.toArray(),
      db.simMessages.toArray(),
      db.eqReports.toArray(),
    ])
  return {
    app: 'goutoujunshi-studio',
    version: 1,
    exportedAt: new Date().toISOString(),
    realms,
    evidence,
    chatLogs,
    chatMessages: rows.map(toChatMessage),
    memory,
    memoryOps,
    simSessions,
    simMessages,
    eqReports,
  }
}

/** 彻底清空：连数据库一起删掉，下次打开是全新状态。 */
export async function wipeAll(): Promise<void> {
  await db.delete()
  await db.open()
}
