import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ModuleRef } from '@nestjs/core'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { Contract } from '../contracts/schemas/contract.schema'
import { DepositAgreement } from '../contracts/schemas/deposit-agreement.schema'
import { RentalApplication } from '../rental-applications/schemas/rental-application.schema'
import { MoveInSettlement } from '../move-in-settlements/schemas/move-in-settlement.schema'
import { LedgerOutbox } from '../fabric/schemas/ledger-outbox.schema'
import {
  RentalTransactionActorRole,
  RentalTransactionEvent,
} from './schemas/rental-transaction-event.schema'
import {
  RentalRecoveryAction,
  RENTAL_RECOVERY_ACTIONS,
} from './dto/recover-rental-transaction.dto'
import { RentalTransactionEventService } from './rental-transaction-event.service'
import { ContractsService } from '../contracts/contracts.service'
import { DepositAgreementsService } from '../contracts/deposit-agreements.service'
import { MockBankService } from '../mock-bank/mock-bank.service'
import { RentalApplicationsService } from '../rental-applications/rental-applications.service'
import { LedgerOutboxService } from '../fabric/ledger-outbox.service'

export interface RentalTransactionTimelineEvent {
  id: string
  eventType: string
  status: string
  occurredAt: string
  actorRole: RentalTransactionActorRole
  reasonCode: string | null
  refs: Record<string, string>
}

export interface StuckRentalTransaction {
  reasonCode: string
  applicationId: string | null
  contractId: string | null
  aggregateRef: string | null
  ageMinutes: number
  suggestedAction: string
}

export interface RecoverRentalTransactionInput {
  action: RentalRecoveryAction
  reason: string
}

export interface RecoverRentalTransactionResult {
  contractId: string
  action: RentalRecoveryAction
  transitionKey: string
  status: string
}

type Actor = { id: string; roles: string[] }

@Injectable()
export class RentalTransactionsService {
  constructor(
    @InjectRepository(RentalTransactionEvent)
    private readonly eventRepository: Repository<RentalTransactionEvent>,
    @InjectRepository(RentalApplication)
    private readonly applicationRepository: Repository<RentalApplication>,
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @InjectRepository(DepositAgreement)
    private readonly depositRepository: Repository<DepositAgreement>,
    @InjectRepository(LedgerOutbox)
    private readonly outboxRepository: Repository<LedgerOutbox>,
    @InjectRepository(MoveInSettlement)
    private readonly settlementRepository: Repository<MoveInSettlement>,
    private readonly configService: ConfigService,
    @Optional() private readonly moduleRef?: ModuleRef,
    @Optional()
    private readonly transactionEventService?: RentalTransactionEventService
  ) {}

  async recover(
    contractId: string,
    actor: { id: string; role: 'staff' | 'admin' },
    input: RecoverRentalTransactionInput
  ): Promise<RecoverRentalTransactionResult> {
    if (!ObjectId.isValid(contractId)) {
      throw new NotFoundException('RENTAL_TRANSACTION_NOT_FOUND')
    }
    const reason = input.reason.trim()
    if (reason.length < 5) {
      throw new BadRequestException('RECOVERY_REASON_REQUIRED')
    }
    if (!RENTAL_RECOVERY_ACTIONS.includes(input.action)) {
      throw new BadRequestException('RECOVERY_ACTION_NOT_ALLOWED')
    }

    const contract = await this.contractRepository.findOne({
      where: { _id: new ObjectId(contractId) },
    })
    if (!contract) throw new NotFoundException('CONTRACT_NOT_FOUND')

    let status = String(contract.status ?? 'unknown')
    switch (input.action) {
      case 'RETRY_ACTIVATION': {
        const contractsService = this.resolveService(ContractsService)
        const recovered = await contractsService.retryActivation(contractId)
        status = String(recovered.status ?? 'unknown')
        break
      }
      case 'REISSUE_DEPOSIT_REQUEST': {
        if (!contract.depositAgreementId) {
          throw new ConflictException('DEPOSIT_AGREEMENT_NOT_FOUND')
        }
        const bankService = this.resolveService(MockBankService)
        await bankService.initDepositPayment(
          contract.depositAgreementId,
          contract.tenantId
        )
        status = 'payment-pending'
        break
      }
      case 'EXPIRE_DEPOSIT': {
        if (!contract.depositAgreementId) {
          throw new ConflictException('DEPOSIT_AGREEMENT_NOT_FOUND')
        }
        const depositService = this.resolveService(DepositAgreementsService)
        const expired = await depositService.expire(contract.depositAgreementId)
        status = expired.status
        break
      }
      case 'RETRY_PROVISIONING': {
        if (!contract.rentalApplicationId) {
          throw new ConflictException('RENTAL_APPLICATION_NOT_FOUND')
        }
        const applicationsService = this.resolveService(
          RentalApplicationsService
        )
        const retried = await applicationsService.retryProvisioning(
          contract.rentalApplicationId,
          actor.id
        )
        status = retried.provisioningStatus ?? 'unknown'
        break
      }
      case 'RETRY_LEDGER': {
        const outboxService = this.resolveService(LedgerOutboxService)
        const failed = await this.outboxRepository.find({
          where: {
            aggregateType: 'contract',
            aggregateId: contractId,
            status: 'failed',
          },
        })
        const event = failed[0]
        if (!event?._id) throw new NotFoundException('LEDGER_EVENT_NOT_FOUND')
        const retried = await outboxService.retryTerminal(
          event._id.toHexString(),
          actor.role
        )
        status = retried.status
        break
      }
    }

    const transitionKey = `recovery:${contractId}:${input.action}:${reason}`
    await this.transactionEventService?.record({
      transactionKey: contractId,
      transitionKey,
      applicationId: contract.rentalApplicationId ?? null,
      contractId,
      eventType: `recovery.${input.action.toLowerCase()}`,
      actorRole: actor.role,
      actorId: actor.id,
      reasonCode: input.action,
      refs: { contractId, status },
    })

    return { contractId, action: input.action, transitionKey, status }
  }

  private resolveService<T>(token: new (...args: never[]) => T): T {
    const service = this.moduleRef?.get(token, { strict: false })
    if (!service) throw new ConflictException('RECOVERY_SERVICE_UNAVAILABLE')
    return service
  }

  async getTimeline(
    applicationId: string,
    actor: Actor
  ): Promise<RentalTransactionTimelineEvent[]> {
    const application = await this.findApplication(applicationId)
    this.assertParticipant(application, actor)

    const events = await this.eventRepository.find({
      where: { applicationId },
      order: { occurredAt: 'ASC' },
    })
    const projected = events.map(event => this.mapEvent(event))
    if (projected.length > 0) return projected

    return this.projectLegacyTimeline(application)
  }

  async listStuck(filters?: {
    reason?: string
    page?: number
    limit?: number
  }): Promise<StuckRentalTransaction[]> {
    const now = Date.now()
    const thresholds =
      this.configService.get<{
        provisioningFailedMinutes?: number
        depositAttemptExpiredMinutes?: number
        depositUnpaidHours?: number
        signedPendingDepositHours?: number
        activationFailureMinutes?: number
        ledgerFailedTerminalMinutes?: number
        settlementOverdueHours?: number
        handoverOverdueHours?: number
      }>('rentalOps.stuckThresholds') ?? {}
    const result: StuckRentalTransaction[] = []
    const add = (
      reasonCode: string,
      applicationId: string | null,
      contractId: string | null,
      date: Date | null | undefined,
      suggestedAction: string
    ): void => {
      const ageMinutes = this.ageMinutes(date, now)
      result.push({
        reasonCode,
        applicationId,
        contractId,
        aggregateRef: contractId ?? applicationId,
        ageMinutes,
        suggestedAction,
      })
    }

    const failedApplications = await this.applicationRepository.find({
      where: { provisioningStatus: 'failed' },
    })
    for (const application of failedApplications) {
      add(
        'PROVISIONING_FAILED',
        application._id.toHexString(),
        application.contractId ?? null,
        application.updatedAt,
        'RETRY_PROVISIONING'
      )
    }

    const deposits = await this.depositRepository.find({
      where: [
        { status: 'payment-pending' },
        { status: 'accepted' },
        { status: 'draft' },
      ],
    })
    for (const deposit of deposits) {
      const ageMinutes = this.ageMinutes(deposit.updatedAt, now)
      const ageHours = ageMinutes / 60
      if (deposit.status === 'payment-pending') {
        add(
          'DEPOSIT_ATTEMPT_EXPIRED',
          deposit.applicationId,
          deposit.linkedLeaseContractId,
          deposit.updatedAt,
          'REISSUE_DEPOSIT_REQUEST'
        )
      } else if (ageHours >= (thresholds.depositUnpaidHours ?? 24)) {
        add(
          'DEPOSIT_UNPAID_TOO_LONG',
          deposit.applicationId,
          deposit.linkedLeaseContractId,
          deposit.createdAt,
          'REISSUE_DEPOSIT_REQUEST'
        )
      }
    }

    const contracts = await this.contractRepository.find({
      where: [{ status: 'fully-signed-pending-deposit' }, { status: 'active' }],
    })
    for (const contract of contracts) {
      if (
        contract.status === 'fully-signed-pending-deposit' &&
        this.ageMinutes(contract.updatedAt, now) >=
          (thresholds.signedPendingDepositHours ?? 24) * 60
      ) {
        add(
          'SIGNED_PENDING_DEPOSIT_TOO_LONG',
          contract.rentalApplicationId ?? null,
          contract._id.toHexString(),
          contract.updatedAt,
          'REISSUE_DEPOSIT_REQUEST'
        )
      }
      if (contract.activationFailure) {
        add(
          'ACTIVATION_FAILED_AFTER_DEPOSIT',
          contract.rentalApplicationId ?? null,
          contract._id.toHexString(),
          contract.activationFailure.at,
          'RETRY_ACTIVATION'
        )
      }
    }

    const failedLedger = await this.outboxRepository.find({
      where: { status: 'failed' },
    })
    for (const event of failedLedger) {
      add(
        'LEDGER_FAILED_TERMINAL',
        null,
        event.aggregateType === 'contract' ? event.aggregateId : null,
        event.updatedAt,
        'RETRY_LEDGER'
      )
    }

    const overdueSettlements = await this.settlementRepository.find({
      where: { status: 'overdue' },
    })
    for (const settlement of overdueSettlements) {
      add(
        'SETTLEMENT_OVERDUE',
        null,
        settlement.contractId,
        settlement.dueAt,
        'RETRY_SETTLEMENT'
      )
      if (!settlement.handover?.completedAt) {
        add(
          'HANDOVER_OVERDUE',
          null,
          settlement.contractId,
          settlement.dueAt,
          'RETRY_HANDOVER'
        )
      }
    }

    const sorted = result.sort(
      (left, right) => right.ageMinutes - left.ageMinutes
    )
    const filtered = filters?.reason
      ? sorted.filter(item => item.reasonCode === filters.reason)
      : sorted
    const page = Math.max(1, filters?.page ?? 1)
    const limit = Math.min(100, Math.max(1, filters?.limit ?? 50))
    return filtered.slice((page - 1) * limit, page * limit)
  }

  private async findApplication(
    applicationId: string
  ): Promise<RentalApplication> {
    if (!ObjectId.isValid(applicationId)) {
      throw new NotFoundException('RENTAL_TRANSACTION_NOT_FOUND')
    }
    const application = await this.applicationRepository.findOne({
      where: { _id: new ObjectId(applicationId) },
    })
    if (!application)
      throw new NotFoundException('RENTAL_TRANSACTION_NOT_FOUND')
    return application
  }

  private assertParticipant(
    application: RentalApplication,
    actor: Actor
  ): void {
    const isStaff = actor.roles.some(
      role => role === 'staff' || role === 'admin'
    )
    if (
      !isStaff &&
      actor.id !== application.tenantId &&
      actor.id !== application.landlordId
    ) {
      throw new ForbiddenException('RENTAL_TRANSACTION_ACCESS_DENIED')
    }
  }

  private mapEvent(
    event: RentalTransactionEvent
  ): RentalTransactionTimelineEvent {
    return {
      id: event._id.toHexString(),
      eventType: event.eventType,
      status: event.refs.status ?? 'recorded',
      occurredAt: event.occurredAt.toISOString(),
      actorRole: event.actorRole,
      reasonCode: event.reasonCode ?? null,
      refs: event.refs,
    }
  }

  private async projectLegacyTimeline(
    application: RentalApplication
  ): Promise<RentalTransactionTimelineEvent[]> {
    const events: RentalTransactionTimelineEvent[] = []
    if (application.submittedAt) {
      events.push({
        id: `legacy-application-${application._id.toHexString()}`,
        eventType: 'application.submitted',
        status: application.status,
        occurredAt: application.submittedAt.toISOString(),
        actorRole: 'tenant',
        reasonCode: application.reasonCode ?? null,
        refs: { applicationId: application._id.toHexString() },
      })
    }
    if (application.decidedAt) {
      events.push({
        id: `legacy-decision-${application._id.toHexString()}`,
        eventType: `application.${application.status}`,
        status: application.status,
        occurredAt: application.decidedAt.toISOString(),
        actorRole: 'landlord',
        reasonCode: application.reasonCode ?? null,
        refs: { applicationId: application._id.toHexString() },
      })
    }
    if (application.contractId && ObjectId.isValid(application.contractId)) {
      const contract = await this.contractRepository.findOne({
        where: { _id: new ObjectId(application.contractId) },
      })
      if (contract) {
        events.push({
          id: `legacy-contract-${contract._id.toHexString()}`,
          eventType: 'contract.status',
          status: contract.status ?? 'unknown',
          occurredAt: contract.updatedAt.toISOString(),
          actorRole: 'system',
          reasonCode: null,
          refs: { contractId: contract._id.toHexString() },
        })
      }
    }
    return events.sort(
      (left, right) =>
        new Date(left.occurredAt).getTime() -
        new Date(right.occurredAt).getTime()
    )
  }

  private ageMinutes(date: Date | null | undefined, now: number): number {
    if (!date) return 0
    return Math.max(0, Math.floor((now - date.getTime()) / 60000))
  }
}
