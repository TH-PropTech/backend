import type { CheckResult } from './groq-probe'
import type { GroqKeyStatus } from '../schemas/groq-api-key.schema'

export type GroqKeyAction = 'disable' | 'enable' | 'reset'

/** Admin-facing view of a stored key. `key` is the mask, never the raw key. */
export interface GroqKeyItem {
  _id: string
  key: string
  status: GroqKeyStatus
  cooldownUntil: number
  usageCount: number
  failCount: number
  lastUsedAt: number
  lastError?: string | undefined
  createdAt: number
  check?: CheckResult | undefined
}

export interface AddGroqKeysResult {
  added: number
  duplicated: number
}
