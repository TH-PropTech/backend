import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { configuration } from './config/configuration'
import { envValidationSchema } from './config/env.validation'
import { LoggerModule } from './common/logger/logger.module'
import { ThrottlerModule } from '@nestjs/throttler'
import { ScheduleModule } from '@nestjs/schedule'

import { HealthModule } from './modules/health/health.module'
import { UsersModule } from './modules/users/users.module'
import { KycModule } from './modules/kyc/kyc.module'
import { ProjectsModule } from './modules/projects/projects.module'
import { BuildingsModule } from './modules/buildings/buildings.module'
import { ApartmentsModule } from './modules/apartments/apartments.module'
import { BookingsModule } from './modules/bookings/bookings.module'
import { ContractsModule } from './modules/contracts/contracts.module'
import { PaymentsModule } from './modules/payments/payments.module'
import { MockBankModule } from './modules/mock-bank/mock-bank.module'
import { MaintenanceModule } from './modules/maintenance/maintenance.module'
import { CommunityModule } from './modules/community/community.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { AiChatsModule } from './modules/ai-chats/ai-chats.module'
import { DisputesModule } from './modules/disputes/disputes.module'
import { ReviewsModule } from './modules/reviews/reviews.module'
import { AuthModule } from './modules/auth/auth.module'
import { SmartOtpModule } from './modules/smart-otp/smart-otp.module'
import { TwoFactorModule } from './modules/two-factor/two-factor.module'
import { FabricModule } from './modules/fabric/fabric.module'
import { PoliciesModule } from './modules/policies/policies.module'
import { LegalTermsModule } from './modules/legal-terms/legal-terms.module'
import { AiConsultationModule } from './modules/ai-consultation/ai-consultation.module'
import { RedisModule } from './modules/redis/redis.module'
import { RecommendationsModule } from './modules/recommendations/recommendations.module'
import { SafetyReportsModule } from './modules/safety-reports/safety-reports.module'
import { SavedSearchesModule } from './modules/saved-searches/saved-searches.module'
import { LivingCostModule } from './modules/living-cost/living-cost.module'
import { SupportTicketsModule } from './modules/support-tickets/support-tickets.module'
import { ListingFreshnessModule } from './modules/listing-freshness/listing-freshness.module'
import { PriceBenchmarkModule } from './modules/price-benchmark/price-benchmark.module'
import { ViewingNotesModule } from './modules/viewing-notes/viewing-notes.module'
import { AreaProfilesModule } from './modules/area-profiles/area-profiles.module'
import { RentalApplicationsModule } from './modules/rental-applications/rental-applications.module'
import { ConditionAnalysisModule } from './modules/condition-analysis/condition-analysis.module'
import { LocationRiskModule } from './modules/location-risk/location-risk.module'
import { OperationsModule } from './modules/operations/operations.module'
import { RentalFlowConfigModule } from './modules/rental-flow-config/rental-flow-config.module'
import { PropertyOwnershipTransferModule } from './modules/property-ownership-transfer/property-ownership-transfer.module'

@Module({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mongodb',
        url: configService.getOrThrow<string>('database.url'),
        logging: configService.getOrThrow<boolean>('database.logging'),
        synchronize: configService.getOrThrow<boolean>('database.synchronize'),
        autoLoadEntities: true,
      }),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    ScheduleModule.forRoot(),
    LoggerModule,
    HealthModule,
    UsersModule,
    KycModule,
    ProjectsModule,
    BuildingsModule,
    ApartmentsModule,
    BookingsModule,
    ContractsModule,
    PaymentsModule,
    MockBankModule,
    MaintenanceModule,
    CommunityModule,
    NotificationsModule,
    AiChatsModule,
    DisputesModule,
    ReviewsModule,
    AuthModule,
    SmartOtpModule,
    TwoFactorModule,
    FabricModule,
    PoliciesModule,
    LegalTermsModule,
    AiConsultationModule,
    RedisModule,
    RecommendationsModule,
    SafetyReportsModule,
    SavedSearchesModule,
    LivingCostModule,
    SupportTicketsModule,
    ListingFreshnessModule,
    PriceBenchmarkModule,
    ViewingNotesModule,
    AreaProfilesModule,
    RentalApplicationsModule,
    ConditionAnalysisModule,
    LocationRiskModule,
    OperationsModule,
    RentalFlowConfigModule,
    PropertyOwnershipTransferModule,
  ],
})
export class AppModule {}
