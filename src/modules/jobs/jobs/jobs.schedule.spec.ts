import { CronExpression } from '@nestjs/schedule'
import type { BaseJob } from '../base-job'
import {
  ApartmentExpireOverdueListingsJob,
  ApartmentRemindExpiringListingsJob,
} from './apartment-expiration.job'
import {
  MoveInHandoverDeadlineJob,
  MoveInSettlementOverdueJob,
} from './move-in-settlement.job'
import {
  RentalOpsApplyDueAmendmentsJob,
  RentalOpsExpireAttemptsJob,
  RentalOpsExpireDepositAgreementsJob,
  RentalOpsMarkSettlementsOverdueJob,
  RentalOpsProcessMoveOutDeadlinesJob,
  RentalOpsProcessPaymentRemindersJob,
} from './rental-ops.job'

describe('job schedules (unchanged from the former @Cron decorators)', () => {
  const svc = {
    expireOverdueListings: jest.fn().mockResolvedValue(undefined),
    remindExpiringListings: jest.fn().mockResolvedValue(undefined),
    processOverdue: jest.fn().mockResolvedValue(2),
    processHandoverResponseDeadlines: jest.fn().mockResolvedValue(1),
    expireAttempts: jest.fn().mockResolvedValue(1),
    expireDepositAgreements: jest.fn().mockResolvedValue(1),
    processPaymentReminders: jest.fn().mockResolvedValue(1),
    markSettlementsOverdue: jest.fn().mockResolvedValue(1),
    applyDueAmendments: jest.fn().mockResolvedValue(1),
    processMoveOutHandoverDeadlines: jest.fn().mockResolvedValue(2),
    processDepositStatementDeadlines: jest.fn().mockResolvedValue(3),
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
        new MoveInHandoverDeadlineJob(svc as never),
        CronExpression.EVERY_HOUR,
        undefined,
        'processHandoverResponseDeadlines',
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
      [
        new RentalOpsProcessMoveOutDeadlinesJob(svc as never),
        CronExpression.EVERY_HOUR,
        undefined,
        'processMoveOutHandoverDeadlines',
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

  it('move-out deadline job sums both scheduler tasks', async () => {
    const job = new RentalOpsProcessMoveOutDeadlinesJob(svc as never)
    await expect(job.run()).resolves.toBe(5)
    expect(svc.processDepositStatementDeadlines).toHaveBeenCalled()
    expect(job.name).toBe('rental-ops-process-move-out-deadlines')
  })

  it('keeps the rental-ops cron names', () => {
    expect(
      cases.map(([job]) => job.name).filter(n => n.startsWith('rental-ops-'))
    ).toEqual([
      'rental-ops-expire-attempts',
      'rental-ops-expire-deposit-agreements',
      'rental-ops-process-payment-reminders',
      'rental-ops-mark-settlements-overdue',
      'rental-ops-apply-due-amendments',
      'rental-ops-process-move-out-deadlines',
    ])
  })
})
