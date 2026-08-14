import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Apartment } from '../apartments/schemas/apartment.schema'
import { PriceBenchmarkController } from './price-benchmark.controller'
import { PriceBenchmarkService } from './price-benchmark.service'

@Module({
  imports: [TypeOrmModule.forFeature([Apartment])],
  controllers: [PriceBenchmarkController],
  providers: [PriceBenchmarkService],
  exports: [PriceBenchmarkService],
})
export class PriceBenchmarkModule {}
