import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ApartmentsModule } from '../apartments/apartments.module'
import { RecommendationsController } from './recommendations.controller'
import { RecommendationsService } from './recommendations.service'

@Module({
  imports: [ConfigModule, ApartmentsModule],
  controllers: [RecommendationsController],
  providers: [RecommendationsService],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
