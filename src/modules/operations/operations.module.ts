import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Booking } from '../bookings/schemas/booking.schema'
import { KycRecord } from '../kyc/schemas/kyc-record.schema'
import { Apartment } from '../apartments/schemas/apartment.schema'
import { SupportTicket } from '../support-tickets/schemas/support-ticket.schema'
import { OperationsService } from './operations.service'
import { OperationsController } from './operations.controller'

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, KycRecord, Apartment, SupportTicket]),
  ],
  providers: [OperationsService],
  controllers: [OperationsController],
})
export class OperationsModule {}
