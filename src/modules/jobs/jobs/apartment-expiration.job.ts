import { Injectable } from '@nestjs/common'
import { CronExpression } from '@nestjs/schedule'
import { ApartmentExpirationService } from '../../properties/services/apartment-expiration.service'
import { BaseJob } from '../base-job'

@Injectable()
export class ApartmentExpireOverdueListingsJob extends BaseJob {
  readonly name = 'apartment-expire-overdue-listings'
  readonly description = 'Hết hạn các tin đăng căn hộ quá hạn (mỗi giờ)'
  readonly cron = CronExpression.EVERY_HOUR

  constructor(private readonly service: ApartmentExpirationService) {
    super()
  }

  async run(): Promise<void> {
    await this.service.expireOverdueListings()
  }
}

@Injectable()
export class ApartmentRemindExpiringListingsJob extends BaseJob {
  readonly name = 'apartment-remind-expiring-listings'
  readonly description =
    'Nhắc các tin đăng căn hộ sắp hết hạn (hằng ngày 00:00)'
  readonly cron = CronExpression.EVERY_DAY_AT_MIDNIGHT

  constructor(private readonly service: ApartmentExpirationService) {
    super()
  }

  async run(): Promise<void> {
    await this.service.remindExpiringListings()
  }
}
