import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private redisClient!: Redis

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const redisUrl =
      this.configService.get<string>('redis.url') || 'redis://localhost:6379'
    this.redisClient = new Redis(redisUrl)
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

  async del(key: string): Promise<void> {
    await this.redisClient.del(key)
  }
}
