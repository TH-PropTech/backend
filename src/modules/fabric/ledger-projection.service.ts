import { Injectable, Logger, Optional } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { Contract } from '../contracts/schemas/contract.schema'
import { ContractAmendment } from '../contracts/schemas/contract-amendment.schema'
import { DepositAgreement } from '../contracts/schemas/deposit-agreement.schema'
import { Payment } from '../payments/schemas/payment.schema'
import { LedgerOutbox } from './schemas/ledger-outbox.schema'

export interface ProjectionResultInput {
  txHash: string
  blockNumber?: number | null
  networkMode?: 'simulation' | 'fabric'
  confirmedAt?: Date
}

export interface ProjectionFailureEvent {
  aggregateType: string
  aggregateId: string
  _id?: ObjectId
}

@Injectable()
export class LedgerProjectionService {
  private readonly logger = new Logger(LedgerProjectionService.name)

  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @InjectRepository(DepositAgreement)
    private readonly depositAgreementRepository: Repository<DepositAgreement>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @Optional()
    @InjectRepository(ContractAmendment)
    private readonly amendmentRepository?: Repository<ContractAmendment>
  ) {}

  async projectResult(
    event: LedgerOutbox,
    result: ProjectionResultInput
  ): Promise<void> {
    const recordedAt = result.confirmedAt ?? new Date()
    const networkMode = result.networkMode ?? 'fabric'

    if (!ObjectId.isValid(event.aggregateId)) {
      this.logger.warn(
        `Invalid aggregateId [${event.aggregateId}] for projection event [${event._id?.toString()}]`
      )
      return
    }

    const objId = new ObjectId(event.aggregateId)

    try {
      switch (event.aggregateType) {
        case 'contract': {
          const contract = await this.contractRepository.findOne({
            where: { _id: objId },
          })
          if (contract) {
            contract.blockchainAddress = result.txHash
            contract.ledgerStatus = 'confirmed'
            contract.ledgerNetworkMode = networkMode
            contract.ledgerRecordedAt = recordedAt
            await this.contractRepository.save(contract)
            this.logger.log(
              `Projected Fabric confirmation to Contract [${event.aggregateId}], tx: ${result.txHash}`
            )
          }
          break
        }
        case 'deposit': {
          const deposit = await this.depositAgreementRepository.findOne({
            where: { _id: objId },
          })
          if (deposit) {
            deposit.depositLedgerTxId = result.txHash
            deposit.ledgerStatus = 'confirmed'
            deposit.ledgerRecordedAt = recordedAt
            await this.depositAgreementRepository.save(deposit)
            this.logger.log(
              `Projected Fabric confirmation to DepositAgreement [${event.aggregateId}], tx: ${result.txHash}`
            )
          }
          break
        }
        case 'payment': {
          const payment = await this.paymentRepository.findOne({
            where: { _id: objId },
          })
          if (payment) {
            payment.txHash = result.txHash
            payment.ledgerStatus = 'confirmed'
            payment.ledgerNetworkMode = networkMode
            payment.ledgerRecordedAt = recordedAt
            await this.paymentRepository.save(payment)
            this.logger.log(
              `Projected Fabric confirmation to Payment [${event.aggregateId}], tx: ${result.txHash}`
            )
          }
          break
        }
        case 'contract-amendment': {
          if (!this.amendmentRepository) break
          const amendment = await this.amendmentRepository.findOne({
            where: { _id: objId },
          })
          if (amendment) {
            amendment.ledgerStatus = 'confirmed'
            amendment.ledgerTxHash = result.txHash
            await this.amendmentRepository.save(amendment)
            this.logger.log(
              `Projected Fabric confirmation to ContractAmendment [${event.aggregateId}], tx: ${result.txHash}`
            )
          }
          break
        }
        default:
          this.logger.debug(
            `No projection handler for aggregateType [${event.aggregateType}]`
          )
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      this.logger.error(
        `Failed to project ledger confirmation for aggregate [${event.aggregateId}]: ${errMsg}`
      )
      throw error
    }
  }

  async projectFailure(event: ProjectionFailureEvent): Promise<void> {
    if (!ObjectId.isValid(event.aggregateId)) {
      this.logger.warn(
        `Invalid aggregateId [${event.aggregateId}] for failure projection event [${event._id?.toString()}]`
      )
      return
    }

    const objId = new ObjectId(event.aggregateId)

    try {
      switch (event.aggregateType) {
        case 'contract': {
          const contract = await this.contractRepository.findOne({
            where: { _id: objId },
          })
          if (contract) {
            contract.ledgerStatus = 'failed'
            await this.contractRepository.save(contract)
          }
          break
        }
        case 'deposit': {
          const deposit = await this.depositAgreementRepository.findOne({
            where: { _id: objId },
          })
          if (deposit) {
            deposit.ledgerStatus = 'failed'
            await this.depositAgreementRepository.save(deposit)
          }
          break
        }
        case 'payment': {
          const payment = await this.paymentRepository.findOne({
            where: { _id: objId },
          })
          if (payment) {
            payment.ledgerStatus = 'failed'
            await this.paymentRepository.save(payment)
          }
          break
        }
        case 'contract-amendment': {
          if (!this.amendmentRepository) break
          const amendment = await this.amendmentRepository.findOne({
            where: { _id: objId },
          })
          if (amendment) {
            amendment.ledgerStatus = 'failed'
            await this.amendmentRepository.save(amendment)
          }
          break
        }
        default:
          this.logger.debug(
            `No failure projection handler for aggregateType [${event.aggregateType}]`
          )
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      this.logger.error(
        `Failed to project terminal ledger failure for aggregate [${event.aggregateId}]: ${errMsg}`
      )
      throw error
    }
  }
}
