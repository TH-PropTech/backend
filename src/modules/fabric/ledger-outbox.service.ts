import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash, randomUUID } from 'node:crypto'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { FabricService } from './fabric.service'
import { LedgerProjectionService } from './ledger-projection.service'
import { LedgerOutbox } from './schemas/ledger-outbox.schema'

export type LedgerEventInput = {
  aggregateType: string
  aggregateId: string
  eventType: string
  action: string
  args: string[]
  metadata?: Record<string, unknown>
  dependencyKey?: string | null
}

const MAX_ATTEMPTS = 5
const ALLOWED_RETRY_ACTIONS = new Set([
  'recordDeposit',
  'createContract',
  'recordPayment',
  'terminateContract',
])

@Injectable()
export class LedgerOutboxService {
  private readonly logger = new Logger(LedgerOutboxService.name)

  constructor(
    @InjectRepository(LedgerOutbox)
    private readonly repository: Repository<LedgerOutbox>,
    private readonly fabricService: FabricService,
    private readonly projectionService: LedgerProjectionService
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
      dependencyKey: input.dependencyKey ?? null,
      claimToken: null,
      claimedAt: null,
      leaseExpiresAt: null,
      confirmedAt: null,
      networkMode: null,
      blockNumber: null,
      errorCode: null,
    })
    return this.repository.save(event)
  }

  /**
   * Khôi phục các event bị kẹt ở trạng thái processing khi lease đã hết hạn.
   */
  async recoverExpiredLeases(now = new Date()): Promise<number> {
    const processingEvents = await this.repository.find({
      where: { status: 'processing' },
    })
    let count = 0
    for (const event of processingEvents) {
      if (
        event.leaseExpiresAt &&
        event.leaseExpiresAt.getTime() <= now.getTime()
      ) {
        if (typeof this.repository.update === 'function') {
          const result = await this.repository.update(
            {
              _id: event._id,
              status: 'processing',
            },
            {
              status: 'pending',
              claimToken: null,
              leaseExpiresAt: null,
            }
          )
          if (result && result.affected === 1) {
            count += 1
            this.logger.warn(
              `Recovered stuck outbox event [${event._id?.toString()}] back to pending`
            )
          }
        } else {
          event.status = 'pending'
          event.claimToken = null
          event.leaseExpiresAt = null
          await this.repository.save(event)
          count += 1
          this.logger.warn(
            `Recovered stuck outbox event [${event._id?.toString()}] back to pending`
          )
        }
      }
    }
    return count
  }

  /**
   * Atomic claim một event pending hợp lệ với claimToken và finite lease.
   */
  async claimNext(
    leaseDurationMs = 30000,
    now = new Date()
  ): Promise<LedgerOutbox | null> {
    const candidates = await this.repository.find({
      where: { status: 'pending' },
    })

    for (const candidate of candidates) {
      if (
        candidate.nextRetryAt &&
        candidate.nextRetryAt.getTime() > now.getTime()
      ) {
        continue
      }

      // Kiểm tra dependency prerequisite nếu có
      if (candidate.dependencyKey) {
        const isSatisfied = await this.checkDependency(candidate)
        if (!isSatisfied) {
          // Chưa thỏa mãn hoặc dependency đã fail
          continue
        }
      }

      // Claim compare-and-set
      const claimToken = randomUUID()
      const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs)

      if (typeof this.repository.update === 'function') {
        const result = await this.repository.update(
          {
            _id: candidate._id,
            status: 'pending',
          },
          {
            status: 'processing',
            claimToken,
            claimedAt: now,
            leaseExpiresAt,
          }
        )

        if (result && result.affected === 1) {
          candidate.claimToken = claimToken
          candidate.claimedAt = now
          candidate.leaseExpiresAt = leaseExpiresAt
          candidate.status = 'processing'
          return candidate
        }
        // Another worker won the claim race for this candidate; try next
        continue
      }

      candidate.claimToken = claimToken
      candidate.claimedAt = now
      candidate.leaseExpiresAt = leaseExpiresAt
      candidate.status = 'processing'
      return this.repository.save(candidate)
    }

    return null
  }

  private async checkDependency(event: LedgerOutbox): Promise<boolean> {
    if (!event.dependencyKey) return true

    // Format dependencyKey: 'aggregateType:aggregateId:eventType'
    const parts = event.dependencyKey.split(':')
    if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return true

    const aggregateType: string = parts[0]
    const aggregateId: string = parts[1]
    const eventType: string = parts[2]
    const depEvent = await this.repository.findOne({
      where: { aggregateType, aggregateId, eventType },
    })

    if (!depEvent) {
      // Dependency chưa tồn tại hoặc chưa tạo -> defer
      return false
    }

    if (depEvent.status === 'failed') {
      event.status = 'failed'
      event.errorCode = 'DEPENDENCY_FAILED'
      event.lastError = `Prerequisite event [${event.dependencyKey}] failed terminally`
      event.nextRetryAt = null
      await this.repository.save(event)
      this.logger.error(
        `Event [${event._id?.toString()}] marked failed because dependency [${event.dependencyKey}] failed`
      )
      return false
    }

    // Chỉ cho phép submit nếu dependency đã confirmed
    return depEvent.status === 'confirmed'
  }

  /**
   * Hoàn tất event sau khi Fabric commit thành công.
   */
  async complete(
    id: ObjectId,
    claimToken: string,
    result: {
      txHash: string
      blockNumber?: number | null
      networkMode?: 'simulation' | 'fabric'
      confirmedAt?: Date
    }
  ): Promise<boolean> {
    const event = await this.repository.findOne({
      where: { _id: id },
    })

    if (
      !event ||
      event.status !== 'processing' ||
      event.claimToken !== claimToken
    ) {
      this.logger.warn(
        `Complete rejected for event [${id.toString()}]: invalid token or status [${event?.status}]`
      )
      return false
    }

    // Project kết quả về read models (Contract / Deposit / Payment)
    try {
      await this.projectionService.projectResult(event, result)
    } catch (projErr) {
      const errMsg =
        projErr instanceof Error ? projErr.message : String(projErr)
      this.logger.error(
        `Projection failed for event [${id.toString()}]: ${errMsg}. Retaining retry state for reconciliation.`
      )
      event.lastError = `Projection error: ${errMsg}`
      event.errorCode = 'PROJECTION_FAILED'
      event.nextRetryAt = new Date(Date.now() + 5000)
      await this.repository.save(event)
      return false
    }

    event.status = 'confirmed'
    event.txHash = result.txHash
    event.blockNumber = result.blockNumber ?? null
    event.networkMode = result.networkMode ?? 'fabric'
    event.confirmedAt = result.confirmedAt ?? new Date()
    event.lastError = null
    event.nextRetryAt = null
    event.errorCode = null

    await this.repository.save(event)

    return true
  }

  /**
   * Xử lý lỗi khi submit Fabric: phân loại transient vs terminal.
   */
  async fail(
    id: ObjectId,
    claimToken: string,
    error: unknown,
    isTerminal = false
  ): Promise<void> {
    const event = await this.repository.findOne({
      where: { _id: id },
    })

    if (
      !event ||
      event.status !== 'processing' ||
      event.claimToken !== claimToken
    ) {
      return
    }

    const rawMessage = error instanceof Error ? error.message : String(error)
    const isConflict =
      isTerminal ||
      rawMessage.includes('xung đột') ||
      rawMessage.includes('conflict') ||
      rawMessage.includes('CONFLICT') ||
      rawMessage.includes('không hợp lệ')

    if (isConflict) {
      event.status = 'failed'
      event.errorCode = 'TERMINAL_CONFLICT'
      event.lastError = this.sanitizeError(error)
      event.nextRetryAt = null
      this.logger.error(
        `Event [${id.toString()}] failed terminally: ${event.lastError}`
      )
    } else {
      event.attempts += 1
      if (event.attempts >= MAX_ATTEMPTS) {
        event.status = 'failed'
        event.errorCode = 'ATTEMPTS_EXHAUSTED'
        event.nextRetryAt = null
        this.logger.error(
          `Event [${id.toString()}] reached max attempts (${MAX_ATTEMPTS}) and marked failed`
        )
      } else {
        event.status = 'pending'
        const backoffMs = Math.min(
          60000,
          2 ** event.attempts * 1000 + Math.floor(Math.random() * 500)
        )
        event.nextRetryAt = new Date(Date.now() + backoffMs)
        this.logger.warn(
          `Event [${id.toString()}] transient retry attempt ${event.attempts}/${MAX_ATTEMPTS} scheduled in ${backoffMs}ms`
        )
      }
      event.lastError = this.sanitizeError(error)
    }

    await this.repository.save(event)
  }

  /**
   * Thao tác retry dành riêng cho staff/admin với action thuộc allowlist.
   */
  async retryTerminal(
    idStr: string,
    operatorRole: string
  ): Promise<LedgerOutbox> {
    if (operatorRole !== 'admin' && operatorRole !== 'staff') {
      throw new ForbiddenException(
        'Chỉ nhân viên hoặc quản trị viên mới có quyền retry event sổ cái'
      )
    }

    if (!ObjectId.isValid(idStr)) {
      throw new BadRequestException('ID event sổ cái không hợp lệ')
    }

    const event = await this.repository.findOne({
      where: { _id: new ObjectId(idStr) },
    })

    if (!event) {
      throw new BadRequestException('Không tìm thấy event sổ cái')
    }

    if (event.status !== 'failed') {
      throw new BadRequestException(
        'Chỉ có thể retry các event ở trạng thái thất bại (failed)'
      )
    }

    if (!ALLOWED_RETRY_ACTIONS.has(event.payload.action)) {
      throw new BadRequestException(
        `Action [${event.payload.action}] không nằm trong danh mục cho phép retry`
      )
    }

    event.status = 'pending'
    event.attempts = 0
    event.nextRetryAt = new Date()
    event.lastError = null
    event.errorCode = null
    event.claimToken = null
    event.leaseExpiresAt = null

    return this.repository.save(event)
  }

  /**
   * Vòng lặp xử lý outbox có giới hạn batch và recovery.
   */
  async processPending(limit = 10): Promise<number> {
    await this.recoverExpiredLeases()

    let processed = 0
    for (let i = 0; i < limit; i++) {
      const event = await this.claimNext()
      if (!event) break

      try {
        const result = await this.fabricService.submitTransaction(
          event.payload.action,
          event.payload.args,
          event.payload.metadata
        )
        await this.complete(event._id, event.claimToken!, result)
        processed += 1
      } catch (error) {
        await this.fail(event._id, event.claimToken!, error)
        processed += 1
      }
    }
    return processed
  }

  private sanitizeError(error: unknown): string {
    const message =
      error instanceof Error ? error.message : 'LEDGER_SUBMISSION_FAILED'
    return message.replace(/[\r\n]/g, ' ').slice(0, 240)
  }
}
