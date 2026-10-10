import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { MongoRepository } from 'typeorm'
import {
  GROQ_KEY_SECRET_MIN_LENGTH,
  decrypt,
  encrypt,
  keyHash,
  maskKey,
} from './groq-key-crypto'
import {
  GROQ_INVALID_KEY_MESSAGE,
  probeKey,
  type CheckResult,
} from './groq-probe'
import type { GroqKeyFailureReason, GroqKeyStore } from './groq-key-store'
import type {
  AddGroqKeysResult,
  GroqKeyAction,
  GroqKeyItem,
} from './groq-keys.types'
import { GroqApiKey } from './schemas/groq-api-key.schema'

const DEFAULT_COOLDOWN_S = 600
const MAX_COOLDOWN_S = 7 * 24 * 60 * 60
const LIMITED_CHECK_COOLDOWN_MS = 10 * 60_000
const MAX_KEYS_PER_REQUEST = 100
const MAX_STORED_MESSAGE_LENGTH = 300
const DUPLICATE_KEY_ERROR_CODE = 11000
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/
const SECRET_NOT_CONFIGURED_MESSAGE = 'Chưa cấu hình GROQ_KEY_ENCRYPTION_SECRET'

type KeyStateUpdate = Partial<
  Pick<GroqApiKey, 'status' | 'cooldownUntil' | 'lastError'>
>

export interface CheckGroqKeyInput {
  key?: string
  id?: string
}

/**
 * Admin-managed Groq API keys, stored AES-256-GCM encrypted in MongoDB.
 * Implements GroqKeyStore, which GroqKeyPool consumes before falling back to env keys.
 */
@Injectable()
export class GroqKeysService implements GroqKeyStore {
  private readonly logger = new Logger(GroqKeysService.name)
  private readonly secret: string

  constructor(
    @InjectRepository(GroqApiKey)
    private readonly repo: MongoRepository<GroqApiKey>,
    configService: ConfigService
  ) {
    this.secret = configService.get<string>('groq.keyEncryptionSecret') ?? ''
    if (this.secret.length > 0 && !this.isEnabled()) {
      this.logger.warn(
        `GROQ_KEY_ENCRYPTION_SECRET must be at least ${GROQ_KEY_SECRET_MIN_LENGTH} characters; Groq key store disabled`
      )
    }
  }

  isEnabled(): boolean {
    return this.secret.length >= GROQ_KEY_SECRET_MIN_LENGTH
  }

  /** Picks the oldest ready key and counts one issue; atomic on the document. */
  async current(): Promise<string | null> {
    if (!this.isEnabled()) return null
    const now = Date.now()
    const doc = (await this.repo.findOneAndUpdate(
      { status: 'active', cooldownUntil: { $lte: now } },
      { $inc: { usageCount: 1 }, $set: { lastUsedAt: now } },
      { sort: { createdAt: 1 }, returnDocument: 'after' }
    )) as GroqApiKey | null
    if (!doc) return null
    return decrypt(doc.keyEnc, this.secret)
  }

  async report(
    key: string,
    reason: GroqKeyFailureReason,
    retryAfterSec?: number,
    message?: string
  ): Promise<void> {
    if (!this.isEnabled()) return
    const lastError = (
      message ?? (reason === 'invalid' ? 'Key bị Groq từ chối' : 'Hết hạn mức')
    ).slice(0, MAX_STORED_MESSAGE_LENGTH)
    const state: KeyStateUpdate =
      reason === 'invalid'
        ? { status: 'invalid', lastError }
        : {
            cooldownUntil: Date.now() + cooldownSeconds(retryAfterSec) * 1000,
            lastError,
          }
    await this.repo.updateOne(
      { keyHash: keyHash(key, this.secret) },
      { $set: state, $inc: { failCount: 1 } }
    )
    this.logger.warn(`Groq key marked ${reason}`)
  }

  async list(): Promise<GroqKeyItem[]> {
    this.assertEnabled()
    const docs = await this.repo.find({ order: { createdAt: 'DESC' } })
    return docs.map(doc => toItem(doc))
  }

  /** Adds keys that are not yet stored. Keys already present are counted as duplicated. */
  async addMany(
    keys: string[],
    checks: Record<string, CheckResult> = {}
  ): Promise<AddGroqKeysResult> {
    this.assertEnabled()
    const unique = [...new Set(keys)]
    if (unique.length > MAX_KEYS_PER_REQUEST) {
      throw new BadRequestException(
        `Tối đa ${MAX_KEYS_PER_REQUEST} key mỗi lần`
      )
    }
    const now = Date.now()
    let added = 0
    for (const key of unique) {
      const check = checks[key] as unknown
      if (
        await this.insertKey(key, now, isCheckResult(check) ? check : undefined)
      ) {
        added++
      }
    }
    return { added, duplicated: unique.length - added }
  }

  /**
   * `{ key }` probes a raw key without storing it.
   * `{ id }` probes a saved key and stores the result (invalid => status invalid, limited => 10 min cooldown).
   */
  async check(input: CheckGroqKeyInput): Promise<CheckResult> {
    if (input.key !== undefined) return probeKey(input.key)
    if (input.id === undefined) {
      throw new BadRequestException('Cần truyền key hoặc id')
    }
    this.assertEnabled()
    const _id = parseId(input.id)
    const doc = await this.findById(_id)
    const result = await probeKey(decrypt(doc.keyEnc, this.secret))

    const set: Record<string, unknown> = { check: result }
    if (!result.ok && result.error === GROQ_INVALID_KEY_MESSAGE) {
      set.status = 'invalid'
    } else if (result.limited) {
      set.cooldownUntil = Date.now() + LIMITED_CHECK_COOLDOWN_MS
    }
    await this.repo.updateOne({ _id }, { $set: set })
    return result
  }

  async setStatus(id: string, action: GroqKeyAction): Promise<void> {
    this.assertEnabled()
    const _id = parseId(id)
    await this.findById(_id)
    const state: KeyStateUpdate =
      action === 'disable'
        ? { status: 'disabled' }
        : { status: 'active', cooldownUntil: 0, lastError: '' }
    await this.repo.updateOne({ _id }, { $set: state })
  }

  async remove(id: string): Promise<void> {
    this.assertEnabled()
    const _id = parseId(id)
    await this.findById(_id)
    await this.repo.deleteOne({ _id })
  }

  private assertEnabled(): void {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(SECRET_NOT_CONFIGURED_MESSAGE)
    }
  }

  private async findById(_id: ObjectId): Promise<GroqApiKey> {
    const doc = await this.repo.findOneBy({ _id })
    if (!doc) throw new NotFoundException('Không tìm thấy key')
    return doc
  }

  /** Returns true when the key was inserted, false when it already exists. */
  private async insertKey(
    key: string,
    now: number,
    check: CheckResult | undefined
  ): Promise<boolean> {
    const hash = keyHash(key, this.secret)
    // The unique index only exists when TypeORM synchronize is on, so check explicitly too.
    if (await this.repo.findOneBy({ keyHash: hash })) return false

    const entity = this.repo.create({
      keyEnc: encrypt(key, this.secret),
      keyHash: hash,
      keyMask: maskKey(key),
      status: 'active',
      cooldownUntil: 0,
      usageCount: 0,
      failCount: 0,
      lastUsedAt: 0,
      createdAt: now,
      ...(check ? { check } : {}),
    })
    try {
      await this.repo.insert(entity)
      return true
    } catch (error) {
      if (isDuplicateKeyError(error)) return false
      throw error
    }
  }
}

function cooldownSeconds(retryAfterSec: number | undefined): number {
  if (retryAfterSec === undefined || !(retryAfterSec > 0)) {
    return DEFAULT_COOLDOWN_S
  }
  return Math.min(retryAfterSec, MAX_COOLDOWN_S)
}

function parseId(id: string): ObjectId {
  if (!OBJECT_ID_PATTERN.test(id)) {
    throw new BadRequestException('id không hợp lệ')
  }
  return new ObjectId(id)
}

function toItem(doc: GroqApiKey): GroqKeyItem {
  return {
    _id: doc._id.toHexString(),
    key: doc.keyMask,
    status: doc.status,
    cooldownUntil: doc.cooldownUntil,
    usageCount: doc.usageCount,
    failCount: doc.failCount,
    lastUsedAt: doc.lastUsedAt,
    createdAt: doc.createdAt,
    ...(doc.lastError !== undefined ? { lastError: doc.lastError } : {}),
    ...(doc.check ? { check: doc.check } : {}),
  }
}

function isCheckResult(value: unknown): value is CheckResult {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<CheckResult>
  return (
    typeof candidate.at === 'number' &&
    typeof candidate.ok === 'boolean' &&
    Array.isArray(candidate.models)
  )
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === DUPLICATE_KEY_ERROR_CODE
  )
}
