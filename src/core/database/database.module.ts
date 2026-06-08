import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.getOrThrow<string>('database.host'),
        port: configService.getOrThrow<number>('database.port'),
        username: configService.getOrThrow<string>('database.username'),
        password: configService.getOrThrow<string>('database.password'),
        database: configService.getOrThrow<string>('database.name'),
        ssl: configService.getOrThrow<boolean>('database.ssl'),
        logging: configService.getOrThrow<boolean>('database.logging'),
        synchronize: configService.getOrThrow<boolean>('database.synchronize'),
        autoLoadEntities: true,
        migrationsRun: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
