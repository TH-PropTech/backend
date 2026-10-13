import { CronExpression } from '@nestjs/schedule'
import type { BaseJob } from '../base-job'
import {
  ApartmentExpireOverdueListingsJob,
  ApartmentRemindExpiringListingsJob,
} from './apartment-expiration.job'
import { MoveInSettlementOverdueJob } from './move-in-settlement.job'
import {
  RentalOpsApplyDueAmendmentsJob,
  RentalOpsExpireAttemptsJob,
  RentalOpsExpireDepositAgreementsJob,
  RentalOpsMarkSettlementsOverdueJob,
  RentalOpsProcessPaymentRemindersJob,
} from './rental-ops.job'

describe('job schedules (unchanged from the former @Cron decorators)', () => {
  const svc = {
    expireOverdueListings: jest.fn().mockResolvedValue(undefined),
    remindExpiringListings: jest.fn().mockResolvedValue(undefined),
    processOverdue: jest.fn().mockResolvedValue(2),
    expireAttempts: jest.fn().mockResolvedValue(1),
    expireDepositAgreements: jest.fn().mockResolvedValue(1),
    processPaymentReminders: jest.fn().mockResolvedValue(1),
    markSettlementsOverdue: jest.fn().mockResolvedValue(1),
    applyDueAmendments: jest.fn().mockResolvedValue(1),
  }
  const cases: Array<[BaseJob, string, string | undefined, keyof typeof svc]> =
    [
      [
        new ApartmentExpireOverdueListingsJob(svc as never),
        CronExpression.EVERY_HOUR,
        undefined,
        'expireOverdueListings',
      ],
      [
        new ApartmentRemindExpiringListingsJob(svc as never),
        CronExpression.EVERY_DAY_AT_MIDNIGHT,
        undefined,
        'remindExpiringListings',
      ],
      [
        new MoveInSettlementOverdueJob(svc as never),
        CronExpression.EVERY_DAY_AT_9AM,
        undefined,
        'processOverdue',
      ],
      [
        new RentalOpsExpireAttemptsJob(svc as never),
        CronExpression.EVERY_5_MINUTES,
        undefined,
        'expireAttempts',
      ],
      [
        new RentalOpsExpireDepositAgreementsJob(svc as never),
        CronExpression.EVERY_HOUR,
        undefined,
        'expireDepositAgreements',
      ],
      [
        new RentalOpsProcessPaymentRemindersJob(svc as never),
        '0 7 * * *',
        'Asia/Ho_Chi_Minh',
        'processPaymentReminders',
      ],
      [
        new RentalOpsMarkSettlementsOverdueJob(svc as never),
        CronExpression.EVERY_DAY_AT_MIDNIGHT,
        undefined,
        'markSettlementsOverdue',
      ],
      [
        new RentalOpsApplyDueAmendmentsJob(svc as never),
        CronExpression.EVERY_DAY_AT_1AM,
        undefined,
        'applyDueAmendments',
      ],
    ]

  it.each(cases)(
    '%# keeps its schedule and delegates',
    async (job, cron, tz, method) => {
      expect(job.cron).toBe(cron)
      expect(job.timeZone).toBe(tz)
      await job.run()
      expect(svc[method]).toHaveBeenCalledTimes(1)
    }
  )

  it('keeps the five rental-ops cron names', () => {
    expect(
      cases.map(([job]) => job.name).filter(n => n.startsWith('rental-ops-'))
    ).toEqual([
      'rental-ops-expire-attempts',
      'rental-ops-expire-deposit-agreements',
      'rental-ops-process-payment-reminders',
      'rental-ops-mark-settlements-overdue',
      'rental-ops-apply-due-amendments',
    ])
  })
})
