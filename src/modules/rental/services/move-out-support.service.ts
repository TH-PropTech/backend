import { Injectable, Logger, Optional } from '@nestjs/common'
import { NotificationsService } from '../../notifications/services/notifications.service'
import { LedgerOutboxService } from '../../fabric/services/ledger-outbox.service'
import { RentalTransactionEventService } from './rental-transaction-event.service'
import type { RentalTransactionActorRole } from '../schemas/rental-transaction-event.schema'

export const MOVE_OUT_NOTIFICATION_TYPE = 'MOVE_OUT_SETTLEMENT'

export type MoveOutLedgerEvent = {
  aggregateType: 'move-out-handover' | 'deposit-statement' | 'deposit-refund'
  aggregateId: string
  eventType: string
  /** Dùng lại action chaincode hiện có; xem báo cáo deviation về hành động riêng. */
  action: 'recordHandover' | 'recordMoveInSettlement'
  args: string[]
  contractId: string
  payloadHash: string
  schemaVersion: number
}

/**
 * Tác dụng phụ dùng chung của biên bản trả nhà và bảng khấu trừ: thông báo,
 * nhật ký giao dịch thuê, neo ledger. Lỗi ở đây chỉ được log, không làm hỏng nghiệp vụ.
 */
@Injectable()
export class MoveOutSupportService {
  private readonly logger = new Logger(MoveOutSupportService.name)

  constructor(
    private readonly notifications: NotificationsService,
    @Optional()
    private readonly transactionEvents?: RentalTransactionEventService,
    @Optional() private readonly ledgerOutbox?: LedgerOutboxService
  ) {}

  get canAnchor(): boolean {
    return Boolean(this.ledgerOutbox)
  }

  async notify(
    userIds: string[],
    title: string,
    body: string,
    data: Record<string, unknown>
  ): Promise<void> {
    for (const userId of userIds) {
      try {
        await this.notifications.createNotification(
          userId,
          title,
          body,
          MOVE_OUT_NOTIFICATION_TYPE,
          data
        )
      } catch (error) {
        this.logger.warn(
          `Move-out notification for user [${userId}] failed: ${this.messageOf(error)}`
        )
      }
    }
  }

  async recordEvent(input: {
    contractId: string
    eventType: string
    actorRole: RentalTransactionActorRole
    actorId?: string | null
    refs?: Record<string, string>
    transitionKey: string
  }): Promise<void> {
    if (!this.transactionEvents) return
    try {
      await this.transactionEvents.record({
        transactionKey: input.contractId,
        contractId: input.contractId,
        eventType: input.eventType,
        actorRole: input.actorRole,
        actorId: input.actorId ?? null,
        refs: { contractId: input.contractId, ...(input.refs ?? {}) },
        transitionKey: input.transitionKey,
      })
    } catch (error) {
      this.logger.warn(
        `Move-out audit event [${input.eventType}] on contract [${input.contractId}] failed: ${this.messageOf(error)}`
      )
    }
  }

  /** Đưa sự kiện vào outbox; thất bại không chặn nghiệp vụ (giống biên bản nhận nhà). */
  async enqueueLedger(event: MoveOutLedgerEvent): Promise<void> {
    if (!this.ledgerOutbox) return
    try {
      await this.ledgerOutbox.enqueue({
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        action: event.action,
        args: event.args,
        dependencyKeys: [`contract:${event.contractId}:contract.activated`],
        metadata: {
          contractId: event.contractId,
          schemaVersion: event.schemaVersion,
          payloadHash: event.payloadHash,
        },
      })
    } catch (error) {
      this.logger.warn(
        `Ledger evidence [${event.eventType}] for [${event.aggregateId}] was not queued; business state is unaffected: ${this.messageOf(error)}`
      )
    }
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
