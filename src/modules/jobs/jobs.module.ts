import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { PropertiesModule } from '../properties/properties.module'
import { RentalModule } from '../rental/rental.module'
import { BaseJob } from './base-job'
import { JobsController } from './controllers/jobs.controller'
import {
  ApartmentExpireOverdueListingsJob,
  ApartmentRemindExpiringListingsJob,
} from './jobs/apartment-expiration.job'
import {
  MoveInHandoverDeadlineJob,
  MoveInSettlementOverdueJob,
} from './jobs/move-in-settlement.job'
import {
  RentalOpsApplyDueAmendmentsJob,
  RentalOpsExpireAttemptsJob,
  RentalOpsExpireDepositAgreementsJob,
  RentalOpsMarkSettlementsOverdueJob,
  RentalOpsProcessPaymentRemindersJob,
  RentalOpsRetryStuckEscrowSettlementsJob,
} from './jobs/rental-ops.job'
import { SystemConfig } from '../properties/schemas/system-config.schema'
import { ActivityLog } from '../activity-log/schemas/activity-log.schema'
import { JOBS, JobManagerService } from './services/job-manager.service'

const JOB_CLASSES = [
  ApartmentExpireOverdueListingsJob,
  ApartmentRemindExpiringListingsJob,
  MoveInSettlementOverdueJob,
  MoveInHandoverDeadlineJob,
  RentalOpsExpireAttemptsJob,
  RentalOpsExpireDepositAgreementsJob,
  RentalOpsProcessPaymentRemindersJob,
  RentalOpsMarkSettlementsOverdueJob,
  RentalOpsApplyDueAmendmentsJob,
  RentalOpsRetryStuckEscrowSettlementsJob,
]

/**
 * Vận hành: gom mọi tác vụ theo lịch. Chỉ import một chiều các module domain
 * để lấy service; không module domain nào import JobsModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SystemConfig, ActivityLog]),
    PropertiesModule,
    RentalModule,
  ],
  controllers: [JobsController],
  providers: [
    ...JOB_CLASSES,
    {
      provide: JOBS,
      useFactory: (...jobs: BaseJob[]): BaseJob[] => jobs,
      inject: JOB_CLASSES,
    },
    JobManagerService,
  ],
  exports: [JobManagerService],
})
export class JobsModule {}
