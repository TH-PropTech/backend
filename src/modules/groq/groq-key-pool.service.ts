import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000
const INVALID_KEY_COOLDOWN_MS = 60 * 60 * 1000

/**
 * Holds several Groq API keys and fails over to the next one when a key hits
 * its rate limit (429) or is rejected (401/403). Groq limits are per model, so
 * cooldowns are tracked per key+model. State is in-memory (per instance).
 */
@Injectable()
export class GroqKeyPool {
  private readonly logger = new Logger(GroqKeyPool.name)
  private readonly keys: string[]
  private readonly cooldownUntil = new Map<string, number>()

  constructor(configService: ConfigService) {
    this.keys = configService.get<string[]>('groq.apiKeys') ?? []
  }

  hasKeys(): boolean {
    return this.keys.length > 0
  }

  async run(
    model: string,
    request: (apiKey: string) => Promise<Response>
  ): Promise<Response> {
    let last: Response | undefined

    for (const [index, key] of this.keys.entries()) {
      const slot = `${index}:${model}`
      if ((this.cooldownUntil.get(slot) ?? 0) > Date.now()) continue

      const response = await request(key)
      const cooldownMs = this.cooldownFor(response)
      if (cooldownMs === undefined) return response

      this.cooldownUntil.set(slot, Date.now() + cooldownMs)
      this.logger.warn(
        `Groq key ${index + 1}/${this.keys.length} unavailable for ${model} (HTTP ${response.status}); cooling down ${Math.round(cooldownMs / 1000)}s`
      )
      last = response
    }

    // Every key is cooling down or just failed: let the caller handle a 429.
    return last ?? new Response(null, { status: 429 })
  }

  private cooldownFor(response: Response): number | undefined {
    if (response.status === 401 || response.status === 403) {
      return INVALID_KEY_COOLDOWN_MS
    }
    if (response.status !== 429) return undefined

    const seconds = Number(response.headers?.get('retry-after'))
    return Number.isFinite(seconds) && seconds > 0
      ? Math.min(seconds * 1000, MAX_COOLDOWN_MS)
      : DEFAULT_RATE_LIMIT_COOLDOWN_MS
  }
}
