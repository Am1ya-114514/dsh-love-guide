/**
 * 可自填的 agent API 预设。
 *
 * 本程序不绑定任何服务商：所有请求都走 OpenAI 兼容的 /chat/completions，
 * 所以只要服务商提供该端点，就能在这里填。
 *
 * corsOk 一栏是实测结论（2026-10 在本机 127.0.0.1 页面上）：为 true 表示浏览器
 * 直连可用，不需要本地代理。若哪天服务商收紧，用户可以直接改用自建的兼容网关，
 * 或者用「自定义」项指向任意反向代理。
 */

import type { ProviderPreset } from './types'

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    corsOk: true,
    note: '上游比赛项目默认对接的就是它。deepseek-reasoner 会输出思考过程，观测窗口建议放宽。',
  },
  {
    id: 'moonshot',
    label: 'Moonshot / Kimi',
    baseUrl: 'https://api.moonshot.cn',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    corsOk: true,
    note: '长上下文适合直接贴长聊天记录。',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.6', 'glm-4-plus', 'glm-4-air'],
    corsOk: true,
  },
  {
    id: 'siliconflow',
    label: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn',
    models: ['deepseek-ai/DeepSeek-V3.2-Exp', 'Qwen/Qwen3-235B-A22B-Instruct-2507'],
    corsOk: true,
    note: '返回 Access-Control-Allow-Origin: *，兼容模型最多。',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    models: ['gpt-5.6', 'gpt-5.6-mini', 'o5-mini'],
    corsOk: true,
    note: '需自备可用区域与额度。',
  },
  {
    id: 'ollama',
    label: '本机 Ollama（完全离线）',
    baseUrl: 'http://127.0.0.1:11434',
    models: ['qwen3:14b', 'llama3.3:70b'],
    corsOk: true,
    note: '数据不出本机。需要先装 Ollama 并拉取模型。',
  },
  {
    id: 'custom',
    label: '自定义（任意 OpenAI 兼容端点）',
    baseUrl: '',
    models: [],
    corsOk: false,
    note: '填自己的网关，例如公司内网代理或 one-api / new-api 聚合端点。',
  },
]

export const PROVIDER_MAP = new Map(PROVIDERS.map((p) => [p.id, p]))
