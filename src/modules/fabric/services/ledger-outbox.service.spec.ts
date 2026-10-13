import { ObjectId } from 'mongodb'
import { ForbiddenException, BadRequestException } from '@nestjs/common'
import { LedgerOutboxService } from './ledger-outbox.service'
import { LedgerOutbox } from '../schemas/ledger-outbox.schema'

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
    getChaincodeAbiVersion: jest.Mock
  }
  let projectionService: {
    projectResult: jest.Mock
    projectFailure: jest.Mock
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
      getChaincodeAbiVersion: jest.fn(() => 2),
    }
    projectionService = {
      projectResult: jest.fn().mockResolvedValue(undefined),
      projectFailure: jest.fn().mockResolvedValue(undefined),
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
        dependencyKey: 'contract:contract-1:contract.activated',
      } as LedgerOutbox

      repository.find.mockResolvedValue([pendingEvent])
      // Prerequisite is not confirmed
      repository.findOne.mockResolvedValue(null)

      const processed = await service.processPending(1)
      expect(processed).toBe(0)
      expect(pendingEvent.attempts).toBe(0)
      expect(pendingEvent.status).toBe('pending')
      expect(fabricService.submitTransaction).not.toHaveBeenCalled()
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
    it('keeps an amendment event pending until the chaincode supports ABI v2', async () => {
      const event = {
        _id: new ObjectId(),
        status: 'pending',
        attempts: 0,
        nextRetryAt: new Date(Date.now() - 1000),
        dependencyKey: null,
        payload: {
          action: 'recordContractAmendment',
          args: ['contract-1', 'hash-1'],
          metadata: {
            minimumAbiVersion: 2,
            waitingCode: 'CHAINCODE_UPGRADE_REQUIRED',
          },
        },
      } as unknown as LedgerOutbox
      repository.find.mockResolvedValue([event])
      repository.findOne.mockResolvedValue(event)
      fabricService.getChaincodeAbiVersion.mockReturnValue(1)

      await expect(service.processPending(1)).resolves.toBe(0)

      expect(event.status).toBe('pending')
      expect(event.errorCode).toBe('CHAINCODE_UPGRADE_REQUIRED')
      expect(fabricService.submitTransaction).not.toHaveBeenCalled()
    })

    it('keeps a Fabric event retryable when the gateway is unavailable and never projects confirmation', async () => {
      const event = {
        _id: new ObjectId(),
        status: 'pending',
        attempts: 0,
        nextRetryAt: new Date(Date.now() - 1000),
        dependencyKey: null,
        payload: { action: 'createContract', args: ['c-1'] },
      } as unknown as LedgerOutbox
      repository.find.mockResolvedValue([event])
      repository.findOne.mockResolvedValue(event)
      fabricService.submitTransaction.mockRejectedValue(
        new Error('FABRIC_GATEWAY_UNAVAILABLE')
      )

      await expect(service.processPending(1)).resolves.toBe(1)

      expect(event.status).toBe('pending')
      expect(event.attempts).toBe(1)
      expect(event.txHash).not.toBe('simulated-tx')
      expect(projectionService.projectResult).not.toHaveBeenCalled()
    })

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
      expect(projectionService.projectFailure).toHaveBeenCalledWith(event)
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

    it('projects aggregate failure when transient attempts are exhausted', async () => {
      const eventId = new ObjectId()
      const event = {
        _id: eventId,
        status: 'processing',
        claimToken: 'token-1',
        attempts: 4,
        aggregateType: 'contract',
        aggregateId: new ObjectId().toHexString(),
      } as LedgerOutbox
      repository.findOne.mockResolvedValue(event)

      await service.fail(eventId, 'token-1', new Error('Gateway timeout'))

      expect(event.status).toBe('failed')
      expect(event.errorCode).toBe('ATTEMPTS_EXHAUSTED')
      expect(event.nextRetryAt).toBeNull()
      expect(projectionService.projectFailure).toHaveBeenCalledWith(event)
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

    it.each([
      'publishGovernanceSnapshot',
      'recordMoveInSettlement',
      'recordHandover',
    ])('allows retrying a terminal %s event (PROP-399 D12)', async action => {
      const eventId = new ObjectId()
      const event = {
        _id: eventId,
        status: 'failed',
        attempts: 5,
        payload: { action, args: [] },
      } as unknown as LedgerOutbox
      repository.findOne.mockResolvedValue(event)

      const retried = await service.retryTerminal(
        eventId.toHexString(),
        'admin'
      )
      expect(retried.status).toBe('pending')
    })
  })

  describe('7. PROP-399 D12 enqueue keys', () => {
    it('normalizes a legacy dependencyKey into dependencyKeys and keeps the legacy field', async () => {
      repository.findOne.mockResolvedValue(null)
      const event = await service.enqueue({
        aggregateType: 'contract',
        aggregateId: 'c-1',
        eventType: 'contract.activated',
        action: 'createContract',
        args: ['c-1'],
        dependencyKey: 'deposit:d-1:deposit.paid',
      })

      expect(event.dependencyKey).toBe('deposit:d-1:deposit.paid')
      expect(event.dependencyKeys).toEqual(['deposit:d-1:deposit.paid'])
    })

    it('accepts multiple dependencyKeys, merges the legacy key and de-duplicates', async () => {
      repository.findOne.mockResolvedValue(null)
      const event = await service.enqueue({
        aggregateType: 'contract',
        aggregateId: 'c-1',
        eventType: 'contract.activated',
        action: 'createContract',
        args: ['c-1'],
        dependencyKey: 'deposit:d-1:deposit.paid',
        dependencyKeys: [
          'deposit:d-1:deposit.paid',
          'governance-snapshot:g-1:governance.published',
        ],
      })

      expect(event.dependencyKeys).toEqual([
        'deposit:d-1:deposit.paid',
        'governance-snapshot:g-1:governance.published',
      ])
      expect(event.dependencyKey).toBe('deposit:d-1:deposit.paid')
    })

    it('records the related contractId for Audit Center filtering (metadata first, else the contract aggregate)', async () => {
      repository.findOne.mockResolvedValue(null)
      const viaMetadata = await service.enqueue({
        aggregateType: 'move-in-handover',
        aggregateId: 's-1',
        eventType: 'handover.completed',
        action: 'recordHandover',
        args: [],
        metadata: { contractId: 'c-9' },
      })
      expect(viaMetadata.contractId).toBe('c-9')
      const viaAggregate = await service.enqueue({
        aggregateType: 'contract',
        aggregateId: 'c-1',
        eventType: 'contract.activated',
        action: 'createContract',
        args: [],
      })
      expect(viaAggregate.contractId).toBe('c-1')
      const none = await service.enqueue({
        aggregateType: 'governance-snapshot',
        aggregateId: 'g-1',
        eventType: 'governance.published',
        action: 'publishGovernanceSnapshot',
        args: [],
      })
      expect(none.contractId).toBeNull()
    })

    it('stores no dependencyKeys when there are no parents', async () => {
      repository.findOne.mockResolvedValue(null)
      const event = await service.enqueue({
        aggregateType: 'deposit',
        aggregateId: 'd-1',
        eventType: 'deposit.paid',
        action: 'recordDeposit',
        args: ['d-1'],
      })
      expect(event.dependencyKey).toBeNull()
      expect(event.dependencyKeys ?? null).toBeNull()
    })

    it.each([
      ['aggregateType', { aggregateType: 'bad:type' }],
      ['aggregateId', { aggregateId: 'bad:id' }],
      ['eventType', { eventType: 'bad:event' }],
      ['dependency key with 4 segments', { dependencyKey: 'a:b:c:d' }],
      ['dependency key with 2 segments', { dependencyKeys: ['a:b'] }],
      ['dependency key with an empty segment', { dependencyKeys: ['a::c'] }],
    ])(
      'rejects a key with an invalid %s using LEDGER_KEY_INVALID',
      async (_l, override) => {
        repository.findOne.mockResolvedValue(null)
        await expect(
          service.enqueue({
            aggregateType: 'contract',
            aggregateId: 'c-1',
            eventType: 'contract.activated',
            action: 'createContract',
            args: ['c-1'],
            ...override,
          })
        ).rejects.toThrow('LEDGER_KEY_INVALID')
        expect(repository.save).not.toHaveBeenCalled()
      }
    )
  })

  describe('8. PROP-399 D12 multi-parent dependencies', () => {
    const KEY_A = 'deposit:d-1:deposit.paid'
    const KEY_B = 'governance-snapshot:g-1:governance.published'

    function pendingChild(extra: Record<string, unknown> = {}): LedgerOutbox {
      return {
        _id: new ObjectId(),
        status: 'pending',
        attempts: 0,
        nextRetryAt: new Date(Date.now() - 1000),
        dependencyKey: KEY_A,
        dependencyKeys: [KEY_A, KEY_B],
        payload: { action: 'createContract', args: ['c-1'] },
        ...extra,
      } as unknown as LedgerOutbox
    }

    function parents(statuses: Record<string, string | null>): void {
      repository.findOne.mockImplementation(
        (query: {
          where: {
            aggregateType: string
            aggregateId: string
            eventType: string
          }
        }): Promise<unknown> => {
          const key = `${query.where.aggregateType}:${query.where.aggregateId}:${query.where.eventType}`
          const status = statuses[key]
          return Promise.resolve(status ? { status } : null)
        }
      )
    }

    it('claims only when every parent is confirmed', async () => {
      const child = pendingChild()
      repository.find.mockResolvedValue([child])
      parents({ [KEY_A]: 'confirmed', [KEY_B]: 'confirmed' })

      const claimed = await service.claimNext()
      expect(claimed).toBe(child)
      expect(claimed?.status).toBe('processing')
    })

    it('does not claim while any parent is still pending, and the wait does not increment attempts', async () => {
      const child = pendingChild()
      repository.find.mockResolvedValue([child])
      parents({ [KEY_A]: 'confirmed', [KEY_B]: 'pending' })

      const now = new Date()
      const claimed = await service.claimNext(30000, now)

      expect(claimed).toBeNull()
      expect(child.attempts).toBe(0)
      expect(child.status).toBe('pending')
      expect(child.errorCode).toBe('DEPENDENCY_PENDING')
      expect(child.lastError).toContain(KEY_B)
      expect(child.nextRetryAt?.getTime()).toBe(now.getTime() + 5000)
    })

    it('treats a missing parent as a wait, not a failure', async () => {
      const child = pendingChild()
      repository.find.mockResolvedValue([child])
      parents({ [KEY_A]: 'confirmed', [KEY_B]: null })

      await expect(service.claimNext()).resolves.toBeNull()
      expect(child.status).toBe('pending')
      expect(child.errorCode).toBe('DEPENDENCY_PENDING')
      expect(child.lastError).toContain(KEY_B)
    })

    it('backs off 5s x waitCycles capped at 60s', async () => {
      const now = new Date()
      const child = pendingChild()
      repository.find.mockResolvedValue([child])
      parents({ [KEY_A]: 'pending', [KEY_B]: 'pending' })

      const delays: number[] = []
      for (let i = 0; i < 14; i++) {
        child.nextRetryAt = new Date(now.getTime() - 1)
        await service.claimNext(30000, now)
        delays.push(Number(child.nextRetryAt) - now.getTime())
      }

      expect(delays.slice(0, 3)).toEqual([5000, 10000, 15000])
      expect(Math.max(...delays)).toBe(60000)
      expect(delays[13]).toBe(60000)
      expect(child.attempts).toBe(0)
    })

    it('fails the child with DEPENDENCY_FAILED naming the failed parent, even if another parent is pending', async () => {
      const child = pendingChild()
      repository.find.mockResolvedValue([child])
      parents({ [KEY_A]: 'pending', [KEY_B]: 'failed' })

      await expect(service.claimNext()).resolves.toBeNull()

      expect(child.status).toBe('failed')
      expect(child.errorCode).toBe('DEPENDENCY_FAILED')
      expect(child.lastError).toContain(KEY_B)
      expect(child.nextRetryAt).toBeNull()
      expect(projectionService.projectFailure).toHaveBeenCalledWith(child)
    })

    it('still honours a legacy row that only has dependencyKey', async () => {
      const child = pendingChild({ dependencyKeys: undefined })
      repository.find.mockResolvedValue([child])
      parents({ [KEY_A]: 'confirmed' })

      await expect(service.claimNext()).resolves.toBe(child)
    })

    it('clears the stale DEPENDENCY_PENDING marker once the child is claimed', async () => {
      const child = pendingChild({
        errorCode: 'DEPENDENCY_PENDING',
        lastError: `Waiting for prerequisite [${KEY_B}]`,
      })
      repository.find.mockResolvedValue([child])
      parents({ [KEY_A]: 'confirmed', [KEY_B]: 'confirmed' })

      const claimed = await service.claimNext()
      expect(claimed?.errorCode).toBeNull()
      expect(claimed?.lastError).toBeNull()
    })

    it('persists the wait with a status-guarded update when the repository supports it', async () => {
      const child = pendingChild()
      repository.find.mockResolvedValue([child])
      repository.update = jest.fn().mockResolvedValue({ affected: 1 })
      parents({ [KEY_A]: 'pending', [KEY_B]: 'confirmed' })

      await service.claimNext()

      expect(repository.update).toHaveBeenCalledWith(
        { _id: child._id, status: 'pending' },
        expect.objectContaining({ errorCode: 'DEPENDENCY_PENDING' })
      )
    })

    it('does not submit anything while a parent is unconfirmed (processPending)', async () => {
      const child = pendingChild()
      repository.find.mockResolvedValue([child])
      parents({ [KEY_A]: 'confirmed', [KEY_B]: 'pending' })

      await expect(service.processPending(1)).resolves.toBe(0)
      expect(fabricService.submitTransaction).not.toHaveBeenCalled()
    })
  })

  describe('9. PROP-399 D12 ERR_<CODE> classification', () => {
    async function failWith(
      message: string,
      attempts = 1
    ): Promise<LedgerOutbox> {
      const eventId = new ObjectId()
      const event = {
        _id: eventId,
        status: 'processing',
        claimToken: 'token-1',
        attempts,
      } as LedgerOutbox
      repository.findOne.mockResolvedValue(event)
      await service.fail(eventId, 'token-1', new Error(message))
      return event
    }

    it('ERR_CONFLICT is terminal TERMINAL_CONFLICT', async () => {
      const event = await failWith('ERR_CONFLICT: payload differs')
      expect(event.status).toBe('failed')
      expect(event.errorCode).toBe('TERMINAL_CONFLICT')
      expect(event.nextRetryAt).toBeNull()
    })

    it('ERR_GOVERNANCE_MISMATCH is terminal TERMINAL_CONFLICT', async () => {
      const event = await failWith('ERR_GOVERNANCE_MISMATCH: hash differs')
      expect(event.status).toBe('failed')
      expect(event.errorCode).toBe('TERMINAL_CONFLICT')
    })

    it('ERR_SCHEMA is terminal TERMINAL_SCHEMA', async () => {
      const event = await failWith('ERR_SCHEMA: invalid envelope')
      expect(event.status).toBe('failed')
      expect(event.errorCode).toBe('TERMINAL_SCHEMA')
    })

    it('ERR_FORBIDDEN is terminal FABRIC_CHAINCODE_FORBIDDEN and not retried', async () => {
      const event = await failWith(
        'ERR_FORBIDDEN: transaction identity is not permitted'
      )
      expect(event.status).toBe('failed')
      expect(event.errorCode).toBe('FABRIC_CHAINCODE_FORBIDDEN')
      expect(event.attempts).toBe(1)
    })

    it.each(['ERR_NOT_FOUND: no contract', 'ERR_DEPENDENCY: deposit missing'])(
      '%s is transient with backoff',
      async message => {
        const event = await failWith(message)
        expect(event.status).toBe('pending')
        expect(event.attempts).toBe(2)
        expect(event.nextRetryAt).not.toBeNull()
      }
    )

    it('classifies the prefix even when the gateway wraps the message', async () => {
      const event = await failWith(
        'Fabric transaction failed: 10 ABORTED: transaction returned with failure: Error: ERR_CONFLICT: x'
      )
      expect(event.errorCode).toBe('TERMINAL_CONFLICT')
    })

    it('does not let legacy substring matching override a transient ERR_NOT_FOUND', async () => {
      const event = await failWith(
        'ERR_NOT_FOUND: dữ liệu không hợp lệ hoặc conflict'
      )
      expect(event.status).toBe('pending')
    })

    it('keeps the legacy substring fallback for unprefixed messages', async () => {
      const conflict = await failWith('Hợp đồng bị xung đột payload')
      expect(conflict.errorCode).toBe('TERMINAL_CONFLICT')
      const transient = await failWith('Gateway timeout')
      expect(transient.status).toBe('pending')
    })

    it('FABRIC_COMMIT_RETRYABLE (task 6.6) stays transient even if the message mentions legacy terminal words', async () => {
      const event = await failWith(
        'Fabric transaction failed: FABRIC_COMMIT_RETRYABLE: validation code 11 conflict không hợp lệ'
      )
      expect(event.status).toBe('pending')
      expect(event.attempts).toBe(2)
    })

    it('FABRIC_COMMIT_REJECTED (task 6.6) is terminal TERMINAL_COMMIT_REJECTED', async () => {
      const event = await failWith(
        'Fabric transaction failed: FABRIC_COMMIT_REJECTED: validation code 10 (ENDORSEMENT_POLICY_FAILURE)'
      )
      expect(event.status).toBe('failed')
      expect(event.errorCode).toBe('TERMINAL_COMMIT_REJECTED')
      expect(event.nextRetryAt).toBeNull()
    })

    it('falls back to legacy matching for an unknown ERR_ code', async () => {
      const event = await failWith('ERR_SOMETHING_NEW: Gateway timeout')
      expect(event.status).toBe('pending')
    })
  })

  describe('10. PROP-399 D12 new-action dispatch', () => {
    const HASH = 'c'.repeat(64)
    const ISO = '2026-10-02T03:04:05.000Z'

    function pendingWith(
      action: string,
      args: string[]
    ): { event: LedgerOutbox } {
      const event = {
        _id: new ObjectId(),
        status: 'pending',
        attempts: 0,
        nextRetryAt: new Date(Date.now() - 1000),
        dependencyKey: null,
        payload: { action, args },
      } as unknown as LedgerOutbox
      repository.find.mockResolvedValue([event])
      repository.findOne.mockResolvedValue(event)
      return { event }
    }

    it.each([
      ['publishGovernanceSnapshot', ['snap-1', '1', HASH, '1']],
      ['recordMoveInSettlement', ['s-1', 'c-1', HASH, '1', ISO]],
      ['recordHandover', ['s-1', 'c-1', HASH, '1', '1', 'false', ISO]],
    ])('submits well-formed %s args unchanged', async (action, args) => {
      pendingWith(action, args)
      await service.processPending(1)
      expect(fabricService.submitTransaction).toHaveBeenCalledWith(
        action,
        args,
        undefined
      )
    })

    it.each([
      ['publishGovernanceSnapshot', ['snap-1', '1', 'not-a-hash', '1']],
      ['recordMoveInSettlement', ['s-1', 'c-1', HASH, '1']],
      ['recordHandover', ['s-1', 'c-1', HASH, '1', '0', 'false', ISO]],
    ])(
      'goes terminal without submitting malformed %s args',
      async (action, args) => {
        const { event } = pendingWith(action, args)
        await expect(service.processPending(1)).resolves.toBe(1)

        expect(fabricService.submitTransaction).not.toHaveBeenCalled()
        expect(event.status).toBe('failed')
        expect(event.errorCode).toBe('LEDGER_ARGS_INVALID')
        expect(event.nextRetryAt).toBeNull()
        expect(projectionService.projectFailure).toHaveBeenCalledWith(event)
      }
    )

    it('goes terminal without submitting an unknown action', async () => {
      const { event } = pendingWith('dropAllTables', [])
      await expect(service.processPending(1)).resolves.toBe(1)

      expect(fabricService.submitTransaction).not.toHaveBeenCalled()
      expect(event.status).toBe('failed')
      expect(event.errorCode).toBe('LEDGER_ACTION_UNKNOWN')
    })

    it('goes terminal when the payload has no action or non-array args', async () => {
      const { event } = pendingWith('', [])
      ;(event.payload as { args: unknown }).args = 'nope'
      await service.processPending(1)
      expect(fabricService.submitTransaction).not.toHaveBeenCalled()
      expect(event.status).toBe('failed')
    })
  })

  describe('11. PROP-399 D2 evidence-schema capability wait', () => {
    function activation(metadata: Record<string, unknown>): LedgerOutbox {
      const event = {
        _id: new ObjectId(),
        status: 'pending',
        attempts: 0,
        nextRetryAt: new Date(Date.now() - 1000),
        dependencyKey: null,
        payload: { action: 'createContract', args: ['c-1'], metadata },
      } as unknown as LedgerOutbox
      repository.find.mockResolvedValue([event])
      repository.findOne.mockResolvedValue(event)
      return event
    }

    it('waits with CHAINCODE_UPGRADE_REQUIRED while the chaincode does not advertise the needed evidence schema', async () => {
      const event = activation({
        minimumEvidenceSchemaVersion: 3,
        waitingCode: 'CHAINCODE_UPGRADE_REQUIRED',
      })
      ;(
        fabricService as unknown as {
          supportsEvidenceSchemaVersion: jest.Mock
        }
      ).supportsEvidenceSchemaVersion = jest.fn(() => false)

      await expect(service.processPending(1)).resolves.toBe(0)

      expect(event.status).toBe('pending')
      expect(event.errorCode).toBe('CHAINCODE_UPGRADE_REQUIRED')
      expect(fabricService.submitTransaction).not.toHaveBeenCalled()
    })

    it('submits once the chaincode advertises the evidence schema', async () => {
      activation({ minimumEvidenceSchemaVersion: 3 })
      const supports = jest.fn(() => true)
      ;(
        fabricService as unknown as {
          supportsEvidenceSchemaVersion: jest.Mock
        }
      ).supportsEvidenceSchemaVersion = supports

      await service.processPending(1)

      expect(supports).toHaveBeenCalledWith(3)
      expect(fabricService.submitTransaction).toHaveBeenCalled()
    })
  })
})
