import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GROQ_KEY_STORE } from '../utils/groq-key-store'
import type {
  GroqKeyFailureReason,
  GroqKeyStore,
} from '../utils/groq-key-store'

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000
const INVALID_KEY_COOLDOWN_MS = 60 * 60 * 1000
const MAX_ROTATIONS = 3
/** How long a store key is cached, so admin changes (disable/delete) apply within a minute. */
const STORE_KEY_TTL_MS = 60_000

/**
 * Holds Groq API keys and fails over to the next one when a key hits its rate
 * limit (429) or is rejected (401).
 *
 * Key source order:
 *  1. The admin-managed key store (encrypted in MongoDB), when it is enabled.
 *     The current key is cached in memory; failures are reported back to the
 *     store, which cools the key down or marks it invalid.
 *  2. Local keys from GROQ_API_KEYS / GROQ_API_KEY, with per-key+model cooldowns.
 *     Used when the store is disabled, empty, or unavailable.
 *
 * State is in-memory (per instance).
 */
@Injectable()
export class GroqKeyPool {
  private readonly logger = new Logger(GroqKeyPool.name)
  private readonly keys: string[]
  private readonly cooldownUntil = new Map<string, number>()
  /** Key served from the store; null until fetched or after an empty rotation. */
  private storeKey: string | null = null
  private storeKeyAt = 0
  /** In-flight store rotation, shared by concurrent requests that hit the same key. */
  private rotation: Promise<string | null> | null = null

  constructor(
    configService: ConfigService,
    @Optional() @Inject(GROQ_KEY_STORE) private readonly store?: GroqKeyStore
  ) {
    this.keys = configService.get<string[]>('groq.apiKeys') ?? []
  }

  hasKeys(): boolean {
    return this.store?.isEnabled() === true || this.keys.length > 0
  }

  async run(
    model: string,
    request: (apiKey: string) => Promise<Response>
  ): Promise<Response> {
    const store = this.store
    if (store?.isEnabled() === true) {
      try {
        const response = await this.runWithStore(store, request)
        if (response) return response
        this.logger.warn('No ready Groq key in the store; using local keys')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (this.keys.length === 0) throw error
        this.logger.warn(`Groq key store failed, using local keys: ${message}`)
      }
    }

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

  /**
   * Returns undefined when the store has no ready key, so the caller can fall
   * back to local keys. Once a store key is in use, the last response is
   * returned as-is rather than switching sources mid-flight.
   */
  private async runWithStore(
    store: GroqKeyStore,
    request: (apiKey: string) => Promise<Response>
  ): Promise<Response | undefined> {
    if (
      this.storeKey === null ||
      Date.now() - this.storeKeyAt > STORE_KEY_TTL_MS
    ) {
      this.storeKey = await store.current()
      this.storeKeyAt = Date.now()
    }
    let key = this.storeKey
    if (key === null) return undefined

    for (let attempt = 0; ; attempt++) {
      const response = await request(key)
      const reason = storeFailureReason(response)
      if (reason === undefined) return response
      if (attempt >= MAX_ROTATIONS) return response

      this.logger.warn(`Groq key rejected (HTTP ${response.status}); rotating`)
      const next = await this.rotateStoreKey(store, key, reason, response)
      if (next === null) return response
      key = next
    }
  }

  /** Reports the failed key once and returns the next store key (shared by concurrent callers). */
  private rotateStoreKey(
    store: GroqKeyStore,
    failedKey: string,
    reason: GroqKeyFailureReason,
    response: Response
  ): Promise<string | null> {
    // Another request already rotated this key out.
    if (this.storeKey !== failedKey) return Promise.resolve(this.storeKey)
    this.rotation ??= this.reportAndNext(store, failedKey, reason, response)
    return this.rotation
  }

  private async reportAndNext(
    store: GroqKeyStore,
    failedKey: string,
    reason: GroqKeyFailureReason,
    response: Response
  ): Promise<string | null> {
    try {
      const retryAfter =
        Number(response.headers.get('retry-after')) || undefined
      const message = (await response.clone().text()).slice(0, 200)
      await store.report(failedKey, reason, retryAfter, message)
      this.storeKey = await store.current()
      this.storeKeyAt = Date.now()
      return this.storeKey
    } finally {
      this.rotation = null
    }
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

function storeFailureReason(
  response: Response
): GroqKeyFailureReason | undefined {
  if (response.status === 429) return 'exhausted'
  if (response.status === 401) return 'invalid'
  return undefined
}
