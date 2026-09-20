import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { ApartmentsService } from './apartments.service'

@Injectable()
export class ApartmentExpirationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ApartmentExpirationService.name)

  constructor(private readonly apartmentsService: ApartmentsService) {}

  // Bắt các bài hết hạn trong lúc server tắt, không đợi tới chu kỳ giờ kế tiếp.
  async onApplicationBootstrap(): Promise<void> {
    await this.expireOverdueListings()
  }

  @Cron(CronExpression.EVERY_HOUR)
  async expireOverdueListings(): Promise<void> {
    await this.run('expire overdue listings', () =>
      this.apartmentsService.checkExpiration()
    )
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async remindExpiringListings(): Promise<void> {
    await this.run('remind expiring listings', () =>
      this.apartmentsService.remindExpiringSoon()
    )
  }

  private async run(job: string, task: () => Promise<void>): Promise<void> {
    try {
      await task()
    } catch (error) {
      this.logger.error(`Job failed: ${job}`, error)
    }
  }
}
