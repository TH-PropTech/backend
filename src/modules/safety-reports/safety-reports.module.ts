import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { SafetyReport } from './schemas/safety-report.schema'
import { SafetyReportsService } from './safety-reports.service'
import { SafetyReportsController } from './safety-reports.controller'
import { NotificationsModule } from '../notifications/notifications.module'
import { ApartmentsModule } from '../apartments/apartments.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([SafetyReport]),
    NotificationsModule,
    ApartmentsModule,
  ],
  providers: [SafetyReportsService],
  controllers: [SafetyReportsController],
  exports: [SafetyReportsService],
})
export class SafetyReportsModule {}
