import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ApartmentsModule } from '../apartments/apartments.module'
import { LocationRiskController } from './location-risk.controller'
import { LocationRiskService } from './location-risk.service'
import { RiskLayerData } from './schemas/risk-layer-data.schema'

@Module({
  imports: [TypeOrmModule.forFeature([RiskLayerData]), ApartmentsModule],
  controllers: [LocationRiskController],
  providers: [LocationRiskService],
  exports: [TypeOrmModule, LocationRiskService],
})
export class LocationRiskModule {}
