import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Apartment } from '../properties/schemas/apartment.schema'
import { Booking } from '../bookings/schemas/booking.schema'
import { AiModule } from '../ai/ai.module'
import { KycRecord } from '../users/schemas/kyc-record.schema'
import { LegalSource } from '../legal/schemas/legal-source.schema'
import { PlatformRegulation } from '../legal/schemas/platform-regulation.schema'
import { PropertiesModule } from '../properties/properties.module'
import { SupportTicket } from '../community/schemas/support-ticket.schema'
import { GroqKeysController } from './controllers/groq-keys.controller'
import { ListingFreshnessController } from './controllers/listing-freshness.controller'
import { OperationsController } from './controllers/operations.controller'
import { PlatformRegulationsController } from './controllers/platform-regulations.controller'
import { RentalFlowAssignmentsController } from './controllers/rental-flow-assignments.controller'
import { RentalFlowProfilesController } from './controllers/rental-flow-profiles.controller'
import { OperationsService } from './services/operations.service'
import { PlatformRegulationsService } from './services/platform-regulations.service'

/**
 * Vận hành: gom các controller admin/staff lẻ (path giữ nguyên). Chỉ import một
 * chiều các module domain để lấy service; không module domain nào import AdminModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      // OperationsService
      Booking,
      KycRecord,
      Apartment,
      SupportTicket,
      // PlatformRegulationsService
      PlatformRegulation,
      LegalSource,
    ]),
    PropertiesModule,
    AiModule,
  ],
  controllers: [
    PlatformRegulationsController,
    RentalFlowProfilesController,
    RentalFlowAssignmentsController,
    GroqKeysController,
    OperationsController,
    ListingFreshnessController,
  ],
  providers: [OperationsService, PlatformRegulationsService],
})
export class AdminModule {}
