import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Apartment } from './schemas/apartment.schema'
import { Building } from './schemas/building.schema'
import { Project } from './schemas/project.schema'
import { ReviewCase } from './schemas/review-case.schema'
import { SavedSearchRecord } from './schemas/saved-search-record.schema'
import { DesignRequest } from './schemas/design-request.schema'
import { DesignRequestsService } from './services/design-requests.service'
import { DesignRequestsController } from './controllers/design-requests.controller'
import { ActivityLog } from '../activity-log/schemas/activity-log.schema'
import { SystemConfig } from './schemas/system-config.schema'
import { User } from '../users/schemas/user.schema'
import { ApartmentsService } from './services/apartments.service'
import { ApartmentDesignsService } from './services/apartment-designs.service'
import { ApartmentDesignsController } from './controllers/apartment-designs.controller'
import { MaintenanceTicketsService } from './services/maintenance-tickets.service'
import { ListingQualityService } from './services/listing-quality.service'
import { ApartmentMediaUploadService } from './services/apartment-media-upload.service'
import { ApartmentExpirationService } from './services/apartment-expiration.service'
import { BuildingsService } from './services/buildings.service'
import { ProjectsService } from './services/projects.service'
import { ListingFreshnessService } from './services/listing-freshness.service'
import { SavedSearchesService } from './services/saved-searches.service'
import { PriceBenchmarkService } from './insights/services/price-benchmark.service'
import { SafetyReportsService } from './insights/services/safety-reports.service'
import { RecommendationsService } from './recommendations/services/recommendations.service'
import { RecommendationConfigService } from './recommendations/services/recommendation-config.service'
import { NaiveBayesEngine } from './recommendations/engine/naive-bayes.engine'
import { ApartmentsController } from './controllers/apartments.controller'
import { BuildingsController } from './controllers/buildings.controller'
import { ProjectsController } from './controllers/projects.controller'
import { SavedSearchesController } from './controllers/saved-searches.controller'
import { PriceBenchmarkController } from './insights/controllers/price-benchmark.controller'
import { SafetyReportsController } from './insights/controllers/safety-reports.controller'
import { RecommendationsController } from './recommendations/controllers/recommendations.controller'
import { NotificationsModule } from '../notifications/notifications.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Apartment,
      User,
      Building,
      Project,
      ReviewCase,
      SavedSearchRecord,
      DesignRequest,
      ActivityLog,
      SystemConfig,
    ]),
    NotificationsModule,
  ],
  providers: [
    ApartmentsService,
    ListingQualityService,
    MaintenanceTicketsService,
    ApartmentDesignsService,
    DesignRequestsService,
    ApartmentMediaUploadService,
    ApartmentExpirationService,
    BuildingsService,
    ProjectsService,
    ListingFreshnessService,
    SavedSearchesService,
    PriceBenchmarkService,
    SafetyReportsService,
    RecommendationsService,
    NaiveBayesEngine,
    RecommendationConfigService,
  ],
  controllers: [
    ApartmentsController,
    ApartmentDesignsController,
    DesignRequestsController,
    BuildingsController,
    ProjectsController,
    SavedSearchesController,
    PriceBenchmarkController,
    SafetyReportsController,
    RecommendationsController,
  ],
  exports: [
    TypeOrmModule,
    ApartmentsService,
    ApartmentDesignsService,
    ApartmentExpirationService,
    BuildingsService,
    ProjectsService,
    ListingFreshnessService,
    SavedSearchesService,
    PriceBenchmarkService,
    SafetyReportsService,
    RecommendationsService,
    NaiveBayesEngine,
    RecommendationConfigService,
  ],
})
export class PropertiesModule {}
