import { Injectable } from '@nestjs/common'
import { CronExpression } from '@nestjs/schedule'
import { RentalOpsScheduler } from '../../rental/services/rental-ops.scheduler'
import { BaseJob } from '../base-job'

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'

/**
 * D10: 5 tác vụ vận hành tùy chọn. Cờ `rentalOps.schedulerEnabled`, khóa Redis
 * và logic từng tác vụ vẫn nằm trong RentalOpsScheduler (không đổi); các job
 * này chỉ giữ tên cron `rental-ops-*` và lịch.
 */
@Injectable()
export class RentalOpsExpireAttemptsJob extends BaseJob {
  readonly name = 'rental-ops-expire-attempts'
  readonly description =
    'Hết hạn các lượt thanh toán mock-bank treo (mỗi 5 phút)'
  readonly cron = CronExpression.EVERY_5_MINUTES

  constructor(private readonly ops: RentalOpsScheduler) {
    super()
  }

  run(): Promise<number> {
    return this.ops.expireAttempts()
  }
}

@Injectable()
export class RentalOpsExpireDepositAgreementsJob extends BaseJob {
  readonly name = 'rental-ops-expire-deposit-agreements'
  readonly description = 'Hết hạn các thỏa thuận đặt cọc quá hạn (mỗi giờ)'
  readonly cron = CronExpression.EVERY_HOUR

  constructor(private readonly ops: RentalOpsScheduler) {
    super()
  }

  run(): Promise<number> {
    return this.ops.expireDepositAgreements()
  }
}

@Injectable()
export class RentalOpsProcessPaymentRemindersJob extends BaseJob {
  readonly name = 'rental-ops-process-payment-reminders'
  readonly description =
    'Nhắc thanh toán và đánh dấu quá hạn (hằng ngày 07:00 Asia/Ho_Chi_Minh)'
  readonly cron = '0 7 * * *'
  readonly timeZone = VIETNAM_TIME_ZONE

  constructor(private readonly ops: RentalOpsScheduler) {
    super()
  }

  run(): Promise<number> {
    return this.ops.processPaymentReminders()
  }
}

@Injectable()
export class RentalOpsMarkSettlementsOverdueJob extends BaseJob {
  readonly name = 'rental-ops-mark-settlements-overdue'
  readonly description =
    'Đánh dấu quyết toán nhận nhà quá hạn (hằng ngày 00:00)'
  readonly cron = CronExpression.EVERY_DAY_AT_MIDNIGHT

  constructor(private readonly ops: RentalOpsScheduler) {
    super()
  }

  run(): Promise<number> {
    return this.ops.markSettlementsOverdue()
  }
}

@Injectable()
export class RentalOpsApplyDueAmendmentsJob extends BaseJob {
  readonly name = 'rental-ops-apply-due-amendments'
  readonly description =
    'Áp dụng các phụ lục hợp đồng đến hạn (hằng ngày 01:00)'
  readonly cron = CronExpression.EVERY_DAY_AT_1AM

  constructor(private readonly ops: RentalOpsScheduler) {
    super()
  }

  run(): Promise<number> {
    return this.ops.applyDueAmendments()
  }
}

@Injectable()
export class RentalOpsProcessMoveOutDeadlinesJob extends BaseJob {
  readonly name = 'rental-ops-process-move-out-deadlines'
  readonly description =
    'Xử lý hạn phản hồi biên bản trả nhà, bảng khấu trừ cọc và hạn hoàn cọc (mỗi giờ)'
  readonly cron = CronExpression.EVERY_HOUR

  constructor(private readonly ops: RentalOpsScheduler) {
    super()
  }

  async run(): Promise<number> {
    const handovers = await this.ops.processMoveOutHandoverDeadlines()
    const statements = await this.ops.processDepositStatementDeadlines()
    return handovers + statements
  }
}
