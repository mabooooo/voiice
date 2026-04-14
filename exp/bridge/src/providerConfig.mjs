import OpenAI from 'openai'

const PROVIDER_CONFIGS = {
  qwen: {
    id: 'qwen',
    label: 'Qwen',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    baseUrlEnv: 'DASHSCOPE_BASE_URL',
    modelEnv: 'QWEN_MODEL',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3-omni-flash',
  },
  xiaomi: {
    id: 'xiaomi',
    label: 'Xiaomi MiMo',
    apiKeyEnv: 'XIAOMI_MIMO_API_KEY',
    baseUrlEnv: 'XIAOMI_MIMO_BASE_URL',
    modelEnv: 'XIAOMI_MIMO_MODEL',
    defaultBaseUrl: 'https://api.xiaomimimo.com/v1',
    defaultModel: 'mimo-v2-omni',
  },
}

export function normalizeProvider(provider) {
  return provider === 'xiaomi' ? 'xiaomi' : 'qwen'
}

// 统一从环境变量构造 provider 配置，避免各模块重复拼装。
export function getProviderConfig(provider) {
  const selected = PROVIDER_CONFIGS[normalizeProvider(provider)]
  const apiKey = process.env[selected.apiKeyEnv] || ''
  const baseURL = process.env[selected.baseUrlEnv] || selected.defaultBaseUrl
  const model = process.env[selected.modelEnv] || selected.defaultModel

  return {
    id: selected.id,
    label: selected.label,
    apiKey,
    baseURL,
    model,
    configured: Boolean(apiKey),
  }
}

export function listProviderStatuses() {
  return Object.fromEntries(
    Object.keys(PROVIDER_CONFIGS).map((provider) => {
      const config = getProviderConfig(provider)
      return [provider, {
        label: config.label,
        configured: config.configured,
        baseURL: config.baseURL,
        model: config.model,
      }]
    }),
  )
}

// 统一收口 provider 的根层请求字段，避免 Xiaomi 特殊参数散落在调用侧。
export function buildProviderBodyExtensions(provider) {
  const normalizedProvider = normalizeProvider(provider)
  const bodyExtensions = {
    enable_thinking: false,
  }

  if (normalizedProvider === 'xiaomi') {
    bodyExtensions.thinking = {
      type: 'disabled',
    }
  }

  return bodyExtensions
}

// OpenAI 兼容 provider 都从这里创建 client，调用侧只关心 provider id。
export function createCompatibleClient(provider) {
  const config = getProviderConfig(provider)
  if (!config.apiKey) {
    throw new Error(`未读取到 ${config.id === 'qwen' ? 'DASHSCOPE_API_KEY' : 'XIAOMI_MIMO_API_KEY'}，请先在 exp/bridge/.env 中配置。`)
  }

  return {
    config,
    client: new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    }),
  }
}
