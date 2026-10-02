import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ModuleRef } from '@nestjs/core'
import { Cron, CronExpression } from '@nestjs/schedule'
import { RedisService } from '../redis/redis.service'
import { PaymentsService } from '../payments/payments.service'
import { MoveInSettlementsService } from '../move-in-settlements/move-in-settlements.service'
import { MockBankService } from '../mock-bank/mock-bank.service'
import { DepositAgreementsService } from '../contracts/deposit-agreements.service'
import { ContractAmendmentService } from '../contracts/contract-amendment.service'

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'

/**
 * D10: 5 tác vụ vận hành tùy chọn, mỗi tác vụ có lịch `@Cron` riêng và một
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

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'rental-ops-expire-attempts' })
  async expireAttempts(): Promise<number> {
    return this.runIfEnabled('expire-attempts', async () => {
      const service = this.moduleRef.get<MockBankService>(MockBankService, {
        strict: false,
      })
      return (await service?.expireStaleAttempts()) ?? 0
    })
  }

  @Cron(CronExpression.EVERY_HOUR, {
    name: 'rental-ops-expire-deposit-agreements',
  })
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

  // D10: "hằng ngày 07:00 Asia/Ho_Chi_Minh"
  @Cron('0 7 * * *', {
    name: 'rental-ops-process-payment-reminders',
    timeZone: VIETNAM_TIME_ZONE,
  })
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

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: 'rental-ops-mark-settlements-overdue',
  })
  async markSettlementsOverdue(): Promise<number> {
    return this.runIfEnabled('mark-settlements-overdue', async () => {
      const service = this.moduleRef.get<MoveInSettlementsService>(
        MoveInSettlementsService,
        { strict: false }
      )
      return (await service?.processOverdue()) ?? 0
    })
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM, {
    name: 'rental-ops-apply-due-amendments',
  })
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
