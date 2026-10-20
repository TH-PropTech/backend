import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Apartment } from '../properties/schemas/apartment.schema'
import { Booking } from '../bookings/schemas/booking.schema'
import { AiModule } from '../ai/ai.module'
import { UsersModule } from '../users/users.module'
import { LegalDocument } from '../legal/schemas/legal-document.schema'
import { PropertiesModule } from '../properties/properties.module'
import { SupportTicket } from '../community/schemas/support-ticket.schema'
import { SystemConfig } from '../properties/schemas/system-config.schema'
import { GroqKeysController } from './controllers/groq-keys.controller'
import { ListingFreshnessController } from './controllers/listing-freshness.controller'
import { NavConfigController } from './controllers/nav-config.controller'
import { OperationsController } from './controllers/operations.controller'
import { PlatformRegulationsController } from './controllers/platform-regulations.controller'
import { RentalFlowAssignmentsController } from './controllers/rental-flow-assignments.controller'
import { RentalFlowProfilesController } from './controllers/rental-flow-profiles.controller'
import { NavConfigService } from './services/nav-config.service'
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
      Apartment,
      SupportTicket,
      // PlatformRegulationsService (G-LEG: legal_documents, kind regulation/source)
      LegalDocument,
      // NavConfigService (SystemConfig scope 'admin-nav')
      SystemConfig,
    ]),
    PropertiesModule,
    AiModule,
    // OperationsService: KYC nhúng trong users.kyc (G-KYC), đếm qua KycService
    UsersModule,
  ],
  controllers: [
    PlatformRegulationsController,
    RentalFlowProfilesController,
    RentalFlowAssignmentsController,
    GroqKeysController,
    OperationsController,
    ListingFreshnessController,
    NavConfigController,
  ],
  providers: [OperationsService, PlatformRegulationsService, NavConfigService],
})
export class AdminModule {}
