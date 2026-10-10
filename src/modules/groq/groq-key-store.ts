/** DI token for the DB-backed Groq key store (optional dependency of GroqKeyPool). */
export const GROQ_KEY_STORE = Symbol('GROQ_KEY_STORE')

export type GroqKeyFailureReason = 'exhausted' | 'invalid'

/**
 * Source of Groq API keys managed by admins (encrypted in MongoDB).
 * Implemented by GroqKeysService; consumed by GroqKeyPool.
 */
export interface GroqKeyStore {
  /** False when the encryption secret is missing: the pool then skips the store. */
  isEnabled(): boolean

  /** Oldest ready key (status active, not cooling down), decrypted; null if none. Counts as one issue. */
  current(): Promise<string | null>

  /** A key failed: `exhausted` => cool down for retryAfterSec (default 600s, max 7d); `invalid` => status invalid. */
  report(
    key: string,
    reason: GroqKeyFailureReason,
    retryAfterSec?: number,
    message?: string
  ): Promise<void>
}
