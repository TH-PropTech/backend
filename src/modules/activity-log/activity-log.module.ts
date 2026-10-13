import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ActivityLog } from './schemas/activity-log.schema'
import { ActivityLogService } from './services/activity-log.service'

/**
 * Cắt ngang: lưu nhật ký thao tác. Interceptor `common/interceptors/activity-log.interceptor.ts` được đăng ký global (APP_INTERCEPTOR) trong AppModule.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ActivityLog])],
  providers: [ActivityLogService],
  exports: [ActivityLogService],
})
export class ActivityLogModule {}
