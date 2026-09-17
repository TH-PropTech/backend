import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { Contract } from '../contracts/schemas/contract.schema'
import { DepositAgreement } from '../contracts/schemas/deposit-agreement.schema'
import { Payment } from '../payments/schemas/payment.schema'
import { LedgerOutbox } from './schemas/ledger-outbox.schema'

export interface ProjectionResultInput {
  txHash: string
  blockNumber?: number | null
  networkMode?: 'simulation' | 'fabric'
  confirmedAt?: Date
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
    private readonly paymentRepository: Repository<Payment>
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
}
