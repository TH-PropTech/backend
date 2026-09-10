import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash } from 'node:crypto'
import { Repository } from 'typeorm'
import { FabricService } from './fabric.service'
import { LedgerOutbox } from './schemas/ledger-outbox.schema'

export type LedgerEventInput = {
  aggregateType: string
  aggregateId: string
  eventType: string
  action: string
  args: string[]
  metadata?: Record<string, unknown>
}

const MAX_ATTEMPTS = 5

@Injectable()
export class LedgerOutboxService {
  private readonly logger = new Logger(LedgerOutboxService.name)

  constructor(
    @InjectRepository(LedgerOutbox)
    private readonly repository: Repository<LedgerOutbox>,
    private readonly fabricService: FabricService
  ) {}

  async enqueue(input: LedgerEventInput): Promise<LedgerOutbox> {
    const existing = await this.repository.findOne({
      where: {
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventType: input.eventType,
      },
    })
    if (existing) return existing
    const payload: LedgerOutbox['payload'] = {
      action: input.action,
      args: input.args,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    }
    const event: LedgerOutbox = this.repository.create({
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payloadHash: createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex'),
      payload,
      status: 'pending',
      attempts: 0,
      nextRetryAt: new Date(),
      lastError: null,
      txHash: null,
    })
    return this.repository.save(event)
  }

  async processPending(limit = 25): Promise<number> {
    const events = await this.repository.find({
      where: { status: 'pending' },
      take: limit,
    })
    let processed = 0
    for (const event of events) {
      if (event.nextRetryAt && event.nextRetryAt.getTime() > Date.now())
        continue
      await this.processOne(event)
      processed += 1
    }
    return processed
  }

  private async processOne(event: LedgerOutbox): Promise<void> {
    event.status = 'processing'
    event.attempts += 1
    await this.repository.save(event)
    try {
      const result = await this.fabricService.submitTransaction(
        event.payload.action,
        event.payload.args,
        event.payload.metadata
      )
      event.status = 'confirmed'
      event.txHash = result.txHash
      event.lastError = null
      event.nextRetryAt = null
    } catch (error) {
      event.status = event.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
      event.nextRetryAt =
        event.status === 'pending'
          ? new Date(Date.now() + 2 ** event.attempts * 1_000)
          : null
      event.lastError = this.sanitizeError(error)
      this.logger.warn(
        `Ledger outbox ${event._id.toString()} retry state=${event.status}`
      )
    }
    await this.repository.save(event)
  }

  private sanitizeError(error: unknown): string {
    const message =
      error instanceof Error ? error.message : 'LEDGER_SUBMISSION_FAILED'
    return message.replace(/[\r\n]/g, ' ').slice(0, 240)
  }
}
