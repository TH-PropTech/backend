import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ObjectId } from 'mongodb'
import {
  ReconciliationFindingResponseDto,
  ReconciliationFindingsQueryDto,
  ReconciliationRunIdParamDto,
  ReconciliationRunResponseDto,
  RepairFindingDto,
  StartReconciliationRunDto,
} from './ledger-reconciliation.dto'

async function invalid<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>
): Promise<string[]> {
  return (await validate(plainToInstance(cls, plain))).map(e => e.property)
}

describe('ledger-reconciliation DTOs (PROP-399 task 8.5)', () => {
  describe('StartReconciliationRunDto', () => {
    it('accepts a bounded date range with event types and an explicit contract set', async () => {
      expect(
        await invalid(StartReconciliationRunDto, {
          from: '2026-10-01T00:00:00.000Z',
          to: '2026-10-31T00:00:00.000Z',
          eventTypes: ['handover.completed', 'governance.published'],
          contractIds: [new ObjectId().toHexString()],
        })
      ).toEqual([])
      // Scope presence itself is enforced by the service (RECONCILIATION_SCOPE_REQUIRED).
      expect(await invalid(StartReconciliationRunDto, {})).toEqual([])
    })

    it.each([
      [{ from: 'yesterday' }, 'from'],
      [{ to: 'tomorrow' }, 'to'],
      [{ eventTypes: ['drop.table'] }, 'eventTypes'],
      [{ eventTypes: 'payment.paid' }, 'eventTypes'],
      [{ contractIds: ['nope'] }, 'contractIds'],
      [{ contractIds: 'x' }, 'contractIds'],
      [
        {
          contractIds: Array.from({ length: 501 }, () =>
            new ObjectId().toHexString()
          ),
        },
        'contractIds',
      ],
    ])('rejects %j', async (plain, property) => {
      expect(await invalid(StartReconciliationRunDto, plain)).toContain(
        property
      )
    })
  })

  describe('RepairFindingDto', () => {
    it('requires a reason of 5..500 characters', async () => {
      expect(
        await invalid(RepairFindingDto, { reason: 'valid reason' })
      ).toEqual([])
      expect(await invalid(RepairFindingDto, {})).toEqual(['reason'])
      expect(await invalid(RepairFindingDto, { reason: 'abcd' })).toEqual([
        'reason',
      ])
      expect(
        await invalid(RepairFindingDto, { reason: 'x'.repeat(501) })
      ).toEqual(['reason'])
      expect(await invalid(RepairFindingDto, { reason: 42 })).toEqual([
        'reason',
      ])
    })
  })

  describe('queries and params', () => {
    it('defaults pagination and validates category/status filters', async () => {
      const dto = plainToInstance(ReconciliationFindingsQueryDto, {})
      expect(dto).toMatchObject({ page: 1, limit: 20 })
      expect(await validate(dto)).toHaveLength(0)
      expect(
        await invalid(ReconciliationFindingsQueryDto, {
          category: 'hash_schema_mismatch',
          status: 'open',
        })
      ).toEqual([])
      expect(
        await invalid(ReconciliationFindingsQueryDto, { category: 'weird' })
      ).toContain('category')
      expect(
        await invalid(ReconciliationFindingsQueryDto, { status: 'done' })
      ).toContain('status')
      expect(
        await invalid(ReconciliationFindingsQueryDto, { limit: '101' })
      ).toContain('limit')
    })

    it('requires an ObjectId path parameter', async () => {
      expect(
        await invalid(ReconciliationRunIdParamDto, {
          id: new ObjectId().toHexString(),
        })
      ).toEqual([])
      expect(await invalid(ReconciliationRunIdParamDto, { id: 'x' })).toEqual([
        'id',
      ])
    })
  })

  describe('response mapping (sanitized)', () => {
    const runEntity = {
      _id: new ObjectId(),
      scopeHash: 'secret-looking-hash',
      scope: {
        from: new Date('2026-10-01T00:00:00.000Z'),
        to: new Date('2026-10-31T00:00:00.000Z'),
        contractIds: ['a'.repeat(24), 'b'.repeat(24)],
        eventTypes: ['payment.paid'],
      },
      status: 'running',
      checkpoint: {
        eventType: 'orphan-scan:GOVERNANCE_',
        lastAggregateId: 'OPAQUE-FABRIC-BOOKMARK',
      },
      counters: { examined: 3, consistent: 2, findings: 1, unverifiable: 0 },
      requestedBy: 'admin-1',
      startedAt: new Date('2026-10-02T00:00:00.000Z'),
      completedAt: null,
      lastErrorCode: null,
      createdAt: new Date('2026-10-02T00:00:00.000Z'),
      updatedAt: new Date('2026-10-02T00:00:01.000Z'),
    }

    it('exposes the run without scope contract ids, scope hash or the opaque Fabric bookmark', () => {
      const dto = ReconciliationRunResponseDto.fromEntity(runEntity as never)
      expect(dto).toEqual({
        id: runEntity._id.toHexString(),
        scope: {
          from: '2026-10-01T00:00:00.000Z',
          to: '2026-10-31T00:00:00.000Z',
          contractCount: 2,
          eventTypes: ['payment.paid'],
        },
        status: 'running',
        checkpointPhase: 'orphan-scan:GOVERNANCE_',
        counters: { examined: 3, consistent: 2, findings: 1, unverifiable: 0 },
        requestedBy: 'admin-1',
        startedAt: '2026-10-02T00:00:00.000Z',
        completedAt: null,
        lastErrorCode: null,
        createdAt: '2026-10-02T00:00:00.000Z',
      })
      const serialized = JSON.stringify(dto)
      expect(serialized).not.toContain('OPAQUE-FABRIC-BOOKMARK')
      expect(serialized).not.toContain('secret-looking-hash')
      expect(serialized).not.toContain('a'.repeat(24))
    })

    function finding(overrides: Record<string, unknown> = {}): never {
      return {
        _id: new ObjectId(),
        runId: 'run-1',
        fingerprint: 'fp',
        contractId: 'c-1',
        aggregateType: 'governance-snapshot',
        aggregateId: new ObjectId().toHexString(),
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

    it('flags only safely repairable findings as repairable and hides the fingerprint', () => {
      expect(
        ReconciliationFindingResponseDto.fromEntity(finding()).repairable
      ).toBe(true)
      expect(
        ReconciliationFindingResponseDto.fromEntity(
          finding({ category: 'terminal_delivery_failure' })
        ).repairable
      ).toBe(true)
      for (const category of [
        'hash_schema_mismatch',
        'retryable_delivery_failure',
        'orphan_ledger_evidence',
      ]) {
        expect(
          ReconciliationFindingResponseDto.fromEntity(finding({ category }))
            .repairable
        ).toBe(false)
      }
      expect(
        ReconciliationFindingResponseDto.fromEntity(
          finding({
            eventType: 'contract.activated',
            aggregateType: 'contract',
          })
        ).repairable
      ).toBe(false)
      expect(
        ReconciliationFindingResponseDto.fromEntity(
          finding({ status: 'resolved' })
        ).repairable
      ).toBe(false)
      expect(
        JSON.stringify(ReconciliationFindingResponseDto.fromEntity(finding()))
      ).not.toContain('"fingerprint"')
    })

    it('maps repair and resolution audit trails with ISO timestamps', () => {
      const dto = ReconciliationFindingResponseDto.fromEntity(
        finding({
          status: 'repair-pending',
          recoveryOutboxId: 'o-1',
          repair: {
            actorId: 'admin-1',
            reason: 'because',
            requestedAt: new Date('2026-10-03T00:00:00.000Z'),
          },
          resolution: {
            actorId: 'system',
            reason: 'RECONCILIATION_RUN:x',
            resolvedAt: new Date('2026-10-04T00:00:00.000Z'),
          },
        })
      )
      expect(dto.repair).toEqual({
        actorId: 'admin-1',
        reason: 'because',
        requestedAt: '2026-10-03T00:00:00.000Z',
      })
      expect(dto.resolution).toEqual({
        actorId: 'system',
        reason: 'RECONCILIATION_RUN:x',
        resolvedAt: '2026-10-04T00:00:00.000Z',
      })
      expect(dto.recoveryOutboxId).toBe('o-1')
    })
  })
})
