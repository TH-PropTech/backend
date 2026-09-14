import { LedgerOutboxWorker } from './ledger-outbox.worker'
import { LedgerOutboxService } from './ledger-outbox.service'

describe('LedgerOutboxWorker', () => {
  let worker: LedgerOutboxWorker
  let outboxService: {
    processPending: jest.Mock
  }

  beforeEach(() => {
    jest.useFakeTimers()
    outboxService = {
      processPending: jest.fn().mockResolvedValue(1),
    }
    worker = new LedgerOutboxWorker(
      outboxService as unknown as LedgerOutboxService
    )
  })

  afterEach(() => {
    worker.onModuleDestroy()
    jest.useRealTimers()
  })

  it('runs initial poll on bootstrap and sets recurring timer', async () => {
    await worker.onApplicationBootstrap()
    expect(outboxService.processPending).toHaveBeenCalledTimes(1)

    // Advance timer by 5000ms
    await jest.advanceTimersByTimeAsync(5000)
    expect(outboxService.processPending).toHaveBeenCalledTimes(2)
  })

  it('prevents overlapping worker executions', async () => {
    let slowResolve: () => void
    const slowPromise = new Promise<number>(resolve => {
      slowResolve = (): void => {
        resolve(1)
      }
    })
    outboxService.processPending.mockReturnValue(slowPromise)

    // First loop started
    const firstRun = worker.runLoop()

    // Second loop attempted while first is still running
    await worker.runLoop()

    // processPending should only be called once because second run was skipped
    expect(outboxService.processPending).toHaveBeenCalledTimes(1)

    slowResolve!()
    await firstRun
  })

  it('continues execution even if a poll throws an error', async () => {
    outboxService.processPending
      .mockRejectedValueOnce(new Error('Mongo connection drop'))
      .mockResolvedValueOnce(2)

    await worker.runLoop() // Throws inside, caught safely
    expect(outboxService.processPending).toHaveBeenCalledTimes(1)

    await worker.runLoop() // Next run proceeds
    expect(outboxService.processPending).toHaveBeenCalledTimes(2)
  })

  it('cleans up timer cleanly on module destroy', async () => {
    await worker.onApplicationBootstrap()
    worker.onModuleDestroy()

    await jest.advanceTimersByTimeAsync(10000)
    // Only the initial call from bootstrap occurred
    expect(outboxService.processPending).toHaveBeenCalledTimes(1)
  })
})
