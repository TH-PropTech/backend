import { Global, Module } from '@nestjs/common'
import { HealthController } from './controllers/health.controller'
import { HealthService } from './services/health.service'
import { ReadCacheService } from './services/read-cache.service'
import { RedisService } from './services/redis.service'

// @Global giữ nguyên cơ chế của RedisModule cũ: RedisService dùng được ở mọi module.
@Global()
@Module({
  controllers: [HealthController],
  providers: [HealthService, RedisService, ReadCacheService],
  exports: [RedisService, ReadCacheService],
})
export class HealthModule {}
