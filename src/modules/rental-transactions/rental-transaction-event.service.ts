import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import {
  RentalTransactionActorRole,
  RentalTransactionEvent,
} from './schemas/rental-transaction-event.schema'

export interface RecordRentalTransactionEventInput {
  transactionKey: string
  transitionKey: string
  applicationId?: string | null
  contractId?: string | null
  eventType: string
  actorRole: RentalTransactionActorRole
  actorId?: string | null
  reasonCode?: string | null
  refs?: Record<string, string>
  occurredAt?: Date
}

const SAFE_REF_KEYS = new Set([
  'applicationId',
  'contractId',
  'depositAgreementId',
  'paymentId',
  'outboxId',
  'amendmentId',
  'settlementId',
  'providerTransactionId',
  'status',
])

@Injectable()
export class RentalTransactionEventService {
  private readonly logger = new Logger(RentalTransactionEventService.name)

  constructor(
    @InjectRepository(RentalTransactionEvent)
    private readonly repository: Repository<RentalTransactionEvent>
  ) {}

  async record(
    input: RecordRentalTransactionEventInput
  ): Promise<RentalTransactionEvent> {
    const existing = await this.repository.findOne({
      where: { transitionKey: input.transitionKey },
    })
    if (existing) return existing

    const event = this.repository.create({
      transactionKey: this.safeValue(input.transactionKey),
      transitionKey: this.safeValue(input.transitionKey),
      applicationId: this.safeOptionalValue(input.applicationId),
      contractId: this.safeOptionalValue(input.contractId),
      eventType: this.safeValue(input.eventType),
      actorRole: input.actorRole,
      actorId: this.safeOptionalValue(input.actorId),
      reasonCode: this.safeOptionalValue(input.reasonCode),
      refs: this.sanitizeRefs(input.refs),
      occurredAt: input.occurredAt ?? new Date(),
    })

    try {
      return await this.repository.save(event)
    } catch (error) {
      const racedEvent = await this.repository.findOne({
        where: { transitionKey: input.transitionKey },
      })
      if (racedEvent) return racedEvent
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(
        `Failed to record rental transaction event [${input.transitionKey}]: ${message}`
      )
      throw error
    }
  }

  private sanitizeRefs(
    refs: Record<string, string> | undefined
  ): Record<string, string> {
    if (!refs) return {}
    return Object.entries(refs).reduce<Record<string, string>>(
      (result, [key, value]) => {
        if (SAFE_REF_KEYS.has(key)) {
          result[key] = this.safeValue(value)
        }
        return result
      },
      {}
    )
  }

  private safeOptionalValue(value: string | null | undefined): string | null {
    return value ? this.safeValue(value) : null
  }

  private safeValue(value: string): string {
    return value.replace(/[\r\n]/g, ' ').slice(0, 160)
  }
}
