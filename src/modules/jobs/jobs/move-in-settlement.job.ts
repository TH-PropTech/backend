import { Injectable } from '@nestjs/common'
import { CronExpression } from '@nestjs/schedule'
import { MoveInSettlementsService } from '../../rental/services/move-in-settlements.service'
import { BaseJob } from '../base-job'

@Injectable()
export class MoveInSettlementOverdueJob extends BaseJob {
  readonly name = 'move-in-settlement-overdue'
  readonly description =
    'Xử lý các quyết toán nhận nhà quá hạn (hằng ngày 09:00)'
  readonly cron = CronExpression.EVERY_DAY_AT_9AM

  constructor(private readonly service: MoveInSettlementsService) {
    super()
  }

  run(): Promise<number> {
    return this.service.processOverdue()
  }
}

/** Điều 9.1: hoàn tất biên bản bàn giao khi khách thuê không phản hồi trong 3 ngày. */
@Injectable()
export class MoveInHandoverDeadlineJob extends BaseJob {
  readonly name = 'move-in-handover-deadline'
  readonly description =
    'Hoàn tất biên bản bàn giao quá hạn phản hồi 3 ngày (mỗi giờ)'
  readonly cron = CronExpression.EVERY_HOUR

  constructor(private readonly service: MoveInSettlementsService) {
    super()
  }

  run(): Promise<number> {
    return this.service.processHandoverResponseDeadlines()
  }
}
