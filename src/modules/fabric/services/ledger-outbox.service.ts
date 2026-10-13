import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
  Optional,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash, randomUUID } from 'node:crypto'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { FabricService } from './fabric.service'
import { LedgerProjectionService } from './ledger-projection.service'
import { LedgerOutbox } from '../schemas/ledger-outbox.schema'
import {
  LEDGER_SUBMIT_ACTIONS,
  validateLedgerActionArgs,
} from '../utils/ledger-action-args'
import { RentalTransactionEventService } from '../../rental/services/rental-transaction-event.service'

export type LedgerEventInput = {
  aggregateType: string
  aggregateId: string
  eventType: string
  action: string
  args: string[]
  metadata?: Record<string, unknown>
  /** Parent đơn (tương thích cũ); được chuẩn hoá vào `dependencyKeys`. */
  dependencyKey?: string | null
  /** PROP-399 D12: mọi parent phải `confirmed` mới được claim. */
  dependencyKeys?: string[] | null
}

const MAX_ATTEMPTS = 5
const DEPENDENCY_WAIT_STEP_MS = 5000
const DEPENDENCY_WAIT_MAX_MS = 60000
// PROP-399 D12: retry allowlist = các action outbox được phép submit.
const ALLOWED_RETRY_ACTIONS = LEDGER_SUBMIT_ACTIONS

/** Phân loại lỗi chaincode theo tiền tố `ERR_<CODE>:` (D12). */
const CHAINCODE_ERROR_PATTERN = /\bERR_([A-Z][A-Z_]*):/
type ChaincodeErrorClass =
  | { terminal: true; errorCode: string }
  | { terminal: false }
const CHAINCODE_ERROR_CLASSES: Record<string, ChaincodeErrorClass> = {
  CONFLICT: { terminal: true, errorCode: 'TERMINAL_CONFLICT' },
  GOVERNANCE_MISMATCH: { terminal: true, errorCode: 'TERMINAL_CONFLICT' },
  SCHEMA: { terminal: true, errorCode: 'TERMINAL_SCHEMA' },
  FORBIDDEN: { terminal: true, errorCode: 'FABRIC_CHAINCODE_FORBIDDEN' },
  NOT_FOUND: { terminal: false },
  DEPENDENCY: { terminal: false },
}

/** PROP-399 6.6: kết quả commit status của Fabric (FabricService) — ưu tiên hơn khớp chuỗi cũ. */
const COMMIT_RETRYABLE_MARKER = 'FABRIC_COMMIT_RETRYABLE:'
const COMMIT_REJECTED_MARKER = 'FABRIC_COMMIT_REJECTED:'

function keySegmentValid(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && !value.includes(':')
}

@Injectable()
export class LedgerOutboxService {
  private readonly logger = new Logger(LedgerOutboxService.name)

  constructor(
    @InjectRepository(LedgerOutbox)
    private readonly repository: Repository<LedgerOutbox>,
    private readonly fabricService: FabricService,
    private readonly projectionService: LedgerProjectionService,
    @Optional()
    private readonly transactionEventService?: RentalTransactionEventService
  ) {}

  async enqueue(input: LedgerEventInput): Promise<LedgerOutbox> {
    this.assertValidKeys(input)
    const dependencyKeys = this.normalizeDependencyKeys(input)

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
      dependencyKey: input.dependencyKey ?? dependencyKeys[0] ?? null,
      dependencyKeys: dependencyKeys.length > 0 ? dependencyKeys : null,
      contractId:
        typeof input.metadata?.contractId === 'string'
          ? input.metadata.contractId
          : input.aggregateType === 'contract'
            ? input.aggregateId
            : null,
      claimToken: null,
      claimedAt: null,
      leaseExpiresAt: null,
      confirmedAt: null,
      networkMode: null,
      blockNumber: null,
      errorCode: null,
    })
    const savedEvent = await this.repository.save(event)
    await this.recordTransactionEvent(savedEvent, 'ledger.enqueued')
    return savedEvent
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

      // Kiểm tra mọi parent prerequisite (D12); không tăng attempts khi chờ.
      if (this.dependencyKeysOf(candidate).length > 0) {
        const isSatisfied = await this.checkDependencies(candidate, now)
        if (!isSatisfied) {
          // Chưa thỏa mãn hoặc có parent đã fail
          continue
        }
      }

      // Claim compare-and-set
      const claimToken = randomUUID()
      const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs)
      const clearWaitMarker = candidate.errorCode === 'DEPENDENCY_PENDING'
      if (clearWaitMarker) {
        candidate.errorCode = null
        candidate.lastError = null
      }

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
            ...(clearWaitMarker ? { errorCode: null, lastError: null } : {}),
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

  /** Danh sách parent hiệu lực: `dependencyKeys ?? [dependencyKey]` (hàng cũ chỉ có dependencyKey). */
  private dependencyKeysOf(event: LedgerOutbox): string[] {
    if (
      Array.isArray(event.dependencyKeys) &&
      event.dependencyKeys.length > 0
    ) {
      return event.dependencyKeys
    }
    return event.dependencyKey ? [event.dependencyKey] : []
  }

  private assertValidKeys(input: LedgerEventInput): void {
    for (const segment of [
      input.aggregateType,
      input.aggregateId,
      input.eventType,
    ]) {
      if (!keySegmentValid(segment)) {
        throw new BadRequestException('LEDGER_KEY_INVALID')
      }
    }
    for (const key of [
      ...(input.dependencyKey ? [input.dependencyKey] : []),
      ...(input.dependencyKeys ?? []),
    ]) {
      const parts = typeof key === 'string' ? key.split(':') : []
      if (parts.length !== 3 || !parts.every(keySegmentValid)) {
        throw new BadRequestException('LEDGER_KEY_INVALID')
      }
    }
  }

  private normalizeDependencyKeys(input: LedgerEventInput): string[] {
    const keys = [
      ...(input.dependencyKey ? [input.dependencyKey] : []),
      ...(input.dependencyKeys ?? []),
    ]
    return [...new Set(keys)]
  }

  /**
   * D12: item sẵn sàng khi MỌI parent đã confirmed. Parent `failed` → child
   * `failed` (DEPENDENCY_FAILED). Parent thiếu/pending → chờ, không tăng attempts.
   */
  private async checkDependencies(
    event: LedgerOutbox,
    now: Date
  ): Promise<boolean> {
    let blockingKey: string | null = null

    for (const key of this.dependencyKeysOf(event)) {
      // Format key: 'aggregateType:aggregateId:eventType'
      const parts = key.split(':')
      if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) continue

      const aggregateType: string = parts[0]
      const aggregateId: string = parts[1]
      const eventType: string = parts[2]
      const depEvent = await this.repository.findOne({
        where: { aggregateType, aggregateId, eventType },
      })

      if (depEvent?.status === 'failed') {
        event.status = 'failed'
        event.errorCode = 'DEPENDENCY_FAILED'
        event.lastError = `Prerequisite event [${key}] failed terminally`
        event.nextRetryAt = null
        await this.repository.save(event)
        await this.projectFailureIfTerminal(event)
        this.logger.error(
          `Event [${event._id?.toString()}] marked failed because dependency [${key}] failed`
        )
        return false
      }

      if (depEvent?.status !== 'confirmed' && blockingKey === null) {
        blockingKey = key
      }
    }

    if (blockingKey === null) return true

    await this.recordDependencyWait(event, blockingKey, now)
    return false
  }

  private async recordDependencyWait(
    event: LedgerOutbox,
    blockingKey: string,
    now: Date
  ): Promise<void> {
    const waitCycles = (event.dependencyWaitCycles ?? 0) + 1
    const delayMs = Math.min(
      DEPENDENCY_WAIT_MAX_MS,
      DEPENDENCY_WAIT_STEP_MS * waitCycles
    )
    event.dependencyWaitCycles = waitCycles
    event.errorCode = 'DEPENDENCY_PENDING'
    event.lastError = `Waiting for prerequisite [${blockingKey}]`
    event.nextRetryAt = new Date(now.getTime() + delayMs)

    if (typeof this.repository.update === 'function') {
      // Status-guarded để không ghi đè một claim đồng thời của worker khác.
      await this.repository.update(
        { _id: event._id, status: 'pending' },
        {
          errorCode: event.errorCode,
          lastError: event.lastError,
          nextRetryAt: event.nextRetryAt,
          dependencyWaitCycles: waitCycles,
        }
      )
    } else {
      await this.repository.save(event)
    }
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
    await this.recordTransactionEvent(event, 'ledger.confirmed')

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
    // D12: tiền tố ERR_<CODE> của chaincode được phân loại trước; substring cũ chỉ là fallback.
    const chaincodeClass = this.classifyChaincodeError(rawMessage)
    const isConflict = chaincodeClass
      ? chaincodeClass.terminal
      : isTerminal ||
        rawMessage.includes('xung đột') ||
        rawMessage.includes('conflict') ||
        rawMessage.includes('CONFLICT') ||
        rawMessage.includes('không hợp lệ')

    if (isConflict) {
      event.status = 'failed'
      event.errorCode =
        chaincodeClass && chaincodeClass.terminal
          ? chaincodeClass.errorCode
          : 'TERMINAL_CONFLICT'
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
      if (event.errorCode === 'DEPENDENCY_PENDING') event.errorCode = null
    }

    await this.repository.save(event)
    await this.projectFailureIfTerminal(event)
    await this.recordTransactionEvent(
      event,
      event.status === 'failed' ? 'ledger.failed' : 'ledger.retry-scheduled'
    )
  }

  private classifyChaincodeError(message: string): ChaincodeErrorClass | null {
    if (message.includes(COMMIT_RETRYABLE_MARKER)) return { terminal: false }
    if (message.includes(COMMIT_REJECTED_MARKER)) {
      return { terminal: true, errorCode: 'TERMINAL_COMMIT_REJECTED' }
    }
    const code = CHAINCODE_ERROR_PATTERN.exec(message)?.[1]
    return code ? (CHAINCODE_ERROR_CLASSES[code] ?? null) : null
  }

  private async recordTransactionEvent(
    event: LedgerOutbox,
    eventType: string
  ): Promise<void> {
    if (!this.transactionEventService || !event._id) return
    try {
      await this.transactionEventService.record({
        transactionKey: event.aggregateId,
        transitionKey: `ledger:${event._id.toString()}:${eventType}`,
        contractId:
          event.aggregateType === 'contract' ? event.aggregateId : null,
        eventType,
        actorRole: 'system',
        reasonCode: event.errorCode ?? null,
        refs: {
          outboxId: event._id.toString(),
          status: event.status,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(
        `Rental transaction audit failed for ledger event [${event._id.toString()}]: ${message}`
      )
    }
  }

  private async projectFailureIfTerminal(event: LedgerOutbox): Promise<void> {
    if (event.status !== 'failed') return

    try {
      await this.projectionService.projectFailure(event)
    } catch (projectionError) {
      const message =
        projectionError instanceof Error
          ? projectionError.message
          : String(projectionError)
      this.logger.error(
        `Terminal ledger state persisted but failure projection failed for event [${event._id?.toString()}]: ${message}`
      )
    }
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
    event.dependencyWaitCycles = 0
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

      if (this.requiresChaincodeUpgrade(event)) {
        event.status = 'pending'
        event.claimToken = null
        event.claimedAt = null
        event.leaseExpiresAt = null
        event.errorCode = 'CHAINCODE_UPGRADE_REQUIRED'
        await this.repository.save(event)
        continue
      }

      const invalidReason = this.validateBeforeSubmit(event)
      if (invalidReason) {
        await this.failWithoutSubmit(event, invalidReason)
        processed += 1
        continue
      }

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

  private requiresChaincodeUpgrade(event: LedgerOutbox): boolean {
    const metadata = event.payload?.metadata
    const minimumAbiVersion = metadata?.minimumAbiVersion
    if (
      minimumAbiVersion === 2 &&
      typeof this.fabricService.getChaincodeAbiVersion === 'function' &&
      this.fabricService.getChaincodeAbiVersion() < minimumAbiVersion
    ) {
      return true
    }

    // PROP-399 D2: evidence schema v3 chỉ được submit khi chaincode quảng bá hỗ trợ.
    const minimumEvidenceSchemaVersion = metadata?.minimumEvidenceSchemaVersion
    if (
      typeof minimumEvidenceSchemaVersion === 'number' &&
      typeof this.fabricService.supportsEvidenceSchemaVersion === 'function'
    ) {
      return !this.fabricService.supportsEvidenceSchemaVersion(
        minimumEvidenceSchemaVersion
      )
    }
    return false
  }

  /** D12: action lạ hoặc args sai dạng → terminal, không bao giờ submit. */
  private validateBeforeSubmit(event: LedgerOutbox): string | null {
    const action = event.payload?.action
    if (typeof action !== 'string' || !ALLOWED_RETRY_ACTIONS.has(action)) {
      return `LEDGER_ACTION_UNKNOWN: ${String(action).slice(0, 80)}`
    }
    if (!Array.isArray(event.payload.args)) {
      return 'LEDGER_ARGS_INVALID: args must be an array'
    }
    const reason = validateLedgerActionArgs(action, event.payload.args)
    return reason ? `LEDGER_ARGS_INVALID: ${action}: ${reason}` : null
  }

  private async failWithoutSubmit(
    event: LedgerOutbox,
    reason: string
  ): Promise<void> {
    event.status = 'failed'
    event.errorCode = reason.split(':')[0] ?? 'LEDGER_ARGS_INVALID'
    event.lastError = reason.replace(/[\r\n]/g, ' ').slice(0, 240)
    event.nextRetryAt = null
    event.claimToken = null
    event.leaseExpiresAt = null
    await this.repository.save(event)
    this.logger.error(
      `Event [${event._id?.toString()}] failed terminally before submission: ${event.errorCode}`
    )
    await this.projectFailureIfTerminal(event)
    await this.recordTransactionEvent(event, 'ledger.failed')
  }

  private sanitizeError(error: unknown): string {
    const message =
      error instanceof Error ? error.message : 'LEDGER_SUBMISSION_FAILED'
    return message.replace(/[\r\n]/g, ' ').slice(0, 240)
  }
}
