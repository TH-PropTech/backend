import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { MongoRepository } from 'typeorm'
import { SystemConfig } from '../../properties/schemas/system-config.schema'
import type { GroqApiKey } from '../schemas/groq-api-key.schema'

/** Giá trị `SystemConfig.scope` của khóa Groq. */
export const GROQ_KEY_SCOPE = 'groq-key' as const

type Where = Record<string, unknown>
type Sort = Record<string, 'ASC' | 'DESC'>

/**
 * Facade lưu khóa Groq trong `system_configs{scope:'groq-key'}` (G-CFG2).
 * Chữ ký giống `MongoRepository<GroqApiKey>` mà `GroqKeysService` dùng trước đây; mọi
 * truy vấn tự thêm `scope: 'groq-key'`, `key = keyHash`, và trả về hình `GroqApiKey`
 * (`createdAt` là epoch ms). Claim `findOneAndUpdate` vẫn là MỘT lệnh nguyên tử.
 */
@Injectable()
export class GroqKeyRepository {
  constructor(
    @InjectRepository(SystemConfig)
    private readonly repo: MongoRepository<SystemConfig>
  ) {}

  async findOneAndUpdate(
    filter: Where,
    update: Record<string, unknown>,
    options: {
      sort?: Record<string, 1 | -1>
      returnDocument?: 'after' | 'before'
    }
  ): Promise<GroqApiKey | null> {
    const doc = (await this.repo.findOneAndUpdate(
      { scope: GROQ_KEY_SCOPE, ...filter },
      update,
      options
    )) as SystemConfig | null
    return doc ? toLegacy(doc) : null
  }

  async find(options: { order: Sort }): Promise<GroqApiKey[]> {
    const rows = await this.repo.find({
      where: { scope: GROQ_KEY_SCOPE },
      order: options.order,
    })
    return rows.map(toLegacy)
  }

  async findOneBy(where: Where): Promise<GroqApiKey | null> {
    const row = await this.repo.findOneBy({ scope: GROQ_KEY_SCOPE, ...where })
    return row ? toLegacy(row) : null
  }

  create(value: Partial<GroqApiKey>): GroqApiKey {
    return value as GroqApiKey
  }

  async insert(entity: Partial<GroqApiKey>): Promise<void> {
    await this.repo.insert(toRow(entity))
  }

  async updateOne(
    filter: Where,
    update: Record<string, unknown>
  ): Promise<void> {
    await this.repo.updateOne({ scope: GROQ_KEY_SCOPE, ...filter }, update)
  }

  async deleteOne(filter: Where): Promise<void> {
    await this.repo.deleteOne({ scope: GROQ_KEY_SCOPE, ...filter })
  }
}

function toLegacy(row: SystemConfig): GroqApiKey {
  const legacy: Record<string, unknown> = {
    _id: row._id,
    keyEnc: row.keyEnc,
    keyHash: row.keyHash,
    keyMask: row.keyMask,
    status: row.status,
    cooldownUntil: row.cooldownUntil,
    usageCount: row.usageCount,
    failCount: row.failCount,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt.getTime(),
  }
  if (row.lastError !== undefined) legacy.lastError = row.lastError
  if (row.check !== undefined) legacy.check = row.check
  return legacy as unknown as GroqApiKey
}

function toRow(entity: Partial<GroqApiKey>): Partial<SystemConfig> {
  const { createdAt, _id, ...rest } = entity
  const row: Partial<SystemConfig> = {
    ...(rest as Partial<SystemConfig>),
    scope: GROQ_KEY_SCOPE,
    key: entity.keyHash as string,
    createdAt: new Date(createdAt as number),
  }
  if (_id !== undefined) row._id = _id
  return row
}
