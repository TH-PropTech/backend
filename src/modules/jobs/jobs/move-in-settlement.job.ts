import { Injectable } from '@nestjs/common'
import { CronExpression } from '@nestjs/schedule'
import { MoveInSettlementsService } from '../../move-in-settlements/services/move-in-settlements.service'
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
