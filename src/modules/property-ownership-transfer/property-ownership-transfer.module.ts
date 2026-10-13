import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Apartment } from '../properties/schemas/apartment.schema'
import { Booking } from '../bookings/schemas/booking.schema'
import { Contract } from '../contracts/schemas/contract.schema'
import { DepositAgreement } from '../contracts/schemas/deposit-agreement.schema'
import { Dispute } from '../community/schemas/dispute.schema'
import { Payment } from '../payments/schemas/payment.schema'
import { RentalApplication } from '../rental/schemas/rental-application.schema'
import { User } from '../users/schemas/user.schema'
import { OwnershipTransferController } from './controllers/ownership-transfer.controller'
import { MongoOwnershipTransferStore } from './services/mongo-ownership-transfer.store'
import { OwnershipTransferService } from './services/ownership-transfer.service'
import { OwnershipTransferResolver } from './services/ownership-transfer.resolver'
import { OWNERSHIP_TRANSFER_STORE } from './services/ownership-transfer.store'
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
