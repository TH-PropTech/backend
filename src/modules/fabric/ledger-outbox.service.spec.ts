import { ObjectId } from 'mongodb'
import { LedgerOutboxService } from './ledger-outbox.service'

describe('LedgerOutboxService', () => {
  function createContext(): {
    service: LedgerOutboxService
    event: {
      _id: ObjectId
      aggregateType: string
      aggregateId: string
      eventType: string
      payloadHash: string
      payload: { action: string; args: string[] }
      status: 'pending' | 'confirmed' | 'failed'
      attempts: number
      nextRetryAt: Date | null
      lastError: string | null
      txHash: string | null
    }
    repository: {
      findOne: jest.Mock
      find: jest.Mock
      create: jest.Mock
      save: jest.Mock
    }
    fabricService: { submitTransaction: jest.Mock }
  } {
    const event = {
      _id: new ObjectId(),
      aggregateType: 'payment',
      aggregateId: 'payment-1',
      eventType: 'payment.confirmed',
      payloadHash: 'old',
      payload: { action: 'recordPayment', args: ['payment-1'] },
      status: 'pending' as const,
      attempts: 0,
      nextRetryAt: new Date(0),
      lastError: null,
      txHash: null,
    }
    const repository = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([event]),
      create: jest.fn((input: unknown): unknown => input),
      save: jest.fn(
        (input: unknown): Promise<unknown> => Promise.resolve(input)
      ),
    }
    const fabricService = {
      submitTransaction: jest.fn().mockResolvedValue({ txHash: 'sim_hash' }),
    }
    return {
      service: new LedgerOutboxService(
        repository as never,
        fabricService as never
      ),
      event,
      repository,
      fabricService,
    }
  }

  it('deduplicates events by aggregate and event type', async () => {
    const context = createContext()
    context.repository.findOne.mockResolvedValue(context.event)

    const result = await context.service.enqueue({
      aggregateType: 'payment',
      aggregateId: 'payment-1',
      eventType: 'payment.confirmed',
      action: 'recordPayment',
      args: ['payment-1'],
    })

    expect(result).toBe(context.event)
    expect(context.repository.create).not.toHaveBeenCalled()
  })

  it('confirms a pending event and stores the Fabric transaction hash', async () => {
    const context = createContext()

    await expect(context.service.processPending()).resolves.toBe(1)
    expect(context.event.status).toBe('confirmed')
    expect(context.event.txHash).toBe('sim_hash')
    expect(context.fabricService.submitTransaction).toHaveBeenCalledWith(
      'recordPayment',
      ['payment-1'],
      undefined
    )
  })

  it('backs off transient ledger failures and terminally fails after five attempts', async () => {
    const context = createContext()
    context.fabricService.submitTransaction.mockRejectedValue(
      new Error('peer unavailable\nsecret')
    )

    await context.service.processPending()
    expect(context.event.status).toBe('pending')
    expect(context.event.lastError).toBe('peer unavailable secret')
    context.event.attempts = 5
    context.event.status = 'pending'
    context.event.nextRetryAt = new Date(0)
    await context.service.processPending()
    expect(context.event.status).toBe('failed')
  })
})
