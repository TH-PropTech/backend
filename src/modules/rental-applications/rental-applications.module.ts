import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ApartmentsModule } from '../apartments/apartments.module'
import { ContractsModule } from '../contracts/contracts.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { LegalTermsModule } from '../legal-terms/legal-terms.module'
import { RentalFlowConfigModule } from '../rental-flow-config/rental-flow-config.module'
import { RentalApplicationsController } from './rental-applications.controller'
import { RentalApplicationsService } from './rental-applications.service'
import { RentalApplication } from './schemas/rental-application.schema'

@Module({
  imports: [
    TypeOrmModule.forFeature([RentalApplication]),
    ApartmentsModule,
    ContractsModule,
    NotificationsModule,
    LegalTermsModule,
    RentalFlowConfigModule,
  ],
  controllers: [RentalApplicationsController],
  providers: [RentalApplicationsService],
  exports: [RentalApplicationsService],
})
export class RentalApplicationsModule {}
