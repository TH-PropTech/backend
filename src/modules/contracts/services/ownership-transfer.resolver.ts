import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { Apartment } from '../../properties/schemas/apartment.schema'
import { Contract } from '../../contracts/schemas/contract.schema'
import { DepositAgreement } from '../../contracts/schemas/deposit-agreement.schema'
import { Dispute } from '../../community/schemas/dispute.schema'
import { Payment } from '../../payments/schemas/payment.schema'
import { PropertyOwnershipTransfer } from '../schemas/property-ownership-transfer.schema'
import { PropertyOwnershipTransferRecord } from '../schemas/property-ownership-transfer-record.schema'

export interface ContractAccessDecision {
  canReadWorkspace: boolean
  canSign: boolean
  isOriginalParticipant: boolean
  isSuccessorOwner: boolean
}

@Injectable()
export class OwnershipTransferResolver {
  public constructor(
    @InjectRepository(Apartment)
    private readonly apartmentRepository: Repository<Apartment>,
    @InjectRepository(PropertyOwnershipTransfer)
    private readonly transferRepository: Repository<PropertyOwnershipTransfer>,
    @InjectRepository(PropertyOwnershipTransferRecord)
    private readonly recordRepository: Repository<PropertyOwnershipTransferRecord>
  ) {}

  public async resolveContractAccess(
    actorId: string,
    contract: Pick<Contract, 'propertyId' | 'landlordId' | 'tenantId'>,
    isStaff: boolean
  ): Promise<ContractAccessDecision> {
    const isOriginalParticipant =
      contract.landlordId === actorId || contract.tenantId === actorId
    const isSuccessorOwner =
      !isOriginalParticipant &&
      (await this.isVerifiedSuccessor(actorId, contract.propertyId))

    return {
      canReadWorkspace: isStaff || isOriginalParticipant || isSuccessorOwner,
      canSign: !isStaff && isOriginalParticipant,
      isOriginalParticipant,
      isSuccessorOwner,
    }
  }

  public async canAccessProperty(
    actorId: string,
    propertyId: string,
    originalLandlordId: string
  ): Promise<boolean> {
    if (actorId === originalLandlordId) return true
    return this.isVerifiedSuccessor(actorId, propertyId)
  }

  public async canAccessDeposit(
    actorId: string,
    agreement: Pick<DepositAgreement, 'propertyId' | 'landlordId' | 'tenantId'>,
    isStaff: boolean
  ): Promise<boolean> {
    if (isStaff || agreement.tenantId === actorId) return true
    return this.canAccessProperty(
      actorId,
      agreement.propertyId ?? '',
      agreement.landlordId
    )
  }

  public async canAccessPayment(
    actorId: string,
    payment: Pick<Payment, 'landlordId' | 'tenantId'>,
    contract: Pick<Contract, 'propertyId' | 'landlordId'>,
    isStaff: boolean
  ): Promise<boolean> {
    if (
      isStaff ||
      payment.tenantId === actorId ||
      payment.landlordId === actorId
    ) {
      return true
    }
    return this.canAccessProperty(
      actorId,
      contract.propertyId,
      contract.landlordId
    )
  }

  public async canAccessDispute(
    actorId: string,
    dispute: Pick<Dispute, 'landlordId' | 'tenantId'>,
    contract: Pick<Contract, 'propertyId' | 'landlordId'>,
    isStaff: boolean
  ): Promise<boolean> {
    if (
      isStaff ||
      dispute.tenantId === actorId ||
      dispute.landlordId === actorId
    ) {
      return true
    }
    return this.canAccessProperty(
      actorId,
      contract.propertyId,
      contract.landlordId
    )
  }

  private async isVerifiedSuccessor(
    actorId: string,
    propertyId: string
  ): Promise<boolean> {
    if (!ObjectId.isValid(propertyId)) return false
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(propertyId) },
    })
    if (!apartment || apartment.landlordId !== actorId) return false

    const completedTransfers = await this.transferRepository.find({
      where: { targetLandlordId: actorId, status: 'completed' },
    })
    for (const transfer of completedTransfers) {
      const transferId = transfer._id.toString()
      const record = await this.recordRepository.findOne({
        where: {
          transferId,
          entityType: 'apartment',
          entityId: propertyId,
        },
      })
      if (record) return true
    }
    return false
  }
}
