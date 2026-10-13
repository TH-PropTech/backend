import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ModuleRef } from '@nestjs/core'
import { RedisService } from '../../health/services/redis.service'
import { PaymentsService } from '../../payments/services/payments.service'
import { MoveInSettlementsService } from '../../move-in-settlements/services/move-in-settlements.service'
import { MockBankService } from '../../mock-bank/services/mock-bank.service'
import { DepositAgreementsService } from '../../contracts/services/deposit-agreements.service'
import { ContractAmendmentService } from '../../contracts/services/contract-amendment.service'

/**
 * D10: 5 tác vụ vận hành tùy chọn (lịch cron `rental-ops-*` nằm ở
 * modules/jobs/jobs/rental-ops.job.ts), mỗi tác vụ có một
 * khóa Redis đơn lẻ (`SET key value PX ttl NX`) để nhiều instance backend
 * không xử lý trùng. Toàn bộ scheduler chỉ chạy khi
 * `rentalOps.schedulerEnabled` (RENTAL_SCHEDULER_ENABLED) bật; khi tắt, mọi
 * tác vụ là no-op và các endpoint thủ công hiện có không đổi.
 */
@Injectable()
export class RentalOpsScheduler {
  private readonly logger = new Logger(RentalOpsScheduler.name)

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly moduleRef: ModuleRef
  ) {}

  async expireAttempts(): Promise<number> {
    return this.runIfEnabled('expire-attempts', async () => {
      const service = this.moduleRef.get<MockBankService>(MockBankService, {
        strict: false,
      })
      return (await service?.expireStaleAttempts()) ?? 0
    })
  }

  async expireDepositAgreements(): Promise<number> {
    return this.runIfEnabled('expire-deposit-agreements', async () => {
      const service = this.moduleRef.get<DepositAgreementsService>(
        DepositAgreementsService,
        { strict: false }
      )
      if (!service) return 0
      const ttlHours =
        this.configService.get<number>('rentalOps.depositAgreementTtlHours') ??
        72
      return service.expireStale(ttlHours)
    })
  }

  async processPaymentReminders(): Promise<number> {
    return this.runIfEnabled('process-payment-reminders', async () => {
      const service = this.moduleRef.get<PaymentsService>(PaymentsService, {
        strict: false,
      })
      if (!service) return 0
      const result = await service.processReminders()
      return result.overdue + result.reminders
    })
  }

  async markSettlementsOverdue(): Promise<number> {
    return this.runIfEnabled('mark-settlements-overdue', async () => {
      const service = this.moduleRef.get<MoveInSettlementsService>(
        MoveInSettlementsService,
        { strict: false }
      )
      return (await service?.processOverdue()) ?? 0
    })
  }

  async applyDueAmendments(): Promise<number> {
    return this.runIfEnabled('apply-due-amendments', async () => {
      const service = this.moduleRef.get<ContractAmendmentService>(
        ContractAmendmentService,
        { strict: false }
      )
      return (await service?.applyAllDueAmendments()) ?? 0
    })
  }

  private isEnabled(): boolean {
    return Boolean(
      this.configService.get<boolean>('rentalOps.schedulerEnabled')
    )
  }

  private async runIfEnabled(
    taskName: string,
    task: () => Promise<number>
  ): Promise<number> {
    if (!this.isEnabled()) return 0
    return this.withTaskLock(taskName, task)
  }

  private async withTaskLock(
    name: string,
    task: () => Promise<number>
  ): Promise<number> {
    const key = `rental-ops:scheduler:${name}`
    const acquired = await this.redisService.setIfAbsent(
      key,
      `${Date.now()}`,
      4 * 60 * 1000
    )
    if (!acquired) return 0
    try {
      return await task()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Rental ops task [${name}] failed: ${message}`)
      return 0
    }
  }
}
