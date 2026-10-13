/**
 * 模型连接的默认值与存储键。
 *
 * 单独一个文件而不是留在 `store.ts` 里，是为了让**悬浮窗**能只 import 这几个
 * 常量而不把整个 zustand store 拖进来——store 会连带 metrics / knowledge /
 * chatlog / 公开案例，那是六百多 KB，悬浮窗用不到。
 */
import type { AiSettings } from './types'

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
  persona: 'fatfish',
  vision: false,
}
