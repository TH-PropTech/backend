const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
const PROBE_TIMEOUT_MS = 15_000
const NON_CHAT_MODEL = /whisper|guard|tts|orpheus|playai|embed/i
const PREFERRED_PROBE_MODEL = 'llama-3.1-8b-instant'

export const GROQ_INVALID_KEY_MESSAGE = 'Key không hợp lệ hoặc đã bị thu hồi'

export interface GroqModelInfo {
  id: string
  owner: string
  ctx: number
}

export interface GroqRateLimits {
  tokensLimit?: number | undefined
  tokensRemaining?: number | undefined
  tokensReset?: string | undefined
  requestsLimit?: number | undefined
  requestsRemaining?: number | undefined
  requestsReset?: string | undefined
}

export interface CheckResult {
  at: number
  ok: boolean
  error?: string | undefined
  models: GroqModelInfo[]
  probeModel?: string | undefined
  limited?: boolean | undefined
  message?: string | undefined
  limits?: GroqRateLimits | undefined
}

interface GroqModelsResponse {
  data: {
    id: string
    owned_by: string
    active?: boolean
    context_window: number
  }[]
}

function parseNumberHeader(value: string | null): number | undefined {
  if (value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

function parseStringHeader(value: string | null): string | undefined {
  return value ?? undefined
}

function buildLimits(headers: Headers): GroqRateLimits {
  return {
    tokensLimit: parseNumberHeader(headers.get('x-ratelimit-limit-tokens')),
    tokensRemaining: parseNumberHeader(
      headers.get('x-ratelimit-remaining-tokens')
    ),
    tokensReset: parseStringHeader(headers.get('x-ratelimit-reset-tokens')),
    requestsLimit: parseNumberHeader(headers.get('x-ratelimit-limit-requests')),
    requestsRemaining: parseNumberHeader(
      headers.get('x-ratelimit-remaining-requests')
    ),
    requestsReset: parseStringHeader(headers.get('x-ratelimit-reset-requests')),
  }
}

async function readRateLimitMessage(response: Response): Promise<string> {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } }
    return parsed.error?.message ?? text.slice(0, 300)
  } catch {
    return text.slice(0, 300)
  }
}

/**
 * Checks a Groq key: lists the active models, then sends a 1-token chat request
 * whose x-ratelimit-* headers report the remaining quota.
 * Never throws; network failures are returned as `ok: false`.
 */
export async function probeKey(key: string): Promise<CheckResult> {
  const at = Date.now()
  const authHeaders = { Authorization: `Bearer ${key}` }
  try {
    const modelsResponse = await fetch(`${GROQ_BASE_URL}/models`, {
      headers: authHeaders,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (modelsResponse.status === 401 || modelsResponse.status === 403) {
      return {
        at,
        ok: false,
        error: GROQ_INVALID_KEY_MESSAGE,
        models: [],
      }
    }
    if (!modelsResponse.ok) {
      return {
        at,
        ok: false,
        error: `Groq trả lỗi ${modelsResponse.status}`,
        models: [],
      }
    }

    const body = (await modelsResponse.json()) as GroqModelsResponse
    const models = body.data
      .filter(model => model.active !== false)
      .map(model => ({
        id: model.id,
        owner: model.owned_by,
        ctx: model.context_window,
      }))
      .sort((a, b) => a.id.localeCompare(b.id))

    const probe =
      models.find(model => model.id === PREFERRED_PROBE_MODEL) ??
      models.find(model => !NON_CHAT_MODEL.test(model.id))
    const result: CheckResult = { at, ok: true, models }
    if (!probe) return result
    result.probeModel = probe.id

    const chatResponse = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: probe.id,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const limits = buildLimits(chatResponse.headers)
    result.limits = limits

    if (chatResponse.status === 429) {
      result.limited = true
      result.message = await readRateLimitMessage(chatResponse)
      const retryAfter = parseNumberHeader(
        chatResponse.headers.get('retry-after')
      )
      if (retryAfter && limits.tokensReset === undefined) {
        limits.tokensReset = `${retryAfter}s`
      }
    }
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      at,
      ok: false,
      error: `Không gọi được Groq: ${message}`,
      models: [],
    }
  }
}
