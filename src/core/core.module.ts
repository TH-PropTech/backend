import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { configuration } from './config/configuration'
import { envValidationSchema } from './config/env.validation'
import { DatabaseModule } from './database/database.module'
import { LoggerModule } from './logger/logger.module'

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
    DatabaseModule,
    LoggerModule,
  ],
})
export class CoreModule {}
