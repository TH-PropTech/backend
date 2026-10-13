import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ApartmentsService } from './apartments.service'

// Lịch cron nằm ở modules/jobs (jobs/apartment-expiration.job.ts).
@Injectable()
export class ApartmentExpirationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ApartmentExpirationService.name)

  constructor(private readonly apartmentsService: ApartmentsService) {}

  // Bắt các bài hết hạn trong lúc server tắt, không đợi tới chu kỳ giờ kế tiếp.
  async onApplicationBootstrap(): Promise<void> {
    await this.expireOverdueListings()
  }

  async expireOverdueListings(): Promise<void> {
    await this.run('expire overdue listings', () =>
      this.apartmentsService.checkExpiration()
    )
  }

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
