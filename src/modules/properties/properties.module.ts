import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Apartment } from './schemas/apartment.schema'
import { Building } from './schemas/building.schema'
import { Project } from './schemas/project.schema'
import { ListingReviewCase } from './schemas/listing-review-case.schema'
import { MaintenanceTicket } from './schemas/maintenance-ticket.schema'
import { Review } from './schemas/review.schema'
import { SavedSearch } from './schemas/saved-search.schema'
import { SearchAlert } from './schemas/search-alert.schema'
import { User } from '../users/schemas/user.schema'
import { ApartmentsService } from './services/apartments.service'
import { ListingQualityService } from './services/listing-quality.service'
import { ApartmentMediaUploadService } from './services/apartment-media-upload.service'
import { ApartmentExpirationService } from './services/apartment-expiration.service'
import { BuildingsService } from './services/buildings.service'
import { ProjectsService } from './services/projects.service'
import { ListingFreshnessService } from './services/listing-freshness.service'
import { SavedSearchesService } from './services/saved-searches.service'
import { ApartmentsController } from './controllers/apartments.controller'
import { BuildingsController } from './controllers/buildings.controller'
import { ProjectsController } from './controllers/projects.controller'
import { SavedSearchesController } from './controllers/saved-searches.controller'
import { NotificationsModule } from '../notifications/notifications.module'
import { RentalFlowConfigModule } from '../rental-flow-config/rental-flow-config.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Apartment,
      User,
      Building,
      Project,
      ListingReviewCase,
      MaintenanceTicket,
      Review,
      SavedSearch,
      SearchAlert,
    ]),
    NotificationsModule,
    RentalFlowConfigModule,
  ],
  providers: [
    ApartmentsService,
    ListingQualityService,
    ApartmentMediaUploadService,
    ApartmentExpirationService,
    BuildingsService,
    ProjectsService,
    ListingFreshnessService,
    SavedSearchesService,
  ],
  controllers: [
    ApartmentsController,
    BuildingsController,
    ProjectsController,
    SavedSearchesController,
  ],
  exports: [
    TypeOrmModule,
    ApartmentsService,
    ApartmentExpirationService,
    BuildingsService,
    ProjectsService,
    ListingFreshnessService,
    SavedSearchesService,
  ],
})
export class PropertiesModule {}
