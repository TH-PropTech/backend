import {
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ObjectId } from 'mongodb'
import { FabricController } from './fabric.controller'
import { RolesGuard } from '../../../common/guards/roles.guard'

function runEntity(overrides: Record<string, unknown> = {}): never {
  return {
    _id: new ObjectId(),
    scopeHash: 'hash',
    scope: {
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-10-02T00:00:00.000Z'),
    },
    status: 'queued',
    checkpoint: null,
    counters: { examined: 0, consistent: 0, findings: 0, unverifiable: 0 },
    requestedBy: 'admin-1',
    startedAt: null,
    completedAt: null,
    lastErrorCode: null,
    createdAt: new Date('2026-10-02T00:00:00.000Z'),
    ...overrides,
  } as never
}

function findingEntity(overrides: Record<string, unknown> = {}): never {
  return {
    _id: new ObjectId(),
    runId: 'run-1',
    fingerprint: 'secret-fingerprint',
    contractId: null,
    aggregateType: 'governance-snapshot',
    aggregateId: 'agg-1',
    eventType: 'governance.published',
    category: 'missing_delivery_work',
    expectedHash: 'a'.repeat(64),
    observedHash: null,
    status: 'open',
    recoveryOutboxId: null,
    resolution: null,
    repair: null,
    firstSeenAt: new Date('2026-10-02T00:00:00.000Z'),
    lastSeenAt: new Date('2026-10-02T00:00:00.000Z'),
    ...overrides,
  } as never
}

describe('FabricController reconciliation routes (PROP-399 task 8.5)', () => {
  let service: {
    startRun: jest.Mock
    listRuns: jest.Mock
    getRun: jest.Mock
    listFindings: jest.Mock
    resumeRun: jest.Mock
    cancelRun: jest.Mock
    repairFinding: jest.Mock
  }
  let controller: FabricController

  beforeEach(() => {
    service = {
      startRun: jest.fn(),
      listRuns: jest.fn(),
      getRun: jest.fn(),
      listFindings: jest.fn(),
      resumeRun: jest.fn(),
      cancelRun: jest.fn(),
      repairFinding: jest.fn(),
    }
    controller = new FabricController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      service as never
    )
  })

  it('start: passes the DTO and the admin actor and returns a sanitized run', async () => {
    service.startRun.mockResolvedValue(runEntity())
    const dto = {
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-02T00:00:00.000Z',
      eventTypes: ['governance.published'],
    }
    const result = await controller.startReconciliationRun(dto, 'admin-1')
    expect(service.startRun).toHaveBeenCalledWith(dto, {
      id: 'admin-1',
      role: 'admin',
    })
    expect(result).toMatchObject({ status: 'queued', requestedBy: 'admin-1' })
    expect(Object.keys(result)).not.toContain('scopeHash')
  })

  it.each([
    [
      'RECONCILIATION_SCOPE_REQUIRED',
      new ConflictException({ code: 'RECONCILIATION_SCOPE_REQUIRED' }),
    ],
    [
      'RECONCILIATION_SCOPE_LOCKED',
      new ConflictException({ code: 'RECONCILIATION_SCOPE_LOCKED' }),
    ],
  ])('start: propagates the stable error %s', async (_code, error) => {
    service.startRun.mockRejectedValue(error)
    await expect(controller.startReconciliationRun({}, 'admin-1')).rejects.toBe(
      error
    )
  })

  it('list: paginates run summaries', async () => {
    service.listRuns.mockResolvedValue({
      items: [runEntity()],
      total: 41,
      page: 2,
      limit: 20,
      totalPages: 3,
    })
    const page = await controller.listReconciliationRuns({ page: 2, limit: 20 })
    expect(service.listRuns).toHaveBeenCalledWith({ page: 2, limit: 20 })
    expect(page).toMatchObject({ total: 41, page: 2, limit: 20, totalPages: 3 })
    expect(page.items).toHaveLength(1)
  })

  it('detail: returns the run and surfaces not-found', async () => {
    service.getRun.mockResolvedValue(runEntity({ status: 'completed' }))
    await expect(
      controller.getReconciliationRun({ id: new ObjectId().toHexString() })
    ).resolves.toMatchObject({ status: 'completed' })
    service.getRun.mockRejectedValue(
      new NotFoundException({ code: 'RECONCILIATION_RUN_NOT_FOUND' })
    )
    await expect(
      controller.getReconciliationRun({ id: new ObjectId().toHexString() })
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('findings: forwards filters and returns sanitized findings (no fingerprint)', async () => {
    service.listFindings.mockResolvedValue({
      items: [
        findingEntity(),
        findingEntity({ category: 'hash_schema_mismatch' }),
      ],
      total: 2,
      page: 1,
      limit: 20,
      totalPages: 1,
    })
    const id = new ObjectId().toHexString()
    const page = await controller.listReconciliationFindings(
      { id },
      { page: 1, limit: 20, category: 'hash_schema_mismatch', status: 'open' }
    )
    expect(service.listFindings).toHaveBeenCalledWith(id, {
      page: 1,
      limit: 20,
      category: 'hash_schema_mismatch',
      status: 'open',
    })
    expect(page.items.map(item => item.repairable)).toEqual([true, false])
    expect(JSON.stringify(page)).not.toContain('secret-fingerprint')
  })

  it('resume and cancel: delegate as the admin actor', async () => {
    service.resumeRun.mockResolvedValue(runEntity({ status: 'queued' }))
    service.cancelRun.mockResolvedValue(runEntity({ status: 'cancelled' }))
    const id = new ObjectId().toHexString()
    await expect(
      controller.resumeReconciliationRun({ id }, 'admin-1')
    ).resolves.toMatchObject({ status: 'queued' })
    expect(service.resumeRun).toHaveBeenCalledWith(id, {
      id: 'admin-1',
      role: 'admin',
    })
    await expect(
      controller.cancelReconciliationRun({ id }, 'admin-1')
    ).resolves.toMatchObject({ status: 'cancelled' })
    expect(service.cancelRun).toHaveBeenCalledWith(id, {
      id: 'admin-1',
      role: 'admin',
    })
  })

  it('resume/cancel: surface the stable 409 codes', async () => {
    const error = new ConflictException({
      code: 'RECONCILIATION_RUN_NOT_RESUMABLE',
    })
    service.resumeRun.mockRejectedValue(error)
    await expect(
      controller.resumeReconciliationRun(
        { id: new ObjectId().toHexString() },
        'admin-1'
      )
    ).rejects.toBe(error)
  })

  it('repair: requires the reason, links the outbox item and returns the sanitized finding', async () => {
    service.repairFinding.mockResolvedValue({
      finding: findingEntity({
        status: 'repair-pending',
        recoveryOutboxId: 'o-1',
      }),
      outboxId: 'o-1',
      alreadyRepaired: false,
    })
    const id = new ObjectId().toHexString()
    const result = await controller.repairReconciliationFinding(
      { id },
      { reason: 'ledger back online' },
      'admin-1'
    )
    expect(service.repairFinding).toHaveBeenCalledWith(
      id,
      { id: 'admin-1', role: 'admin' },
      'ledger back online'
    )
    expect(result).toMatchObject({
      outboxId: 'o-1',
      alreadyRepaired: false,
      finding: { status: 'repair-pending', recoveryOutboxId: 'o-1' },
    })
  })

  it.each([
    'LEDGER_FINDING_NOT_REPAIRABLE',
    'LEDGER_FINDING_PRECONDITION_STALE',
  ])('repair: propagates %s untouched', async code => {
    const error = new ConflictException({ code })
    service.repairFinding.mockRejectedValue(error)
    await expect(
      controller.repairReconciliationFinding(
        { id: new ObjectId().toHexString() },
        { reason: 'valid reason' },
        'admin-1'
      )
    ).rejects.toBe(error)
  })

  describe('role matrix over the real @Roles metadata (D13)', () => {
    const guard = new RolesGuard(new Reflector())
    const proto = FabricController.prototype as unknown as Record<
      string,
      () => unknown
    >
    const allows = (handler: string, roles: string[]): boolean => {
      try {
        return guard.canActivate({
          getHandler: (): (() => unknown) | undefined => proto[handler],
          getClass: (): unknown => FabricController,
          switchToHttp: (): unknown => ({
            getRequest: (): unknown => ({ user: { roles } }),
          }),
        } as unknown as ExecutionContext)
      } catch (error) {
        if (error instanceof ForbiddenException) return false
        throw error
      }
    }

    it.each([
      'startReconciliationRun',
      'resumeReconciliationRun',
      'cancelReconciliationRun',
      'repairReconciliationFinding',
    ])('%s is admin-only (staff, tenant and landlord get 403)', handler => {
      expect(allows(handler, ['admin'])).toBe(true)
      expect(allows(handler, ['staff'])).toBe(false)
      expect(allows(handler, ['tenant'])).toBe(false)
      expect(allows(handler, ['landlord'])).toBe(false)
    })

    it.each([
      'listReconciliationRuns',
      'getReconciliationRun',
      'listReconciliationFindings',
    ])(
      '%s is readable by admin and staff but not by tenant/landlord',
      handler => {
        expect(allows(handler, ['admin'])).toBe(true)
        expect(allows(handler, ['staff'])).toBe(true)
        expect(allows(handler, ['tenant'])).toBe(false)
        expect(allows(handler, ['landlord'])).toBe(false)
      }
    )
  })
})
