import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Apartment } from '../apartments/schemas/apartment.schema'
import { ListingFreshnessController } from './listing-freshness.controller'
import { ListingFreshnessService } from './listing-freshness.service'
import { ListingReviewCase } from './schemas/listing-review-case.schema'

@Module({
  imports: [TypeOrmModule.forFeature([Apartment, ListingReviewCase])],
  controllers: [ListingFreshnessController],
  providers: [ListingFreshnessService],
  exports: [ListingFreshnessService],
})
export class ListingFreshnessModule {}
