import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { PlatformFeeAudit } from './schemas/platform-fee-audit.schema'
import { PlatformFeeSchedule } from './schemas/platform-fee-schedule.schema'
import { PlatformFeesController } from './controllers/platform-fees.controller'
import { PlatformFeesService } from './services/platform-fees.service'
import { Payment } from '../payments/schemas/payment.schema'

@Module({
  imports: [
    TypeOrmModule.forFeature([PlatformFeeSchedule, PlatformFeeAudit, Payment]),
  ],
  controllers: [PlatformFeesController],
  providers: [PlatformFeesService],
  exports: [PlatformFeesService],
})
export class PlatformFeesModule {}
