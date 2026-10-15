import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ActivityLog } from './schemas/activity-log.schema'
import { ActivityLogService } from './services/activity-log.service'
import { ConfigAuditService } from './services/config-audit.service'

/**
 * Cắt ngang: lưu nhật ký thao tác. Interceptor `common/interceptors/activity-log.interceptor.ts` được đăng ký global (APP_INTERCEPTOR) trong AppModule.
 * Còn chứa kiểm toán cấu hình (`ConfigAudit`, kind `config-audit` trong `activity_logs`) cho contracts, payments, rental.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ActivityLog])],
  providers: [ActivityLogService, ConfigAuditService],
  exports: [ActivityLogService, ConfigAuditService],
})
export class ActivityLogModule {}
