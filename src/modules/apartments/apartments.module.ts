import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Apartment } from './schemas/apartment.schema'
import { User } from '../users/schemas/user.schema'
import { ApartmentsService } from './apartments.service'
import { ApartmentsController } from './apartments.controller'
import { NotificationsModule } from '../notifications/notifications.module'
import { ProjectsModule } from '../projects/projects.module'
import { BuildingsModule } from '../buildings/buildings.module'
import { SavedSearchesModule } from '../saved-searches/saved-searches.module'
import { ListingQualityService } from './listing-quality.service'
import { ApartmentMediaUploadService } from './apartment-media-upload.service'
import { ApartmentExpirationService } from './apartment-expiration.service'
import { RentalFlowConfigModule } from '../rental-flow-config/rental-flow-config.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([Apartment, User]),
    NotificationsModule,
    ProjectsModule,
    BuildingsModule,
    SavedSearchesModule,
    RentalFlowConfigModule,
  ],
  providers: [
    ApartmentsService,
    ListingQualityService,
    ApartmentMediaUploadService,
    ApartmentExpirationService,
  ],
  controllers: [ApartmentsController],
  exports: [TypeOrmModule, ApartmentsService],
})
export class ApartmentsModule {}
