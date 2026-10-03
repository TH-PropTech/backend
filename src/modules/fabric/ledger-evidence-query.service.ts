import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { FabricService, FabricStatus } from './fabric.service'
import { BlockchainLog } from './schemas/blockchain-log.schema'
import { LedgerOutbox } from './schemas/ledger-outbox.schema'
import { Contract } from '../contracts/schemas/contract.schema'
import { ContractAmendment } from '../contracts/schemas/contract-amendment.schema'
import { DepositAgreement } from '../contracts/schemas/deposit-agreement.schema'
import { Payment } from '../payments/schemas/payment.schema'

export type LedgerEvidenceStatus =
  | 'pending'
  | 'processing'
  | 'confirmed'
  | 'failed-retryable'
  | 'failed-terminal'

export interface LedgerEvidenceEventDto {
  id: string
  eventType: string
  aggregateType: string
  aggregateRef: string
  status: LedgerEvidenceStatus
  networkMode: 'fabric' | 'simulation'
  txId: string | null
  blockNumber: number | null
  recordedAt: string | null
  payloadHash: string
  dependsOn: string | null
  attempts: number
  errorCode: string | null
  explorerUrl: string | null
}

export interface LedgerEvidenceDto {
  networkMode: 'fabric' | 'simulation'
  connectionState: FabricStatus['connectionState']
  explorerAvailable: boolean
  events: LedgerEvidenceEventDto[]
}

type AggregateRef = {
  aggregateType: string
  aggregateId: string
}

@Injectable()
export class LedgerEvidenceQueryService {
  constructor(
    @InjectRepository(BlockchainLog)
    private readonly logRepository: Repository<BlockchainLog>,
    @InjectRepository(LedgerOutbox)
    private readonly outboxRepository: Repository<LedgerOutbox>,
    @InjectRepository(DepositAgreement)
    private readonly depositAgreementRepository: Repository<DepositAgreement>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(ContractAmendment)
    private readonly amendmentRepository: Repository<ContractAmendment>,
    private readonly fabricService: FabricService,
    private readonly configService: ConfigService
  ) {}

  async getContractLedgerEvidence(
    contractId: string,
    contract: Pick<Contract, 'depositAgreementId'> &
      Partial<Pick<Contract, 'settlementId' | 'governanceSnapshotRef'>>
  ): Promise<LedgerEvidenceDto> {
    const [payments, amendments, deposit] = await Promise.all([
      this.paymentRepository.find({ where: { contractId } }),
      this.amendmentRepository.find({ where: { contractId } }),
      contract.depositAgreementId
        ? ObjectId.isValid(contract.depositAgreementId)
          ? this.depositAgreementRepository.findOne({
              where: { _id: new ObjectId(contract.depositAgreementId) },
            })
          : Promise.resolve(null)
        : Promise.resolve(null),
    ])

    const aggregateRefs = this.uniqueAggregateRefs([
      { aggregateType: 'contract', aggregateId: contractId },
      ...(contract.depositAgreementId
        ? [
            {
              aggregateType: 'deposit',
              aggregateId: contract.depositAgreementId,
            },
          ]
        : []),
      ...payments.map(payment => ({
        aggregateType: 'payment',
        aggregateId: payment._id.toString(),
      })),
      ...amendments.map(amendment => ({
        aggregateType: 'contract-amendment',
        aggregateId: amendment._id.toString(),
      })),
      // PROP-399: quyết toán, bàn giao nhận nhà và governance snapshot mà hợp đồng tham chiếu.
      ...(contract.settlementId
        ? [
            {
              aggregateType: 'move-in-settlement',
              aggregateId: contract.settlementId,
            },
            {
              aggregateType: 'move-in-handover',
              aggregateId: contract.settlementId,
            },
          ]
        : []),
      ...(contract.governanceSnapshotRef?.snapshotId
        ? [
            {
              aggregateType: 'governance-snapshot',
              aggregateId: contract.governanceSnapshotRef.snapshotId,
            },
          ]
        : []),
    ])

    const [outboxGroups, logGroups] = await Promise.all([
      Promise.all(
        aggregateRefs.map(ref =>
          this.outboxRepository.find({
            where: ref,
            order: { createdAt: 'DESC' },
          })
        )
      ),
      Promise.all([
        this.logRepository.find({ where: { contractId } }),
        ...payments.map(payment =>
          this.logRepository.find({
            where: { paymentId: payment._id.toString() },
          })
        ),
        ...(deposit?._id
          ? [
              this.logRepository.find({
                where: { depositId: deposit._id.toString() },
              }),
            ]
          : []),
        ...(contract.governanceSnapshotRef?.snapshotId
          ? [
              this.logRepository.find({
                where: {
                  governanceSnapshotId:
                    contract.governanceSnapshotRef.snapshotId,
                },
              }),
            ]
          : []),
      ]),
    ])

    const status = this.fabricService.getStatus()
    const template = this.configService.get<string>(
      'fabric.explorerTxUrlTemplate'
    )
    const explorerAvailable =
      status.mode === 'fabric' && Boolean(template?.includes('{txId}'))
    const outboxEvents = outboxGroups.flat()
    const logs = this.uniqueLogs(logGroups.flat())

    const events = [
      ...outboxEvents.map(event =>
        this.mapOutboxEvent(event, status.mode, template)
      ),
      ...logs.map(log => this.mapLogEvent(log, status.mode, template)),
    ].sort((left, right) => {
      const leftTime = left.recordedAt ? Date.parse(left.recordedAt) : 0
      const rightTime = right.recordedAt ? Date.parse(right.recordedAt) : 0
      return rightTime - leftTime
    })

    return {
      networkMode: status.mode,
      connectionState: status.connectionState,
      explorerAvailable,
      events,
    }
  }

  private mapOutboxEvent(
    event: LedgerOutbox,
    defaultNetworkMode: 'fabric' | 'simulation',
    template: string | undefined
  ): LedgerEvidenceEventDto {
    const networkMode = event.networkMode ?? defaultNetworkMode
    const txId = event.txHash ?? null
    return {
      id: `outbox-${event._id.toString()}`,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateRef: this.aggregateRef(event.aggregateId),
      status: this.mapStatus(event.status),
      networkMode,
      txId,
      blockNumber:
        networkMode === 'fabric' && event.blockNumber && event.blockNumber > 0
          ? event.blockNumber
          : null,
      recordedAt: event.confirmedAt?.toISOString() ?? null,
      payloadHash: this.safeHash(event.payloadHash),
      dependsOn: this.safeDependencies(event),
      attempts: Number.isFinite(event.attempts) ? event.attempts : 0,
      errorCode: this.safeCode(event.errorCode),
      explorerUrl: this.explorerUrl(networkMode, txId, template),
    }
  }

  private mapLogEvent(
    log: BlockchainLog,
    defaultNetworkMode: 'fabric' | 'simulation',
    template: string | undefined
  ): LedgerEvidenceEventDto {
    const networkMode = log.networkMode ?? defaultNetworkMode
    const txId = log.txHash || null
    const details = log.details ?? {}
    const aggregateType = log.paymentId
      ? 'payment'
      : log.depositId
        ? 'deposit'
        : log.governanceSnapshotId
          ? 'governance-snapshot'
          : log.settlementId
            ? log.handoverRevision != null
              ? 'move-in-handover'
              : 'move-in-settlement'
            : 'contract'
    const aggregateId =
      log.paymentId ??
      log.depositId ??
      log.governanceSnapshotId ??
      log.settlementId ??
      log.contractId ??
      ''
    const detailPayloadHash = log.payloadHash
      ? log.payloadHash
      : typeof details.payloadHash === 'string'
        ? details.payloadHash
        : details.contractHash
    return {
      id: `log-${log._id.toString()}`,
      eventType: log.eventType ?? log.action,
      aggregateType,
      aggregateRef: this.aggregateRef(aggregateId),
      status: this.mapStatus(log.status ?? 'confirmed'),
      networkMode,
      txId,
      blockNumber:
        networkMode === 'fabric' && log.blockNumber && log.blockNumber > 0
          ? log.blockNumber
          : null,
      recordedAt: log.createdAt?.toISOString() ?? null,
      payloadHash: this.safeHash(detailPayloadHash),
      dependsOn: null,
      attempts: Number.isFinite(log.retryCount) ? (log.retryCount ?? 0) : 0,
      errorCode: this.safeCode(details.errorCode),
      explorerUrl: this.explorerUrl(networkMode, txId, template),
    }
  }

  private mapStatus(status: string): LedgerEvidenceStatus {
    if (status === 'failed') return 'failed-terminal'
    if (
      status === 'pending' ||
      status === 'processing' ||
      status === 'confirmed'
    ) {
      return status
    }
    return 'pending'
  }

  private explorerUrl(
    networkMode: 'fabric' | 'simulation',
    txId: string | null,
    template: string | undefined
  ): string | null {
    if (networkMode !== 'fabric' || !txId || !template?.includes('{txId}')) {
      return null
    }
    return template.replace('{txId}', encodeURIComponent(txId))
  }

  private aggregateRef(aggregateId: string): string {
    const safeId = aggregateId.replace(/[^a-zA-Z0-9]/g, '')
    return safeId.slice(-6)
  }

  private safeHash(value: unknown): string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
      ? value.toLowerCase()
      : ''
  }

  private safeCode(value: unknown): string | null {
    return typeof value === 'string' && /^[A-Z0-9_-]{1,64}$/.test(value)
      ? value
      : null
  }

  /** D12: hiển thị mọi parent (`dependencyKeys ?? [dependencyKey]`), mỗi id rút gọn. */
  private safeDependencies(event: LedgerOutbox): string | null {
    const keys =
      Array.isArray(event.dependencyKeys) && event.dependencyKeys.length > 0
        ? event.dependencyKeys
        : event.dependencyKey
          ? [event.dependencyKey]
          : []
    const safe = keys
      .map(key => this.safeDependency(key))
      .filter((key): key is string => key !== null)
    return safe.length > 0 ? safe.join(',') : null
  }

  private safeDependency(value: string | null | undefined): string | null {
    if (!value) return null
    const [aggregateType, aggregateId, eventType] = value.split(':')
    if (!aggregateType || !aggregateId || !eventType) return null
    return `${aggregateType}:${this.aggregateRef(aggregateId)}:${eventType}`
  }

  private uniqueAggregateRefs(refs: AggregateRef[]): AggregateRef[] {
    return [
      ...new Map(
        refs.map(ref => [`${ref.aggregateType}:${ref.aggregateId}`, ref])
      ).values(),
    ]
  }

  private uniqueLogs(logs: BlockchainLog[]): BlockchainLog[] {
    return [...new Map(logs.map(log => [log._id.toString(), log])).values()]
  }
}
