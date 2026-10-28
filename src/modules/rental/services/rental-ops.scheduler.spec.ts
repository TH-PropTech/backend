import { RentalOpsScheduler } from './rental-ops.scheduler'

type Task = {
  name: string
  run: (scheduler: RentalOpsScheduler) => Promise<number>
}

const TASKS: Task[] = [
  {
    name: 'expireAttempts',
    run: scheduler => scheduler.expireAttempts(),
  },
  {
    name: 'expireDepositAgreements',
    run: scheduler => scheduler.expireDepositAgreements(),
  },
  {
    name: 'processPaymentReminders',
    run: scheduler => scheduler.processPaymentReminders(),
  },
  {
    name: 'markSettlementsOverdue',
    run: scheduler => scheduler.markSettlementsOverdue(),
  },
  {
    name: 'applyDueAmendments',
    run: scheduler => scheduler.applyDueAmendments(),
  },
  {
    name: 'processMoveOutHandoverDeadlines',
    run: scheduler => scheduler.processMoveOutHandoverDeadlines(),
  },
  {
    name: 'processDepositStatementDeadlines',
    run: scheduler => scheduler.processDepositStatementDeadlines(),
  },
]

describe('RentalOpsScheduler', () => {
  describe.each(TASKS)('$name', ({ run }) => {
    it('is a no-op when the scheduler is disabled', async () => {
      const task = jest.fn()
      const scheduler = new RentalOpsScheduler(
        { get: jest.fn().mockReturnValue(false) } as never,
        { setIfAbsent: jest.fn() } as never,
        {
          get: jest.fn().mockReturnValue({
            expireStaleAttempts: task,
            expireStale: task,
            processReminders: task,
            processOverdue: task,
            applyAllDueAmendments: task,
            processResponseDeadlines: task,
            processDeadlines: task,
          }),
        } as never
      )

      await expect(run(scheduler)).resolves.toBe(0)
      expect(task).not.toHaveBeenCalled()
    })

    it('uses one Redis lock so two concurrent runs only process once', async () => {
      const lockedKeys = new Set<string>()
      const tryLock = (key: string): boolean => {
        if (lockedKeys.has(key)) return false
        lockedKeys.add(key)
        return true
      }
      const setIfAbsent = jest.fn(
        (key: string): Promise<boolean> => Promise.resolve(tryLock(key))
      )
      const resolved = {
        expireStaleAttempts: jest.fn().mockResolvedValue(1),
        expireStale: jest.fn().mockResolvedValue(1),
        processReminders: jest
          .fn()
          .mockResolvedValue({ overdue: 1, reminders: 0 }),
        processOverdue: jest.fn().mockResolvedValue(1),
        applyAllDueAmendments: jest.fn().mockResolvedValue(1),
        processResponseDeadlines: jest.fn().mockResolvedValue(1),
        processDeadlines: jest.fn().mockResolvedValue(1),
      }
      const scheduler = new RentalOpsScheduler(
        {
          get: jest.fn((key: string) =>
            key === 'rentalOps.schedulerEnabled' ? true : 72
          ),
        } as never,
        { setIfAbsent } as never,
        { get: jest.fn().mockReturnValue(resolved) } as never
      )

      const results = await Promise.all([run(scheduler), run(scheduler)])
      expect(results.reduce((sum, value) => sum + value, 0)).toBe(1)
      expect(setIfAbsent).toHaveBeenCalledTimes(2)
    })
  })

  it('runs each task independently under its own lock key', async () => {
    const setIfAbsent = jest.fn().mockResolvedValue(true)
    const expireStaleAttempts = jest.fn().mockResolvedValue(0)
    const scheduler = new RentalOpsScheduler(
      { get: jest.fn().mockReturnValue(true) } as never,
      { setIfAbsent } as never,
      { get: jest.fn().mockReturnValue({ expireStaleAttempts }) } as never
    )

    await scheduler.expireAttempts()

    expect(setIfAbsent).toHaveBeenCalledWith(
      'rental-ops:scheduler:expire-attempts',
      expect.any(String),
      expect.any(Number)
    )
  })

  it('returns 0 when the target service is not registered', async () => {
    const scheduler = new RentalOpsScheduler(
      { get: jest.fn().mockReturnValue(true) } as never,
      { setIfAbsent: jest.fn().mockResolvedValue(true) } as never,
      { get: jest.fn().mockReturnValue(undefined) } as never
    )
    await expect(scheduler.processMoveOutHandoverDeadlines()).resolves.toBe(0)
    await expect(scheduler.processDepositStatementDeadlines()).resolves.toBe(0)
  })

  it('swallows a failing deadline task and returns 0', async () => {
    const scheduler = new RentalOpsScheduler(
      { get: jest.fn().mockReturnValue(true) } as never,
      { setIfAbsent: jest.fn().mockResolvedValue(true) } as never,
      {
        get: jest.fn().mockReturnValue({
          processDeadlines: jest.fn().mockRejectedValue(new Error('db down')),
        }),
      } as never
    )
    await expect(scheduler.processDepositStatementDeadlines()).resolves.toBe(0)
  })
})
