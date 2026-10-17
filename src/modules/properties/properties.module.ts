import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Apartment } from './schemas/apartment.schema'
import { Building } from './schemas/building.schema'
import { Project } from './schemas/project.schema'
import { ReviewCase } from './schemas/review-case.schema'
import { SavedSearchRecord } from './schemas/saved-search-record.schema'
import { DistrictData } from './insights/schemas/district-data.schema'
import { ApartmentAnalysis } from './insights/schemas/apartment-analysis.schema'
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
import { AreaProfilesService } from './insights/services/area-profiles.service'
import { LivingCostService } from './insights/services/living-cost.service'
import { LocationRiskService } from './insights/services/location-risk.service'
import { PriceBenchmarkService } from './insights/services/price-benchmark.service'
import { SafetyReportsService } from './insights/services/safety-reports.service'
import { ConditionAnalysisService } from './insights/services/condition-analysis.service'
import { GroqVisionService } from './insights/services/groq-vision.service'
import { RecommendationsService } from './recommendations/services/recommendations.service'
import { RecommendationConfigService } from './recommendations/services/recommendation-config.service'
import { NaiveBayesEngine } from './recommendations/engine/naive-bayes.engine'
import { ApartmentsController } from './controllers/apartments.controller'
import { BuildingsController } from './controllers/buildings.controller'
import { ProjectsController } from './controllers/projects.controller'
import { SavedSearchesController } from './controllers/saved-searches.controller'
import { AreaProfilesController } from './insights/controllers/area-profiles.controller'
import { LivingCostController } from './insights/controllers/living-cost.controller'
import { LocationRiskController } from './insights/controllers/location-risk.controller'
import { PriceBenchmarkController } from './insights/controllers/price-benchmark.controller'
import { SafetyReportsController } from './insights/controllers/safety-reports.controller'
import { ConditionAnalysisController } from './insights/controllers/condition-analysis.controller'
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
      DistrictData,
      ApartmentAnalysis,
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
    ApartmentMediaUploadService,
    ApartmentExpirationService,
    BuildingsService,
    ProjectsService,
    ListingFreshnessService,
    SavedSearchesService,
    AreaProfilesService,
    LivingCostService,
    LocationRiskService,
    PriceBenchmarkService,
    SafetyReportsService,
    ConditionAnalysisService,
    GroqVisionService,
    RecommendationsService,
    NaiveBayesEngine,
    RecommendationConfigService,
  ],
  controllers: [
    ApartmentsController,
    ApartmentDesignsController,
    BuildingsController,
    ProjectsController,
    SavedSearchesController,
    AreaProfilesController,
    LivingCostController,
    LocationRiskController,
    PriceBenchmarkController,
    SafetyReportsController,
    ConditionAnalysisController,
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
    AreaProfilesService,
    LivingCostService,
    LocationRiskService,
    PriceBenchmarkService,
    SafetyReportsService,
    ConditionAnalysisService,
    RecommendationsService,
    NaiveBayesEngine,
    RecommendationConfigService,
  ],
})
export class PropertiesModule {}
