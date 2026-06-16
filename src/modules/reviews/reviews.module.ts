import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Review } from './schemas/review.schema'

@Module({
  imports: [TypeOrmModule.forFeature([Review])],
  exports: [TypeOrmModule],
})
export class ReviewsModule {}
