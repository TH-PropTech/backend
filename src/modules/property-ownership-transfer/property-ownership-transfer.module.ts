import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Apartment } from '../apartments/schemas/apartment.schema'
import { Booking } from '../bookings/schemas/booking.schema'
import { Contract } from '../contracts/schemas/contract.schema'
import { DepositAgreement } from '../contracts/schemas/deposit-agreement.schema'
import { Dispute } from '../disputes/schemas/dispute.schema'
import { Payment } from '../payments/schemas/payment.schema'
import { RentalApplication } from '../rental-applications/schemas/rental-application.schema'
import { User } from '../users/schemas/user.schema'
import { OwnershipTransferController } from './ownership-transfer.controller'
import { MongoOwnershipTransferStore } from './mongo-ownership-transfer.store'
import { OwnershipTransferService } from './ownership-transfer.service'
import { OwnershipTransferResolver } from './ownership-transfer.resolver'
import { OWNERSHIP_TRANSFER_STORE } from './ownership-transfer.store'
import { PropertyOwnershipTransfer } from './schemas/property-ownership-transfer.schema'
import { PropertyOwnershipTransferRecord } from './schemas/property-ownership-transfer-record.schema'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Apartment,
      Booking,
      RentalApplication,
      Contract,
      DepositAgreement,
      Payment,
      Dispute,
      PropertyOwnershipTransfer,
      PropertyOwnershipTransferRecord,
    ]),
  ],
  controllers: [OwnershipTransferController],
  providers: [
    OwnershipTransferService,
    OwnershipTransferResolver,
    MongoOwnershipTransferStore,
    {
      provide: OWNERSHIP_TRANSFER_STORE,
      useExisting: MongoOwnershipTransferStore,
    },
  ],
  exports: [OwnershipTransferService, OwnershipTransferResolver],
})
export class PropertyOwnershipTransferModule {}
