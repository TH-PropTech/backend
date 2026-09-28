import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { MoveInSettlementsService } from './move-in-settlements.service'

@Injectable()
export class MoveInSettlementScheduler {
  constructor(private readonly service: MoveInSettlementsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async processOverdueSettlements(): Promise<number> {
    return this.service.processOverdue()
  }
}
