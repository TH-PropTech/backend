import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { configuration } from './config/configuration'
import { envValidationSchema } from './config/env.validation'
import { LoggerModule } from './common/logger/logger.module'
import { ThrottlerModule } from '@nestjs/throttler'

import { HealthModule } from './modules/health/health.module'
import { UsersModule } from './modules/users/users.module'
import { KycModule } from './modules/kyc/kyc.module'
import { ProjectsModule } from './modules/projects/projects.module'
import { BuildingsModule } from './modules/buildings/buildings.module'
import { ApartmentsModule } from './modules/apartments/apartments.module'
import { BookingsModule } from './modules/bookings/bookings.module'
import { ContractsModule } from './modules/contracts/contracts.module'
import { PaymentsModule } from './modules/payments/payments.module'
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
import { AiConsultationModule } from './modules/ai-consultation/ai-consultation.module'
import { RedisModule } from './modules/redis/redis.module'

@Module({
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
    AiConsultationModule,
    RedisModule,
  ],
})
export class AppModule {}
