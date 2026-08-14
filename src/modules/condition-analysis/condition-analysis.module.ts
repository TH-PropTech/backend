import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ApartmentsModule } from '../apartments/apartments.module'
import { ConditionAnalysisController } from './condition-analysis.controller'
import { ConditionAnalysisService } from './condition-analysis.service'
import { GroqVisionService } from './groq-vision.service'
import { ConditionAnalysis } from './schemas/condition-analysis.schema'

@Module({
  imports: [TypeOrmModule.forFeature([ConditionAnalysis]), ApartmentsModule],
  controllers: [ConditionAnalysisController],
  providers: [ConditionAnalysisService, GroqVisionService],
  exports: [TypeOrmModule, ConditionAnalysisService],
})
export class ConditionAnalysisModule {}
