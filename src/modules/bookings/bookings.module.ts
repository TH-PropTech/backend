import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Booking } from './schemas/booking.schema'

@Module({
  imports: [TypeOrmModule.forFeature([Booking])],
  exports: [TypeOrmModule],
})
export class BookingsModule {}
