import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { PropertiesModule } from '../properties/properties.module'
import { RecommendationsController } from './controllers/recommendations.controller'
import { RecommendationsService } from './services/recommendations.service'
import { NaiveBayesEngine } from './engine/naive-bayes.engine'
import { RecommendationHistory } from './schemas/recommendation-history.schema'
import { RecommendationConfig } from './entities/recommendation-config.entity'
import { RecommendationConfigService } from './services/recommendation-config.service'

@Module({
  imports: [
    TypeOrmModule.forFeature([RecommendationHistory, RecommendationConfig]),
    PropertiesModule,
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
