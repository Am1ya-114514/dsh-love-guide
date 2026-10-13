/**
 * 领域类型定义。
 *
 * 设计原则（继承上游 SKILL.md 的边界）：
 *  - 「事实 / 推测 / 未知」三态必须在类型层面分开，不能混成一个 "notes" 字段；
 *  - 证据要带来源等级，因为这份 skill 的立身之本就是「不把流行说法当结论」；
 *  - AI 说的话不算事实，只能进 observation 或推断区，且必须可标注为「未验证」。
 */

/** 上游知识库的证据分级：四级 + 一档"不足"。 */
export type EvidenceTier = 'strong' | 'framework' | 'popular' | 'heuristic' | 'insufficient'

export const EVIDENCE_TIER_LABEL: Record<EvidenceTier, string> = {
  strong: '较强证据',
  framework: '理论框架',
  popular: '流行说法',
  heuristic: '经验策略',
  insufficient: '证据不足',
}

export const EVIDENCE_TIER_DESC: Record<EvidenceTier, string> = {
  strong: '有可复查的研究、公开统计或权威规范支撑。可以据此调整判断权重。',
  framework: '成套的解释框架（依恋、互惠、边界等）。能帮你组织问题，但不能单独证明某个人怎么想。',
  popular: '流传很广的说法（冷读、推拉、所谓信号清单）。当话题引子可以，当判据不行。',
  heuristic: '从业者或社区总结的实务经验。在具体场景里可能好用，但不可外推。',
  insufficient: '现有材料不足以支撑任何方向的判断。此时正确的动作是补证据，不是下结论。',
}

/** 一篇知识库 / 实用材料。由 scripts/build-knowledge.mjs 生成。 */
export interface KnowledgeDoc {
  id: string
  kind: 'knowledge' | 'practical'
  file: string
  number: number
  slug: string
  title: string
  headings: string[]
  links: string[]
  reviewDate: string
  style: 'mindmap' | 'prose'
  bytes: number
  text: string
}

/** 对话消息。 */
export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  realmId: string
  role: ChatRole
  content: string
  createdAt: number
  /** AI 回答里引用了哪些知识库条目、哪些证据 id。 */
  citations?: Citation[]
  /** 该轮回答的「下一步 / 观察窗口 / 停止条件」，结构化的行动卡。 */
  action?: ActionCard
  /** 出错时记录，用于 UI 显示重试。 */
  error?: string
  /** 该条消息消耗的 token（若服务商返回）。 */
  usage?: { prompt: number; completion: number }
  model?: string
}

export interface Citation {
  docId: string
  title: string
  tier?: EvidenceTier
  /** 命中的原文片段，便于核对而不是让用户相信一句转述。 */
  excerpt?: string
}

/* ----------------------------------------------------------------------------
 * 证据
 * ------------------------------------------------------------------------- */

/**
 * 一条证据。message-log 是原始记录，evidence 是从记录里抽出来的"可判定单元"。
 * value 决定 K 线方向：
 *   positive  对方给出了新的、指向关系推进的确定信息
 *   negative  对方给出了新的、指向降温或收缩的信息
 *   neutral   有信息量但不改变方向（例如确认了某个既有事实）
 *   insufficient  记录本身不足以判定
 */
export type EvidencePolarity = 'positive' | 'negative' | 'neutral' | 'insufficient'

export const POLARITY_LABEL: Record<EvidencePolarity, string> = {
  positive: '升温',
  negative: '降温',
  neutral: '持平',
  insufficient: '证据不足',
}

/** 证据的完整度，决定这根 K 线算不算数。 */
export type EvidenceCompleteness = 'low' | 'mid' | 'high'

export interface Evidence {
  id: string
  realmId: string
  /** 证据发生的时间（用于 K 线横轴）。没有日期时用导入时间。 */
  occurredAt: string
  /** 一句话说清这条证据是什么。 */
  summary: string
  polarity: EvidencePolarity
  completeness: EvidenceCompleteness
  tier: EvidenceTier
  /** 来源：手动录入、聊天记录导入、AI 抽取、公开案例。 */
  origin: 'manual' | 'chat' | 'ai' | 'case'
  /** 原始片段（聊天原文），只在本机数据库里，不随 AI 请求外发，除非用户勾选。 */
  rawExcerpt?: string
  /** 关联的消息 id（如果这条证据是从某条聊天记录里抽出来的）。 */
  messageId?: string
  tags: string[]
  createdAt: number
  /** AI 生成的证据默认带这个标记，UI 上会显示「待你确认」。 */
  needsReview?: boolean
}

/* ----------------------------------------------------------------------------
 * 聊天记录
 * ------------------------------------------------------------------------- */

export interface ChatLogMessage {
  id: string
  realmId: string
  /** 说话人显示名（原文里的名字）。 */
  sender: string
  /** 映射到谁：self / target / other。长记录必须先做说话人映射。 */
  speaker: 'self' | 'target' | 'other'
  content: string
  /** 记录里的时间戳；解析不出来就是空。 */
  sentAt: string
  /** 导入批次，便于整批撤销。 */
  importId: string
  createdAt: number
}

/* ----------------------------------------------------------------------------
 * 行动
 * ------------------------------------------------------------------------- */

export interface ActionCard {
  /** 下一步做什么。 */
  next: string
  /** 观察窗口：到什么时候为止只看不动。 */
  window: string
  /** 停止条件：出现什么就必须停。 */
  stop: string
  /** 可直接发送的话术（第一屏必须能复制走）。 */
  scripts: ScriptOption[]
}

export interface ScriptOption {
  label: string
  text: string
  /** 使用这一版要付的代价。 */
  cost: string
}

/* ----------------------------------------------------------------------------
 * 对象档案
 * ------------------------------------------------------------------------- */

export interface RealmProfile {
  mbti: string
  /** 用户自己的主观综合评分（1-10），不是客观测量。 */
  subjectiveScore: number
  relationshipBackground: string
  boundaries: string
  communicationPreferences: string
}

export interface Realm {
  id: string
  /** 只有一个字的显示代号，也是可改字段。 */
  name: string
  /** 归档不删除，可恢复。 */
  archived: boolean
  /** 临时对象不写长期记忆。 */
  temporary: boolean
  profile: RealmProfile
  createdAt: number
  updatedAt: number
}

/* ----------------------------------------------------------------------------
 * AI 配置
 * ------------------------------------------------------------------------- */

/**
 * 纯前端直连：使用 OpenAI 兼容的 /chat/completions 协议。
 * DeepSeek / Moonshot / 智谱 / 硅基流动 / OpenAI 官方端点都对 127.0.0.1 页面放行了
 * 带 Authorization 头的预检请求，因此不需要本地代理。
 */
export interface ProviderPreset {
  id: string
  label: string
  baseUrl: string
  /** 该服务商常见的模型名，仅作为输入建议。 */
  models: string[]
  /** 是否对浏览器直连放行（实测结论，留作备注）。 */
  corsOk: boolean
  note?: string
}

export interface AiSettings {
  providerId: string
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  /** 是否把聊天原文一起发给模型。默认 false：只发摘要与证据。 */
  sendRawChat: boolean
  /** 是否把知识库片段发给模型。默认 true。 */
  sendReferences: boolean
}
