import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AreaProfile } from './schemas/area-profile.schema'
import { LivingCostProfile } from './schemas/living-cost-profile.schema'
import { RiskLayerData } from './schemas/risk-layer-data.schema'
import { SafetyReport } from './schemas/safety-report.schema'
import { ConditionAnalysis } from './schemas/condition-analysis.schema'
import { Apartment } from '../properties/schemas/apartment.schema'
import { AreaProfilesService } from './services/area-profiles.service'
import { LivingCostService } from './services/living-cost.service'
import { LocationRiskService } from './services/location-risk.service'
import { PriceBenchmarkService } from './services/price-benchmark.service'
import { SafetyReportsService } from './services/safety-reports.service'
import { ConditionAnalysisService } from './services/condition-analysis.service'
import { GroqVisionService } from './services/groq-vision.service'
import { AreaProfilesController } from './controllers/area-profiles.controller'
import { LivingCostController } from './controllers/living-cost.controller'
import { LocationRiskController } from './controllers/location-risk.controller'
import { PriceBenchmarkController } from './controllers/price-benchmark.controller'
import { SafetyReportsController } from './controllers/safety-reports.controller'
import { ConditionAnalysisController } from './controllers/condition-analysis.controller'
import { NotificationsModule } from '../notifications/notifications.module'
import { PropertiesModule } from '../properties/properties.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AreaProfile,
      LivingCostProfile,
      RiskLayerData,
      SafetyReport,
      ConditionAnalysis,
      Apartment,
    ]),
    NotificationsModule,
    PropertiesModule,
  ],
  controllers: [
    AreaProfilesController,
    LivingCostController,
    LocationRiskController,
    PriceBenchmarkController,
    SafetyReportsController,
    ConditionAnalysisController,
  ],
  providers: [
    AreaProfilesService,
    LivingCostService,
    LocationRiskService,
    PriceBenchmarkService,
    SafetyReportsService,
    ConditionAnalysisService,
    GroqVisionService,
  ],
  exports: [
    TypeOrmModule,
    AreaProfilesService,
    LivingCostService,
    LocationRiskService,
    PriceBenchmarkService,
    SafetyReportsService,
    ConditionAnalysisService,
  ],
})
export class InsightsModule {}
