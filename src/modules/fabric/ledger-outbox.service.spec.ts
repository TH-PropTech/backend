import { ObjectId } from 'mongodb'
import { ForbiddenException, BadRequestException } from '@nestjs/common'
import { LedgerOutboxService } from './ledger-outbox.service'
import { LedgerOutbox } from './schemas/ledger-outbox.schema'

describe('LedgerOutboxService', () => {
  let service: LedgerOutboxService
  let repository: {
    findOne: jest.Mock
    find: jest.Mock
    create: jest.Mock
    save: jest.Mock
    update?: jest.Mock
  }
  let fabricService: {
    submitTransaction: jest.Mock
  }
  let projectionService: {
    projectResult: jest.Mock
  }

  beforeEach(() => {
    repository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((input: object): unknown => ({ ...input })),
      save: jest.fn(
        (input: unknown): Promise<unknown> => Promise.resolve(input)
      ),
    }
    fabricService = {
      submitTransaction: jest.fn().mockResolvedValue({
        txHash: 'tx-fabric-1',
        blockNumber: null,
        networkMode: 'fabric',
      }),
    }
    projectionService = {
      projectResult: jest.fn().mockResolvedValue(undefined),
    }
    service = new LedgerOutboxService(
      repository as never,
      fabricService as never,
      projectionService as never
    )
  })

  describe('1. enqueue', () => {
    it('creates a new pending event with payloadHash and optional dependencyKey', async () => {
      repository.findOne.mockResolvedValue(null)
      const event = await service.enqueue({
        aggregateType: 'contract',
        aggregateId: 'c-1',
        eventType: 'contract.activated',
        action: 'createContract',
        args: ['c-1', 'hash-1'],
        dependencyKey: 'deposit:dep-1:paid',
      })

      expect(event.aggregateType).toBe('contract')
      expect(event.status).toBe('pending')
      expect(event.dependencyKey).toBe('deposit:dep-1:paid')
      expect(repository.save).toHaveBeenCalled()
    })

    it('deduplicates when same aggregate and eventType exists', async () => {
      const existing = {
        _id: new ObjectId(),
        status: 'pending',
      } as LedgerOutbox
      repository.findOne.mockResolvedValue(existing)

      const event = await service.enqueue({
        aggregateType: 'contract',
        aggregateId: 'c-1',
        eventType: 'contract.activated',
        action: 'createContract',
        args: ['c-1'],
      })

      expect(event).toBe(existing)
      expect(repository.save).not.toHaveBeenCalled()
    })
  })

  describe('2. lease recovery', () => {
    it('recovers processing events whose lease has expired back to pending', async () => {
      const expiredEvent = {
        _id: new ObjectId(),
        status: 'processing',
        claimToken: 'token-old',
        leaseExpiresAt: new Date(Date.now() - 5000),
      } as LedgerOutbox

      repository.find.mockResolvedValue([expiredEvent])

      const recovered = await service.recoverExpiredLeases()
      expect(recovered).toBe(1)
      expect(expiredEvent.status).toBe('pending')
      expect(expiredEvent.claimToken).toBeNull()
      expect(expiredEvent.leaseExpiresAt).toBeNull()
      expect(repository.save).toHaveBeenCalledWith(expiredEvent)
    })
  })

  describe('3. atomic claim & dependency gates', () => {
    it('claims pending event with atomic claimToken and finite lease', async () => {
      const pendingEvent = {
        _id: new ObjectId(),
        status: 'pending',
        nextRetryAt: new Date(Date.now() - 1000),
        dependencyKey: null,
      } as LedgerOutbox

      repository.find.mockResolvedValue([pendingEvent])

      const claimed = await service.claimNext(30000)
      expect(claimed).not.toBeNull()
      expect(claimed?.status).toBe('processing')
      expect(claimed?.claimToken).toBeDefined()
      expect(claimed?.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now())
      expect(repository.save).toHaveBeenCalled()
    })

    it('proves exactly one worker wins in a two-worker concurrent claim race (atomic compare-and-set)', async () => {
      const pendingEvent = {
        _id: new ObjectId(),
        status: 'pending',
        nextRetryAt: new Date(Date.now() - 1000),
        dependencyKey: null,
      } as LedgerOutbox

      repository.find.mockResolvedValue([pendingEvent])

      let updateCalls = 0
      repository.update = jest
        .fn()
        .mockImplementation((): Promise<{ affected: number }> => {
          updateCalls += 1
          if (updateCalls === 1) {
            return Promise.resolve({ affected: 1 })
          }
          return Promise.resolve({ affected: 0 })
        })

      const worker1 = service
      const worker2 = new LedgerOutboxService(
        repository as never,
        fabricService as never,
        projectionService as never
      )

      const [claim1, claim2] = await Promise.all([
        worker1.claimNext(30000),
        worker2.claimNext(30000),
      ])

      const winners = [claim1, claim2].filter(Boolean)
      expect(winners).toHaveLength(1)
      expect(repository.update).toHaveBeenCalledTimes(2)
    })

    it('defers claiming when dependencyKey prerequisite is not confirmed, without incrementing attempts', async () => {
      const pendingEvent = {
        _id: new ObjectId(),
        status: 'pending',
        attempts: 0,
        nextRetryAt: new Date(Date.now() - 1000),
        dependencyKey: 'deposit:dep-1:paid',
      } as LedgerOutbox

      repository.find.mockResolvedValue([pendingEvent])
      // Prerequisite is not confirmed
      repository.findOne.mockResolvedValue(null)

      const claimed = await service.claimNext(30000)
      expect(claimed).toBeNull()
      expect(pendingEvent.attempts).toBe(0)
      expect(pendingEvent.status).toBe('pending')
    })

    it('marks event terminally failed if dependency failed terminally', async () => {
      const pendingEvent = {
        _id: new ObjectId(),
        status: 'pending',
        attempts: 0,
        nextRetryAt: new Date(Date.now() - 1000),
        dependencyKey: 'deposit:dep-1:paid',
      } as LedgerOutbox

      const failedDep = {
        _id: new ObjectId(),
        status: 'failed',
      } as LedgerOutbox

      repository.find.mockResolvedValue([pendingEvent])
      repository.findOne.mockResolvedValue(failedDep)

      const claimed = await service.claimNext(30000)
      expect(claimed).toBeNull()
      expect(pendingEvent.status).toBe('failed')
      expect(pendingEvent.errorCode).toBe('DEPENDENCY_FAILED')
    })
  })

  describe('4. completion and projection', () => {
    it('completes event only when claimToken matches and invokes projection', async () => {
      const eventId = new ObjectId()
      const event = {
        _id: eventId,
        status: 'processing',
        claimToken: 'token-valid',
        aggregateType: 'contract',
        aggregateId: 'c-1',
        payload: { action: 'createContract', args: [] },
      } as unknown as LedgerOutbox

      repository.findOne.mockResolvedValue(event)

      const completed = await service.complete(eventId, 'token-valid', {
        txHash: 'tx-real',
        blockNumber: null,
        networkMode: 'fabric',
      })

      expect(completed).toBe(true)
      expect(event.status).toBe('confirmed')
      expect(event.txHash).toBe('tx-real')
      expect(projectionService.projectResult).toHaveBeenCalledWith(
        event,
        expect.objectContaining({ txHash: 'tx-real' })
      )
    })

    it('ignores complete if claimToken does not match', async () => {
      const eventId = new ObjectId()
      const event = {
        _id: eventId,
        status: 'processing',
        claimToken: 'token-current',
      } as LedgerOutbox

      repository.findOne.mockResolvedValue(event)

      const completed = await service.complete(eventId, 'token-stale', {
        txHash: 'tx-real',
      })

      expect(completed).toBe(false)
      expect(event.status).toBe('processing')
      expect(projectionService.projectResult).not.toHaveBeenCalled()
    })
  })

  describe('5. error handling & classification', () => {
    it('marks conflict error as terminal failure immediately without retrying', async () => {
      const eventId = new ObjectId()
      const event = {
        _id: eventId,
        status: 'processing',
        claimToken: 'token-1',
        attempts: 1,
      } as LedgerOutbox

      repository.findOne.mockResolvedValue(event)

      await service.fail(
        eventId,
        'token-1',
        new Error('Hợp đồng c-1 bị xung đột payload')
      )

      expect(event.status).toBe('failed')
      expect(event.errorCode).toBe('TERMINAL_CONFLICT')
      expect(event.nextRetryAt).toBeNull()
    })

    it('schedules exponential backoff for transient error under 5 attempts', async () => {
      const eventId = new ObjectId()
      const event = {
        _id: eventId,
        status: 'processing',
        claimToken: 'token-1',
        attempts: 1,
      } as LedgerOutbox

      repository.findOne.mockResolvedValue(event)

      await service.fail(eventId, 'token-1', new Error('Gateway timeout'))

      expect(event.status).toBe('pending')
      expect(event.attempts).toBe(2)
      expect(event.nextRetryAt).not.toBeNull()
    })
  })

  describe('6. staff/admin retry', () => {
    it('allows staff or admin to retry a terminal allowlisted event', async () => {
      const eventId = new ObjectId()
      const event = {
        _id: eventId,
        status: 'failed',
        attempts: 5,
        payload: { action: 'createContract', args: [] },
      } as unknown as LedgerOutbox

      repository.findOne.mockResolvedValue(event)

      const retried = await service.retryTerminal(
        eventId.toHexString(),
        'staff'
      )
      expect(retried.status).toBe('pending')
      expect(retried.attempts).toBe(0)
      expect(retried.nextRetryAt).toBeDefined()
    })

    it('rejects participant role with ForbiddenException', async () => {
      await expect(
        service.retryTerminal(new ObjectId().toHexString(), 'tenant')
      ).rejects.toThrow(ForbiddenException)
    })

    it('rejects unsupported action with BadRequestException', async () => {
      const eventId = new ObjectId()
      const event = {
        _id: eventId,
        status: 'failed',
        payload: { action: 'unsupportedAction', args: [] },
      } as unknown as LedgerOutbox

      repository.findOne.mockResolvedValue(event)

      await expect(
        service.retryTerminal(eventId.toHexString(), 'admin')
      ).rejects.toThrow(BadRequestException)
    })
  })
})
