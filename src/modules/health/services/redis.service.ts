import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

// Redis chậm hoặc mất kết nối phải làm lệnh lỗi nhanh để cache và rate limit kịp fail-open.
const COMMAND_TIMEOUT_MS = 1000
const CONNECT_TIMEOUT_MS = 2000

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name)
  private redisClient!: Redis
  private reportedError = false

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const redisUrl =
      this.configService.get<string>('redis.url') || 'redis://localhost:6379'
    this.redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      commandTimeout: COMMAND_TIMEOUT_MS,
      connectTimeout: CONNECT_TIMEOUT_MS,
    })
    this.redisClient.on('error', error => {
      if (this.reportedError) return
      this.reportedError = true
      this.logger.warn(`Redis error: ${error.message}`)
    })
    this.redisClient.on('ready', () => {
      this.reportedError = false
    })
  }

  onModuleDestroy(): void {
    this.redisClient.disconnect()
  }

  getClient(): Redis {
    return this.redisClient
  }

  async get(key: string): Promise<string | null> {
    return this.redisClient.get(key)
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.redisClient.set(key, value, 'EX', ttlSeconds)
    } else {
      await this.redisClient.set(key, value)
    }
  }

  async setIfAbsent(
    key: string,
    value: string,
    ttlMs: number
  ): Promise<boolean> {
    const result = await this.redisClient.set(key, value, 'PX', ttlMs, 'NX')
    return result === 'OK'
  }

  async del(key: string): Promise<void> {
    await this.redisClient.del(key)
  }
}
