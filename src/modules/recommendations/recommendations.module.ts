import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ApartmentsModule } from '../apartments/apartments.module'
import { RecommendationsController } from './recommendations.controller'
import { RecommendationsService } from './recommendations.service'
import { NaiveBayesEngine } from './engine/naive-bayes.engine'
import { RecommendationHistory } from './schemas/recommendation-history.schema'

@Module({
  imports: [
    TypeOrmModule.forFeature([RecommendationHistory]),
    ApartmentsModule,
  ],
  controllers: [RecommendationsController],
  providers: [RecommendationsService, NaiveBayesEngine],
  exports: [RecommendationsService, NaiveBayesEngine],
})
export class RecommendationsModule {}
