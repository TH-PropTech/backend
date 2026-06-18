import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Booking } from './schemas/booking.schema'
import { Apartment } from '../apartments/schemas/apartment.schema'
import { User } from '../users/schemas/user.schema'
import { BookingsService } from './bookings.service'
import { BookingsController } from './bookings.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Booking, Apartment, User])],
  providers: [BookingsService],
  controllers: [BookingsController],
  exports: [TypeOrmModule, BookingsService],
})
export class BookingsModule {}
