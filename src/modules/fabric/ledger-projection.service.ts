import { Injectable, Logger, Optional } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { Contract } from '../contracts/schemas/contract.schema'
import { ContractAmendment } from '../contracts/schemas/contract-amendment.schema'
import { DepositAgreement } from '../contracts/schemas/deposit-agreement.schema'
import { Payment } from '../payments/schemas/payment.schema'
import { LedgerOutbox } from './schemas/ledger-outbox.schema'
import { FabricGovernanceSnapshot } from './schemas/fabric-governance-snapshot.schema'
import {
  MoveInSettlement,
  type LedgerEvidenceRef,
} from '../move-in-settlements/schemas/move-in-settlement.schema'

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
    private readonly amendmentRepository?: Repository<ContractAmendment>,
    @Optional()
    @InjectRepository(FabricGovernanceSnapshot)
    private readonly governanceRepository?: Repository<FabricGovernanceSnapshot>,
    @Optional()
    @InjectRepository(MoveInSettlement)
    private readonly settlementRepository?: Repository<MoveInSettlement>
  ) {}

  /**
   * PROP-399: tx/block chỉ lấy từ dữ liệu commit Fabric thật. Simulation không có
   * giao dịch/khối thật nên luôn null (nhãn `confirmed-simulation` là nhãn trung thực).
   */
  private ledgerEvidenceFields(
    result: ProjectionResultInput
  ): Pick<LedgerEvidenceRef, 'ledgerStatus' | 'txHash' | 'blockNumber'> {
    if ((result.networkMode ?? 'fabric') === 'simulation') {
      return {
        ledgerStatus: 'confirmed-simulation',
        txHash: null,
        blockNumber: null,
      }
    }
    return {
      ledgerStatus: 'confirmed-fabric',
      txHash: result.txHash,
      blockNumber:
        typeof result.blockNumber === 'number' &&
        Number.isSafeInteger(result.blockNumber) &&
        result.blockNumber > 0
          ? result.blockNumber
          : null,
    }
  }

  private async projectSettlementEvidence(
    aggregateType: 'move-in-settlement' | 'move-in-handover',
    id: ObjectId,
    update: (ref: LedgerEvidenceRef) => LedgerEvidenceRef
  ): Promise<void> {
    if (!this.settlementRepository) return
    const settlement = await this.settlementRepository.findOne({
      where: { _id: id },
    })
    const field =
      aggregateType === 'move-in-settlement'
        ? 'settlementEvidence'
        : 'handoverEvidence'
    const current = settlement?.[field]
    if (!settlement || !current) return // không bịa bằng chứng khi bản ghi chưa có manifest
    settlement[field] = update(current)
    await this.settlementRepository.save(settlement)
  }

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
        case 'governance-snapshot': {
          if (!this.governanceRepository) break
          const snapshot = await this.governanceRepository.findOne({
            where: { _id: objId },
          })
          if (snapshot) {
            const fields = this.ledgerEvidenceFields(result)
            snapshot.ledgerStatus = fields.ledgerStatus
            snapshot.txHash = fields.txHash
            snapshot.blockNumber = fields.blockNumber
            await this.governanceRepository.save(snapshot)
          }
          break
        }
        case 'move-in-settlement':
        case 'move-in-handover': {
          const fields = this.ledgerEvidenceFields(result)
          await this.projectSettlementEvidence(
            event.aggregateType,
            objId,
            ref => ({ ...ref, ...fields })
          )
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
        case 'governance-snapshot': {
          if (!this.governanceRepository) break
          const snapshot = await this.governanceRepository.findOne({
            where: { _id: objId },
          })
          if (snapshot) {
            snapshot.ledgerStatus = 'failed-terminal'
            await this.governanceRepository.save(snapshot)
          }
          break
        }
        case 'move-in-settlement':
        case 'move-in-handover':
          await this.projectSettlementEvidence(
            event.aggregateType,
            objId,
            ref => ({ ...ref, ledgerStatus: 'failed-terminal' })
          )
          break
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
