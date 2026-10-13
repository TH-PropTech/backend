import { Module } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { configuration } from './config/configuration'
import smartCaConfig from './config/smartca.config'
import { envValidationSchema } from './config/env.validation'
import { AppController } from './app.controller'
import { ActivityLogInterceptor } from './common/interceptors/activity-log.interceptor'
import { LoggerModule } from './common/logger/logger.module'
import { ThrottlerModule } from '@nestjs/throttler'
import { HttpThrottlerGuard } from './common/guards/http-throttler.guard'
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard'
import { ScheduleModule } from '@nestjs/schedule'

// Cắt ngang
import { HealthModule } from './modules/health/health.module'
import { AuthModule } from './modules/auth/auth.module'
import { RbacModule } from './modules/rbac/rbac.module'
import { ActivityLogModule } from './modules/activity-log/activity-log.module'
// Domain
import { UsersModule } from './modules/users/users.module'
import { PropertiesModule } from './modules/properties/properties.module'
import { BookingsModule } from './modules/bookings/bookings.module'
import { RentalModule } from './modules/rental/rental.module'
import { RentalFlowConfigModule } from './modules/rental-flow-config/rental-flow-config.module'
import { MoveInSettlementsModule } from './modules/move-in-settlements/move-in-settlements.module'
import { ContractsModule } from './modules/contracts/contracts.module'
import { PropertyOwnershipTransferModule } from './modules/property-ownership-transfer/property-ownership-transfer.module'
import { PaymentsModule } from './modules/payments/payments.module'
import { PlatformFeesModule } from './modules/platform-fees/platform-fees.module'
import { WalletsModule } from './modules/wallets/wallets.module'
import { LegalModule } from './modules/legal/legal.module'
import { InsightsModule } from './modules/insights/insights.module'
import { RecommendationsModule } from './modules/recommendations/recommendations.module'
import { CommunityModule } from './modules/community/community.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
// Adapter
import { FabricModule } from './modules/fabric/fabric.module'
import { DigitalSignatureModule } from './modules/digital-signature/digital-signature.module'
import { EkycModule } from './modules/ekyc/ekyc.module'
import { AiModule } from './modules/ai/ai.module'
import { MockBankModule } from './modules/mock-bank/mock-bank.module'
// Vận hành
import { AdminModule } from './modules/admin/admin.module'
import { JobsModule } from './modules/jobs/jobs.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration, smartCaConfig],
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
    // Rate limiting toàn cục (có thể chỉnh qua RATE_LIMIT_TTL_MS / RATE_LIMIT_MAX)
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          ttl: configService.getOrThrow<number>('security.rateLimitTtl'),
          limit: configService.getOrThrow<number>('security.rateLimitMax'),
        },
      ],
    }),

    ScheduleModule.forRoot(),
    LoggerModule,
    // Cắt ngang
    HealthModule,
    AuthModule,
    RbacModule,
    ActivityLogModule,
    // Domain
    UsersModule,
    PropertiesModule,
    BookingsModule,
    RentalModule,
    RentalFlowConfigModule,
    MoveInSettlementsModule,
    ContractsModule,
    PropertyOwnershipTransferModule,
    PaymentsModule,
    PlatformFeesModule,
    WalletsModule,
    LegalModule,
    InsightsModule,
    RecommendationsModule,
    CommunityModule,
    NotificationsModule,
    // Adapter
    FabricModule,
    DigitalSignatureModule,
    EkycModule,
    AiModule,
    MockBankModule,
    // Vận hành
    AdminModule,
    JobsModule,
  ],
  controllers: [AppController],
  providers: [
    // Rate limiting áp dụng toàn cục cho mọi route HTTP
    { provide: APP_GUARD, useClass: HttpThrottlerGuard },
    // Xác thực JWT toàn cục; route công khai phải đánh @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Ghi nhật ký thao tác ghi dữ liệu của admin/staff vào DB (fire-and-forget)
    {
      provide: APP_INTERCEPTOR,
      useClass: ActivityLogInterceptor,
    },
  ],
})
export class AppModule {}
