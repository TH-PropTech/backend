import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ApartmentsModule } from '../apartments/apartments.module'
import { RecommendationsController } from './recommendations.controller'
import { RecommendationsService } from './recommendations.service'
import { NaiveBayesEngine } from './engine/naive-bayes.engine'
import { RecommendationHistory } from './schemas/recommendation-history.schema'
import { RecommendationConfig } from './entities/recommendation-config.entity'
import { RecommendationConfigService } from './recommendation-config.service'

@Module({
  imports: [
    TypeOrmModule.forFeature([RecommendationHistory, RecommendationConfig]),
    ApartmentsModule,
  ],
  controllers: [RecommendationsController],
  providers: [
    RecommendationsService,
    NaiveBayesEngine,
    RecommendationConfigService,
  ],
  exports: [
    RecommendationsService,
    NaiveBayesEngine,
    RecommendationConfigService,
  ],
})
export class RecommendationsModule {}
