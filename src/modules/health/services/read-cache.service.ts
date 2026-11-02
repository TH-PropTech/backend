import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash } from 'crypto'
import { RedisService } from './redis.service'

const KEY_PREFIX = 'cache'
const TTL_JITTER_RATIO = 0.1
// Sau lỗi Redis, bỏ qua cache trong khoảng này để request không phải chờ timeout lặp lại.
const REDIS_COOLDOWN_MS = 10_000

type CacheKeyParts = Readonly<Record<string, unknown>>

/**
 * Cache đọc dùng Redis, khoá theo version của namespace.
 * - invalidate() chỉ INCR version nên không cần SCAN/KEYS; khoá cũ tự hết hạn theo TTL.
 * - Single-flight: cùng một khoá trong cùng tiến trình chỉ chạy loader một lần.
 * - Mọi lỗi Redis đều rơi về loader, không làm hỏng request; sau lỗi, cache tạm tắt REDIS_COOLDOWN_MS.
 */
@Injectable()
export class ReadCacheService {
  private readonly logger = new Logger(ReadCacheService.name)
  private readonly inFlight = new Map<string, Promise<unknown>>()
  private degradedUntil = 0

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService
  ) {}

  async wrap<T>(
    namespace: string,
    keyParts: CacheKeyParts,
    loader: () => Promise<T>,
    ttlSeconds: number = this.configService.getOrThrow<number>(
      'cache.ttlSeconds'
    )
  ): Promise<T> {
    const version = await this.readVersion(namespace)
    const key = this.buildKey(namespace, version, keyParts)

    const pending = this.inFlight.get(key) as Promise<T> | undefined
    if (pending) return pending

    const task = this.loadThroughCache(key, loader, ttlSeconds)
    this.inFlight.set(key, task)
    try {
      return await task
    } finally {
      this.inFlight.delete(key)
    }
  }

  async invalidate(namespace: string): Promise<void> {
    // Đang tắt cache thì không có gì để vô hiệu hoá
    if (this.isDegraded()) return
    try {
      await this.redisService.getClient().incr(this.versionKey(namespace))
    } catch (error) {
      this.markDegraded()
      this.logger.warn(
        `Cache invalidate failed for ${namespace}: ${describe(error)}`
      )
    }
  }

  private async loadThroughCache<T>(
    key: string,
    loader: () => Promise<T>,
    ttlSeconds: number
  ): Promise<T> {
    const cached = await this.readCached<T>(key)
    if (cached !== undefined) return cached

    const value = await loader()
    await this.writeCached(key, value, ttlSeconds)
    return value
  }

  private async readCached<T>(key: string): Promise<T | undefined> {
    if (this.isDegraded()) return undefined
    try {
      const raw = await this.redisService.get(key)
      return raw === null ? undefined : (JSON.parse(raw) as T)
    } catch (error) {
      this.markDegraded()
      this.logger.warn(`Cache read failed: ${describe(error)}`)
      return undefined
    }
  }

  private async writeCached(
    key: string,
    value: unknown,
    ttlSeconds: number
  ): Promise<void> {
    if (this.isDegraded()) return
    try {
      const serialized = JSON.stringify(value)
      if (serialized === undefined) return
      await this.redisService.set(key, serialized, withJitter(ttlSeconds))
    } catch (error) {
      this.markDegraded()
      this.logger.warn(`Cache write failed: ${describe(error)}`)
    }
  }

  private async readVersion(namespace: string): Promise<string> {
    if (this.isDegraded()) return '0'
    try {
      return (await this.redisService.get(this.versionKey(namespace))) ?? '0'
    } catch (error) {
      this.markDegraded()
      this.logger.warn(`Cache version read failed: ${describe(error)}`)
      return '0'
    }
  }

  private isDegraded(): boolean {
    return Date.now() < this.degradedUntil
  }

  private markDegraded(): void {
    this.degradedUntil = Date.now() + REDIS_COOLDOWN_MS
  }

  private versionKey(namespace: string): string {
    return `${KEY_PREFIX}:ver:${namespace}`
  }

  private buildKey(
    namespace: string,
    version: string,
    keyParts: CacheKeyParts
  ): string {
    const digest = createHash('sha1')
      .update(JSON.stringify(sortKeys(keyParts)))
      .digest('hex')
    return `${KEY_PREFIX}:${namespace}:v${version}:${digest}`
  }
}

// Phân tán thời điểm hết hạn để tránh nhiều khoá hết hạn cùng lúc.
function withJitter(ttlSeconds: number): number {
  const jitter = ttlSeconds * TTL_JITTER_RATIO * Math.random()
  return Math.max(1, Math.round(ttlSeconds + jitter))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortKeys(entry)])
  )
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
