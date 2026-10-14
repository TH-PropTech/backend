import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { LedgerReconciliationService } from './ledger-reconciliation.service'
import { memoryRepository } from '../utils/fabric-memory-repository.fixtures'
import { MoveInSettlementsService } from '../../rental/services/move-in-settlements.service'

type Row = Record<string, unknown>
const HASH = 'a'.repeat(64)
const OTHER_HASH = 'b'.repeat(64)
const ADMIN = { id: 'admin-1', role: 'admin' }
const STAFF = { id: 'staff-1', role: 'staff' }
const RANGE = {
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-10-31T00:00:00.000Z',
}

function oid(): ObjectId {
  return new ObjectId()
}

function snapshot(overrides: Row = {}): Row {
  return {
    _id: oid(),
    status: 'published',
    manifestHash: HASH,
    ledgerStatus: 'confirmed-fabric',
    createdAt: new Date('2026-10-05T00:00:00.000Z'),
    ...overrides,
  }
}

function outboxItem(
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  overrides: Row = {}
): Row {
  return {
    _id: oid(),
    aggregateType,
    aggregateId,
    eventType,
    status: 'confirmed',
    attempts: 1,
    txHash: 'tx-real',
    ...overrides,
  }
}

function settlement(overrides: Row = {}): Row {
  return {
    _id: oid(),
    contractId: new ObjectId().toHexString(),
    status: 'paid',
    createdAt: new Date('2026-10-05T00:00:00.000Z'),
    settlementEvidence: {
      manifestHash: HASH,
      ledgerStatus: 'confirmed-fabric',
    },
    handover: null,
    handoverEvidence: null,
    ...overrides,
  }
}

type Ctx = ReturnType<typeof setup>

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setup(
  data: {
    snapshots?: Row[]
    settlements?: Row[]
    payments?: Row[]
    outbox?: Row[]
    findings?: Row[]
    runs?: Row[]
    mode?: 'fabric' | 'simulation'
    config?: Record<string, unknown>
  } = {}
) {
  const runs = memoryRepository<Row>(data.runs ?? [])
  const findings = memoryRepository<Row>(data.findings ?? [])
  const outbox = memoryRepository<Row>(data.outbox ?? [])
  const contracts = memoryRepository<Row>([])
  const deposits = memoryRepository<Row>([])
  const payments = memoryRepository<Row>(data.payments ?? [])
  const settlements = memoryRepository<Row>(data.settlements ?? [])
  const snapshots = memoryRepository<Row>(data.snapshots ?? [])
  const fabric = {
    getStatus: jest.fn(() => ({ mode: data.mode ?? 'fabric' })),
    evaluateTransaction: jest.fn(),
  }
  const outboxService = { retryTerminal: jest.fn() }
  const governance = { ensureLedgerEvidenceQueued: jest.fn() }
  const moveIn = {
    ensureSettlementEvidenceQueued: jest.fn(),
    ensureHandoverEvidenceQueued: jest.fn(),
  }
  const config = {
    get: jest.fn((key: string) => data.config?.[key]),
  }
  const moduleRef = {
    get: jest.fn((token: unknown) => {
      if (token === MoveInSettlementsService) return moveIn
      throw new Error('unexpected token')
    }),
  }
  const service = new LedgerReconciliationService(
    runs as never,
    findings as never,
    outbox as never,
    contracts as never,
    deposits as never,
    payments as never,
    settlements as never,
    snapshots as never,
    fabric as never,
    outboxService as never,
    governance as never,
    config as never,
    moduleRef as never
  )
  return {
    service,
    runs,
    findings,
    outbox,
    payments,
    settlements,
    snapshots,
    fabric,
    outboxService,
    governance,
    moveIn,
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function runOnce(
  ctx: Ctx,
  scope: Record<string, unknown> = {
    ...RANGE,
    eventTypes: ['governance.published'],
  }
) {
  const run = await ctx.service.startRun(scope, ADMIN, { process: false })
  return ctx.service.processRun(run._id.toHexString())
}

describe('LedgerReconciliationService (PROP-399 tasks 8.1-8.4)', () => {
  describe('bounded scope validation and locking', () => {
    it.each([
      ['no scope at all', {}],
      ['event types only', { eventTypes: ['governance.published'] }],
      ['only one date bound', { from: RANGE.from }],
      ['empty contract set', { contractIds: [] }],
    ])(
      'rejects %s with RECONCILIATION_SCOPE_REQUIRED and performs no ledger scan',
      async (_l, scope) => {
        const ctx = setup()
        const error = await ctx.service
          .startRun(scope, ADMIN, { process: false })
          .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(BadRequestException)
        expect((error as BadRequestException).getResponse()).toMatchObject({
          code: 'RECONCILIATION_SCOPE_REQUIRED',
        })
        expect(ctx.runs.save).not.toHaveBeenCalled()
        expect(ctx.fabric.evaluateTransaction).not.toHaveBeenCalled()
      }
    )

    it.each([
      ['inverted range', { from: RANGE.to, to: RANGE.from }],
      [
        'range wider than 92 days',
        { from: '2026-01-01T00:00:00.000Z', to: '2026-12-31T00:00:00.000Z' },
      ],
      ['unparseable date', { from: 'x', to: RANGE.to }],
      ['unknown event type', { ...RANGE, eventTypes: ['drop.everything'] }],
      ['malformed contract id', { contractIds: ['not-an-object-id'] }],
    ])('rejects %s with RECONCILIATION_SCOPE_INVALID', async (_l, scope) => {
      const ctx = setup()
      const error = await ctx.service
        .startRun(scope, ADMIN, { process: false })
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(BadRequestException)
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'RECONCILIATION_SCOPE_INVALID',
      })
    })

    it('limits the explicit contract set to the configured maximum', async () => {
      const ctx = setup({ config: { 'fabric.reconciliation.maxContracts': 2 } })
      const ids = [oid(), oid(), oid()].map(id => id.toHexString())
      await expect(
        ctx.service.startRun({ contractIds: ids }, ADMIN, { process: false })
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        ctx.service.startRun({ contractIds: ids.slice(0, 2) }, ADMIN, {
          process: false,
        })
      ).resolves.toBeDefined()
    })

    it('persists a queued run with scope, requester and a stable scopeHash', async () => {
      const ctx = setup()
      const run = await ctx.service.startRun(
        { ...RANGE, eventTypes: ['handover.completed', 'move-in.settled'] },
        ADMIN,
        { process: false }
      )
      expect(run).toMatchObject({
        status: 'queued',
        requestedBy: 'admin-1',
        checkpoint: null,
        counters: { examined: 0, consistent: 0, findings: 0, unverifiable: 0 },
        startedAt: null,
        completedAt: null,
      })
      expect(run.scopeHash).toMatch(/^[a-f0-9]{64}$/)
      expect(run.scope.from).toEqual(new Date(RANGE.from))
      // event type order must not change the scope identity
      const reordered = await setup().service.startRun(
        { ...RANGE, eventTypes: ['move-in.settled', 'handover.completed'] },
        ADMIN,
        { process: false }
      )
      expect(reordered.scopeHash).toBe(run.scopeHash)
    })

    it('denies staff for start, resume and cancel (admin-only per D13)', async () => {
      const ctx = setup()
      await expect(
        ctx.service.startRun(RANGE, STAFF, { process: false })
      ).rejects.toBeInstanceOf(ForbiddenException)
      const run = await ctx.service.startRun(RANGE, ADMIN, { process: false })
      const id = run._id.toHexString()
      await expect(
        ctx.service.resumeRun(id, STAFF, { process: false })
      ).rejects.toBeInstanceOf(ForbiddenException)
      await expect(ctx.service.cancelRun(id, STAFF)).rejects.toBeInstanceOf(
        ForbiddenException
      )
      expect(ctx.runs.rows).toHaveLength(1)
    })

    it('prevents a second active run for the same scope but allows it after completion', async () => {
      const ctx = setup()
      const first = await ctx.service.startRun(RANGE, ADMIN, { process: false })
      const error = await ctx.service
        .startRun(RANGE, ADMIN, { process: false })
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ConflictException)
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'RECONCILIATION_SCOPE_LOCKED',
      })
      await expect(
        ctx.service.startRun(
          { ...RANGE, eventTypes: ['payment.paid'] },
          ADMIN,
          { process: false }
        )
      ).resolves.toBeDefined()

      await ctx.service.processRun(first._id.toHexString())
      await expect(
        ctx.service.startRun(RANGE, ADMIN, { process: false })
      ).resolves.toBeDefined()
    })
  })

  describe('three-source comparison and finding categories', () => {
    function governanceCase(options: {
      projection?: string
      outbox?: Row | null
      ledger?: unknown
    }): Ctx {
      const snap = snapshot({
        ledgerStatus: options.projection ?? 'confirmed-fabric',
      })
      const id = (snap._id as ObjectId).toHexString()
      const ctx = setup({
        snapshots: [snap],
        outbox:
          options.outbox === null
            ? []
            : [
                outboxItem(
                  'governance-snapshot',
                  id,
                  'governance.published',
                  options.outbox ?? {}
                ),
              ],
      })
      if (options.ledger instanceof Error) {
        ctx.fabric.evaluateTransaction.mockRejectedValue(options.ledger)
      } else {
        ctx.fabric.evaluateTransaction.mockResolvedValue(
          options.ledger ?? { manifestHash: HASH }
        )
      }
      return ctx
    }

    const scope = { ...RANGE, eventTypes: ['governance.published'] }

    it('counts an event as consistent when delivery, projection and Fabric agree', async () => {
      const ctx = governanceCase({})
      const run = await runOnce(ctx, scope)
      expect(run.counters).toEqual({
        examined: 1,
        consistent: 1,
        findings: 0,
        unverifiable: 0,
      })
      expect(run.status).toBe('completed')
      expect(ctx.findings.rows).toHaveLength(0)
      expect(ctx.fabric.evaluateTransaction).toHaveBeenCalledWith(
        'readGovernanceSnapshot',
        [(ctx.snapshots.rows[0]?._id as ObjectId).toHexString()]
      )
    })

    it('missing_delivery_work: expected event without an outbox item (key + hash only, no PII)', async () => {
      const ctx = governanceCase({ projection: 'pending', outbox: null })
      const run = await runOnce(ctx, scope)
      expect(run.status).toBe('completed-with-findings')
      expect(ctx.findings.rows).toHaveLength(1)
      expect(ctx.findings.rows[0]).toMatchObject({
        category: 'missing_delivery_work',
        aggregateType: 'governance-snapshot',
        eventType: 'governance.published',
        expectedHash: HASH,
        status: 'open',
        recoveryOutboxId: null,
      })
      expect(ctx.fabric.evaluateTransaction).not.toHaveBeenCalledWith(
        'readGovernanceSnapshot',
        expect.anything()
      )
    })

    it('orphan_local_projection: projection claims confirmation but no outbox item exists', async () => {
      const ctx = governanceCase({
        projection: 'confirmed-fabric',
        outbox: null,
      })
      await runOnce(ctx, scope)
      expect(ctx.findings.rows[0]).toMatchObject({
        category: 'orphan_local_projection',
      })
    })

    it('terminal_delivery_failure and retryable_delivery_failure; an in-flight first attempt is not a finding', async () => {
      const terminal = governanceCase({
        projection: 'pending',
        outbox: { status: 'failed', attempts: 5 },
      })
      await runOnce(terminal, scope)
      expect(terminal.findings.rows[0]).toMatchObject({
        category: 'terminal_delivery_failure',
      })

      const retryable = governanceCase({
        projection: 'pending',
        outbox: { status: 'pending', attempts: 2 },
      })
      await runOnce(retryable, scope)
      expect(retryable.findings.rows[0]).toMatchObject({
        category: 'retryable_delivery_failure',
      })

      const inFlight = governanceCase({
        projection: 'pending',
        outbox: { status: 'pending', attempts: 0 },
      })
      const run = await runOnce(inFlight, scope)
      expect(inFlight.findings.rows).toHaveLength(0)
      expect(run.counters).toMatchObject({ examined: 1, findings: 0 })
    })

    it('missing_local_projection: delivery confirmed but the read model still says pending', async () => {
      const ctx = governanceCase({ projection: 'pending' })
      await runOnce(ctx, scope)
      expect(ctx.findings.rows[0]).toMatchObject({
        category: 'missing_local_projection',
      })
    })

    it('missing_ledger_evidence only when Fabric definitively answers not-found', async () => {
      const ctx = governanceCase({
        ledger: new Error(
          'Fabric query failed: ERR_NOT_FOUND: governance snapshot does not exist'
        ),
      })
      await runOnce(ctx, scope)
      expect(ctx.findings.rows[0]).toMatchObject({
        category: 'missing_ledger_evidence',
        expectedHash: HASH,
      })
    })

    it('hash_schema_mismatch carries expected and observed hashes and is never auto-repairable', async () => {
      const ctx = governanceCase({ ledger: { manifestHash: OTHER_HASH } })
      await runOnce(ctx, scope)
      expect(ctx.findings.rows[0]).toMatchObject({
        category: 'hash_schema_mismatch',
        expectedHash: HASH,
        observedHash: OTHER_HASH,
      })
    })

    it('unverifiable (not missing) when Fabric cannot be queried, and the run records the degraded ledger', async () => {
      const ctx = governanceCase({
        ledger: new Error(
          'FABRIC_GATEWAY_UNAVAILABLE: Gateway connection is unavailable'
        ),
      })
      const run = await runOnce(ctx, scope)
      expect(ctx.findings.rows[0]).toMatchObject({ category: 'unverifiable' })
      expect(
        ctx.findings.rows.some(
          row => row.category === 'missing_ledger_evidence'
        )
      ).toBe(false)
      expect(run.counters.unverifiable).toBe(1)
      expect(run.lastErrorCode).toBe('FABRIC_UNAVAILABLE')
    })

    it('stops querying Fabric after the first connection failure within a run', async () => {
      const snaps = [snapshot(), snapshot(), snapshot()]
      const ctx = setup({
        snapshots: snaps,
        outbox: snaps.map(s =>
          outboxItem(
            'governance-snapshot',
            (s._id as ObjectId).toHexString(),
            'governance.published'
          )
        ),
      })
      ctx.fabric.evaluateTransaction.mockRejectedValue(
        new Error('FABRIC_GATEWAY_UNAVAILABLE: x')
      )
      const run = await runOnce(ctx, scope)
      expect(ctx.fabric.evaluateTransaction).toHaveBeenCalledTimes(1)
      expect(run.counters.unverifiable).toBe(3)
    })

    it('is honest in simulation: no Fabric calls, counted unverifiable, no fake findings', async () => {
      const snap = snapshot({ ledgerStatus: 'confirmed-simulation' })
      const ctx = setup({
        mode: 'simulation',
        snapshots: [snap],
        outbox: [
          outboxItem(
            'governance-snapshot',
            (snap._id as ObjectId).toHexString(),
            'governance.published'
          ),
        ],
      })
      const run = await runOnce(ctx, scope)
      expect(ctx.fabric.evaluateTransaction).not.toHaveBeenCalled()
      expect(run.counters).toMatchObject({
        examined: 1,
        consistent: 0,
        unverifiable: 1,
        findings: 0,
      })
      expect(ctx.findings.rows).toHaveLength(0)
      expect(run.lastErrorCode).toBe('FABRIC_SIMULATION_MODE')
    })

    it('compares families without a direct ledger read (payments) on delivery and projection only', async () => {
      const payment = {
        _id: oid(),
        status: 'paid',
        paymentHash: HASH,
        ledgerStatus: 'confirmed',
        contractId: 'c-1',
        paidAt: new Date('2026-10-05T00:00:00.000Z'),
      }
      const ctx = setup({
        payments: [payment],
        outbox: [
          outboxItem('payment', payment._id.toHexString(), 'payment.paid'),
        ],
      })
      const run = await runOnce(ctx, { ...RANGE, eventTypes: ['payment.paid'] })
      expect(run.counters).toMatchObject({ examined: 1, consistent: 1 })
      const actions = (
        ctx.fabric.evaluateTransaction.mock.calls as unknown as Array<[string]>
      ).map(([action]) => action)
      // only the bounded orphan listing may touch Fabric; there is no direct payment read
      expect(actions.every(action => action === 'listEvidenceKeys')).toBe(true)
    })

    it('uses the handover hash (not the manifest hash) when comparing handover evidence', async () => {
      const s = settlement({
        handover: {
          handoverHash: HASH,
          completedAt: new Date('2026-10-06T00:00:00.000Z'),
        },
        handoverEvidence: {
          manifestHash: OTHER_HASH,
          ledgerStatus: 'confirmed-fabric',
        },
      })
      const ctx = setup({
        settlements: [s],
        outbox: [
          outboxItem(
            'move-in-handover',
            (s._id as ObjectId).toHexString(),
            'handover.completed'
          ),
        ],
      })
      ctx.fabric.evaluateTransaction.mockResolvedValue({ handoverHash: HASH })
      const run = await runOnce(ctx, {
        ...RANGE,
        eventTypes: ['handover.completed'],
      })
      expect(run.counters.consistent).toBe(1)
      expect(ctx.fabric.evaluateTransaction).toHaveBeenCalledWith(
        'readHandover',
        [(s._id as ObjectId).toHexString()]
      )
    })
  })

  describe('paging, checkpoints, resume and cancellation', () => {
    function many(count: number): { ctx: Ctx; ids: string[] } {
      const snaps = Array.from({ length: count }, (_, index) =>
        snapshot({
          _id: new ObjectId(
            Buffer.from(`snap${String(index).padStart(8, '0')}`).subarray(0, 12)
          ),
        })
      )
      const ctx = setup({
        snapshots: snaps,
        config: { 'fabric.reconciliation.pageSize': 2 },
        outbox: snaps.map(s =>
          outboxItem(
            'governance-snapshot',
            (s._id as ObjectId).toHexString(),
            'governance.published'
          )
        ),
      })
      ctx.fabric.evaluateTransaction.mockResolvedValue({ manifestHash: HASH })
      return { ctx, ids: snaps.map(s => (s._id as ObjectId).toHexString()) }
    }
    const scope = { ...RANGE, eventTypes: ['governance.published'] }

    it('reads bounded pages and commits a checkpoint after each page', async () => {
      const { ctx, ids } = many(5)
      const run = await runOnce(ctx, scope)
      const checkpoints = (
        ctx.runs.update.mock.calls as unknown as Array<[unknown, Row]>
      )
        .map(([, patch]) => patch.checkpoint)
        .filter(Boolean)

      expect(run.counters).toEqual({
        examined: 5,
        consistent: 5,
        findings: 0,
        unverifiable: 0,
      })
      const pageSizes = ctx.snapshots.find.mock.calls.map(
        ([options]: [{ take: number }]) => options.take
      )
      expect(pageSizes.every((size: number) => size === 2)).toBe(true)
      expect(ctx.snapshots.find).toHaveBeenCalledTimes(3) // 2 + 2 + 1 (short page ends the phase)
      expect(checkpoints).toEqual(
        expect.arrayContaining([
          { eventType: 'governance.published', lastAggregateId: ids[1] },
          { eventType: 'governance.published', lastAggregateId: ids[3] },
        ])
      )
      expect(run.status).toBe('completed')
      expect(run.checkpoint).toBeNull()
    })

    it('resumes from the last committed checkpoint without recounting evaluated pages', async () => {
      const { ctx } = many(5)
      // Second page fails once.
      let failures = 1
      const realFind = ctx.outbox.findOne.getMockImplementation()!
      let calls = 0
      ctx.outbox.findOne.mockImplementation((options: unknown) => {
        calls += 1
        if (calls === 3 && failures-- > 0)
          return Promise.reject(new Error('mongo hiccup'))
        return realFind(options) as Promise<unknown>
      })
      const failed = await runOnce(ctx, scope)
      expect(failed.status).toBe('failed')
      expect(failed.lastErrorCode).toBe('RECONCILIATION_RUN_FAILED')
      expect(failed.counters.examined).toBe(2)
      expect(failed.checkpoint).toMatchObject({
        eventType: 'governance.published',
      })

      const resumed = await ctx.service.resumeRun(
        failed._id.toHexString(),
        ADMIN,
        {
          process: false,
        }
      )
      expect(resumed.status).toBe('queued')
      const done = await ctx.service.processRun(failed._id.toHexString())
      expect(done.status).toBe('completed')
      expect(done.counters.examined).toBe(5)
      expect(done.counters.consistent).toBe(5)
    })

    it('stops at the next page boundary after a cooperative cancellation', async () => {
      const { ctx } = many(5)
      let runId = ''
      let cancelled = false
      ctx.fabric.evaluateTransaction.mockImplementation(async () => {
        if (!cancelled) {
          cancelled = true
          await ctx.service.cancelRun(runId, ADMIN)
        }
        return { manifestHash: HASH }
      })
      const started = await ctx.service.startRun(scope, ADMIN, {
        process: false,
      })
      runId = started._id.toHexString()
      const run = await ctx.service.processRun(runId)
      expect(run.status).toBe('cancelled')
      expect(run.counters.examined).toBeLessThan(5)
      expect(run.counters.examined).toBeGreaterThanOrEqual(2)
    })

    it('rejects resume/cancel for runs that are not in a resumable/cancellable state', async () => {
      const ctx = setup()
      const run = await runOnce(ctx, RANGE)
      const id = run._id.toHexString()
      expect(run.status).toBe('completed')
      const resume = await ctx.service
        .resumeRun(id, ADMIN, { process: false })
        .catch((e: unknown) => e)
      expect((resume as ConflictException).getResponse()).toMatchObject({
        code: 'RECONCILIATION_RUN_NOT_RESUMABLE',
      })
      const cancel = await ctx.service
        .cancelRun(id, ADMIN)
        .catch((e: unknown) => e)
      expect((cancel as ConflictException).getResponse()).toMatchObject({
        code: 'RECONCILIATION_RUN_NOT_CANCELLABLE',
      })
      await expect(
        ctx.service.resumeRun(new ObjectId().toHexString(), ADMIN, {
          process: false,
        })
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('finding idempotency and resolution', () => {
    const scope = { ...RANGE, eventTypes: ['governance.published'] }

    it('re-running the same scope updates the logical finding instead of duplicating it', async () => {
      const snap = snapshot({ ledgerStatus: 'pending' })
      const ctx = setup({ snapshots: [snap] })
      const first = await runOnce(ctx, scope)
      const second = await runOnce(ctx, scope)

      expect(ctx.findings.rows).toHaveLength(1)
      expect(ctx.findings.rows[0]).toMatchObject({
        category: 'missing_delivery_work',
        runId: second._id.toHexString(),
      })
      expect(ctx.findings.rows[0]?.firstSeenAt).toBeInstanceOf(Date)
      expect(first._id).not.toEqual(second._id)
    })

    it('marks a previously open finding resolved (source: the run) once the record is consistent, keeping history', async () => {
      const snap = snapshot({ ledgerStatus: 'pending' })
      const ctx = setup({ snapshots: [snap] })
      await runOnce(ctx, scope)
      expect(ctx.findings.rows[0]?.status).toBe('open')

      // Fix the world.
      snap.ledgerStatus = 'confirmed-fabric'
      ctx.outbox.rows.push(
        outboxItem(
          'governance-snapshot',
          (snap._id as ObjectId).toHexString(),
          'governance.published'
        )
      )
      ctx.fabric.evaluateTransaction.mockResolvedValue({ manifestHash: HASH })
      const run = await runOnce(ctx, scope)

      expect(ctx.findings.rows[0]).toMatchObject({ status: 'resolved' })
      expect((ctx.findings.rows[0]?.resolution as Row).actorId).toBe('system')
      expect((ctx.findings.rows[0]?.resolution as Row).reason).toBe(
        `RECONCILIATION_RUN:${run._id.toHexString()}`
      )
      expect(ctx.findings.rows[0]?.firstSeenAt).toBeInstanceOf(Date)
    })

    it('records an auditable manual resolution (admin only, reason required)', async () => {
      const snap = snapshot({ ledgerStatus: 'pending' })
      const ctx = setup({ snapshots: [snap] })
      await runOnce(ctx, scope)
      const id = (ctx.findings.rows[0]?._id as ObjectId).toHexString()

      await expect(
        ctx.service.resolveFinding(
          id,
          STAFF,
          'reviewed by staff',
          'accepted-risk'
        )
      ).rejects.toBeInstanceOf(ForbiddenException)
      await expect(
        ctx.service.resolveFinding(id, ADMIN, '  ', 'resolved')
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        ctx.service.resolveFinding(
          new ObjectId().toHexString(),
          ADMIN,
          'valid reason',
          'resolved'
        )
      ).rejects.toBeInstanceOf(NotFoundException)

      const resolved = await ctx.service.resolveFinding(
        id,
        ADMIN,
        'investigated: manual fix applied',
        'accepted-risk'
      )
      expect(resolved.status).toBe('accepted-risk')
      expect(resolved.resolution).toMatchObject({
        actorId: 'admin-1',
        reason: 'investigated: manual fix applied',
      })
      expect(
        (resolved.resolution as { resolvedAt: Date }).resolvedAt
      ).toBeInstanceOf(Date)
    })
  })

  describe('orphan ledger evidence (listEvidenceKeys, never a full scan)', () => {
    it('lists only the allowlisted prefix in bounded pages and flags keys with no local owner', async () => {
      const known = snapshot()
      const knownId = (known._id as ObjectId).toHexString()
      const orphanId = new ObjectId().toHexString()
      const ctx = setup({
        snapshots: [known],
        outbox: [
          outboxItem('governance-snapshot', knownId, 'governance.published'),
        ],
        config: { 'fabric.reconciliation.pageSize': 500 },
      })
      ctx.fabric.evaluateTransaction.mockImplementation((action: string) => {
        if (action === 'listEvidenceKeys') {
          return Promise.resolve({
            keys: [
              { key: `GOVERNANCE_${knownId}`, hash: HASH },
              { key: `GOVERNANCE_${orphanId}`, hash: OTHER_HASH },
            ],
            bookmark: '',
            hasMore: false,
          })
        }
        return Promise.resolve({ manifestHash: HASH })
      })

      const run = await runOnce(ctx, {
        ...RANGE,
        eventTypes: ['governance.published'],
      })

      expect(ctx.fabric.evaluateTransaction).toHaveBeenCalledWith(
        'listEvidenceKeys',
        ['GOVERNANCE_', '100', '']
      )
      const orphans = ctx.findings.rows.filter(
        row => row.category === 'orphan_ledger_evidence'
      )
      expect(orphans).toHaveLength(1)
      expect(orphans[0]).toMatchObject({
        aggregateId: orphanId,
        observedHash: OTHER_HASH,
        expectedHash: null,
      })
      expect(run.status).toBe('completed-with-findings')
    })

    it('never runs orphan detection when the scope does not name event types', async () => {
      const ctx = setup({ snapshots: [snapshot()] })
      await runOnce(ctx, RANGE)
      expect(ctx.fabric.evaluateTransaction).not.toHaveBeenCalledWith(
        'listEvidenceKeys',
        expect.anything()
      )
    })

    it('stops at the page budget with ORPHAN_SCAN_BUDGET_EXHAUSTED -> unverifiable and a resumable bookmark', async () => {
      const ctx = setup({
        config: { 'fabric.reconciliation.orphanPageBudget': 2 },
      })
      let page = 0
      ctx.fabric.evaluateTransaction.mockImplementation(() => {
        page += 1
        return Promise.resolve({
          keys: [],
          bookmark: `b${page}`,
          hasMore: true,
        })
      })

      const run = await runOnce(ctx, {
        ...RANGE,
        eventTypes: ['governance.published'],
      })

      const listCalls = ctx.fabric.evaluateTransaction.mock.calls.filter(
        ([a]: [string]) => a === 'listEvidenceKeys'
      )
      expect(listCalls).toHaveLength(2)
      expect(run.lastErrorCode).toBe('ORPHAN_SCAN_BUDGET_EXHAUSTED')
      expect(run.counters.unverifiable).toBe(1)
      expect(run.checkpoint).toEqual({
        eventType: 'orphan-scan:GOVERNANCE_',
        lastAggregateId: 'b2',
      })
      expect(ctx.findings.rows[0]).toMatchObject({
        category: 'unverifiable',
        aggregateId: 'GOVERNANCE_',
      })

      // The position is resumable: the scan continues from the stored bookmark.
      const id = run._id.toHexString()
      await ctx.service.resumeRun(id, ADMIN, { process: false })
      ctx.fabric.evaluateTransaction.mockClear()
      ctx.fabric.evaluateTransaction.mockResolvedValue({
        keys: [],
        bookmark: '',
        hasMore: false,
      })
      const resumed = await ctx.service.processRun(id)
      expect(ctx.fabric.evaluateTransaction).toHaveBeenCalledWith(
        'listEvidenceKeys',
        ['GOVERNANCE_', '100', 'b2']
      )
      expect(resumed.lastErrorCode).toBeNull()
    })

    it('never uses getAllContracts or any action outside the direct-read/listEvidenceKeys allowlist', async () => {
      const s = settlement({
        handover: {
          handoverHash: HASH,
          completedAt: new Date('2026-10-06T00:00:00.000Z'),
        },
        handoverEvidence: {
          manifestHash: HASH,
          ledgerStatus: 'confirmed-fabric',
        },
      })
      const snap = snapshot()
      const ctx = setup({
        snapshots: [snap],
        settlements: [s],
        outbox: [
          outboxItem(
            'governance-snapshot',
            (snap._id as ObjectId).toHexString(),
            'governance.published'
          ),
          outboxItem(
            'move-in-settlement',
            (s._id as ObjectId).toHexString(),
            'move-in.settled'
          ),
          outboxItem(
            'move-in-handover',
            (s._id as ObjectId).toHexString(),
            'handover.completed'
          ),
        ],
      })
      ctx.fabric.evaluateTransaction.mockResolvedValue({
        keys: [],
        bookmark: '',
        hasMore: false,
        manifestHash: HASH,
        handoverHash: HASH,
      })
      await runOnce(ctx, {
        ...RANGE,
        eventTypes: [
          'governance.published',
          'move-in.settled',
          'handover.completed',
        ],
      })
      const actions = new Set(
        ctx.fabric.evaluateTransaction.mock.calls.map(
          ([action]: [string]) => action
        )
      )
      for (const action of actions) {
        expect([
          'readGovernanceSnapshot',
          'readMoveInSettlement',
          'readHandover',
          'readContract',
          'listEvidenceKeys',
        ]).toContain(action)
      }
      expect(actions.has('getAllContracts')).toBe(false)
    })
  })

  describe('listing', () => {
    it('lists runs newest first with pagination, loads one run and its filtered findings', async () => {
      const ctx = setup()
      const a = await runOnce(ctx, RANGE)
      const b = await runOnce(ctx, { ...RANGE, eventTypes: ['payment.paid'] })
      const page = await ctx.service.listRuns({ page: 1, limit: 1 })
      expect(page).toMatchObject({ total: 2, page: 1, limit: 1, totalPages: 2 })
      expect((page.items[0]?._id as ObjectId).toHexString()).toBe(
        b._id.toHexString()
      )
      await expect(ctx.service.getRun(a._id.toHexString())).resolves.toBe(a)
      await expect(ctx.service.getRun('nope')).rejects.toBeInstanceOf(
        NotFoundException
      )

      const snap = snapshot({ ledgerStatus: 'pending' })
      const withFindings = setup({ snapshots: [snap] })
      const run = await runOnce(withFindings, {
        ...RANGE,
        eventTypes: ['governance.published'],
      })
      const runId = run._id.toHexString()
      const findings = await withFindings.service.listFindings(runId, {
        page: 1,
        limit: 20,
      })
      expect(findings.total).toBe(1)
      const none = await withFindings.service.listFindings(runId, {
        page: 1,
        limit: 20,
        category: 'hash_schema_mismatch',
      })
      expect(none.total).toBe(0)
      await expect(
        withFindings.service.listFindings('nope', { page: 1, limit: 20 })
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('guarded repair (D7: only via outbox enqueue/retry)', () => {
    function openFinding(
      overrides: Row,
      ctxData: Parameters<typeof setup>[0] = {}
    ): { ctx: Ctx; id: string } {
      const ctx = setup(ctxData)
      const finding = {
        _id: oid(),
        runId: 'run-1',
        fingerprint: `fp-${Math.random()}`,
        contractId: null,
        aggregateType: 'governance-snapshot',
        aggregateId: new ObjectId().toHexString(),
        eventType: 'governance.published',
        category: 'missing_delivery_work',
        expectedHash: HASH,
        observedHash: null,
        status: 'open',
        recoveryOutboxId: null,
        resolution: null,
        repair: null,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        ...overrides,
      }
      ctx.findings.rows.push(finding)
      return { ctx, id: finding._id.toHexString() }
    }

    it('creates the deterministic outbox item for missing governance work and links it', async () => {
      const { ctx, id } = openFinding({})
      const created = { _id: oid() }
      ctx.governance.ensureLedgerEvidenceQueued.mockResolvedValue(created)

      const result = await ctx.service.repairFinding(
        id,
        ADMIN,
        'missing enqueue after outage'
      )

      expect(ctx.governance.ensureLedgerEvidenceQueued).toHaveBeenCalledWith(
        ctx.findings.rows[0]?.aggregateId
      )
      expect(result).toMatchObject({
        alreadyRepaired: false,
        outboxId: created._id.toHexString(),
      })
      expect(ctx.findings.rows[0]).toMatchObject({
        status: 'repair-pending',
        recoveryOutboxId: created._id.toHexString(),
        repair: { actorId: 'admin-1', reason: 'missing enqueue after outage' },
      })
    })

    it.each([
      [
        'move-in-settlement',
        'move-in.settled',
        'ensureSettlementEvidenceQueued',
      ],
      [
        'move-in-handover',
        'handover.completed',
        'ensureHandoverEvidenceQueued',
      ],
    ])(
      'delegates missing %s work to the settlement producer',
      async (aggregateType, eventType, method) => {
        const { ctx, id } = openFinding({ aggregateType, eventType })
        const created = { _id: oid() }
        ;(ctx.moveIn as Record<string, jest.Mock>)[method]?.mockResolvedValue(
          created
        )
        await ctx.service.repairFinding(id, ADMIN, 'rebuild the evidence item')
        expect(
          (ctx.moveIn as Record<string, jest.Mock>)[method]
        ).toHaveBeenCalledTimes(1)
        expect(ctx.findings.rows[0]?.status).toBe('repair-pending')
      }
    )

    it('treats a vanished business precondition as stale and leaves the finding open', async () => {
      const { ctx, id } = openFinding({})
      ctx.governance.ensureLedgerEvidenceQueued.mockResolvedValue(null)
      const error = await ctx.service
        .repairFinding(id, ADMIN, 'try the repair')
        .catch((e: unknown) => e)
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'LEDGER_FINDING_PRECONDITION_STALE',
      })
      expect(ctx.findings.rows[0]).toMatchObject({
        status: 'open',
        recoveryOutboxId: null,
      })
    })

    it('maps a hash conflict raised by the producer to a stale precondition too', async () => {
      const { ctx, id } = openFinding({
        aggregateType: 'move-in-settlement',
        eventType: 'move-in.settled',
      })
      ctx.moveIn.ensureSettlementEvidenceQueued.mockRejectedValue(
        new ConflictException('SETTLEMENT_EVIDENCE_HASH_CONFLICT')
      )
      const error = await ctx.service
        .repairFinding(id, ADMIN, 'try the repair')
        .catch((e: unknown) => e)
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'LEDGER_FINDING_PRECONDITION_STALE',
      })
    })

    it('retries a terminal delivery failure through retryTerminal without touching tx data or logs', async () => {
      const failed = outboxItem(
        'governance-snapshot',
        'agg-1',
        'governance.published',
        {
          status: 'failed',
          attempts: 5,
          txHash: null,
        }
      )
      const { ctx, id } = openFinding(
        { category: 'terminal_delivery_failure', aggregateId: 'agg-1' },
        { outbox: [failed] }
      )
      ctx.outboxService.retryTerminal.mockResolvedValue({ _id: failed._id })

      const result = await ctx.service.repairFinding(
        id,
        ADMIN,
        'ledger back online'
      )

      expect(ctx.outboxService.retryTerminal).toHaveBeenCalledWith(
        (failed._id as ObjectId).toHexString(),
        'admin'
      )
      expect(result.outboxId).toBe((failed._id as ObjectId).toHexString())
      expect(failed.txHash).toBeNull()
      expect(ctx.outbox.save).not.toHaveBeenCalled()
      expect(ctx.outbox.update).not.toHaveBeenCalled()
      expect(ctx.findings.rows[0]).toMatchObject({ status: 'repair-pending' })
    })

    it('treats a terminal finding whose item is no longer failed as stale', async () => {
      const recovered = outboxItem(
        'governance-snapshot',
        'agg-1',
        'governance.published',
        { status: 'confirmed' }
      )
      const { ctx, id } = openFinding(
        { category: 'terminal_delivery_failure', aggregateId: 'agg-1' },
        { outbox: [recovered] }
      )
      const error = await ctx.service
        .repairFinding(id, ADMIN, 'retry it')
        .catch((e: unknown) => e)
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'LEDGER_FINDING_PRECONDITION_STALE',
      })
      expect(ctx.outboxService.retryTerminal).not.toHaveBeenCalled()
    })

    it.each([
      'hash_schema_mismatch',
      'retryable_delivery_failure',
      'missing_local_projection',
      'missing_ledger_evidence',
      'orphan_local_projection',
      'orphan_ledger_evidence',
      'unverifiable',
    ])('offers no automatic repair for %s', async category => {
      const { ctx, id } = openFinding({ category })
      const error = await ctx.service
        .repairFinding(id, ADMIN, 'investigate it')
        .catch((e: unknown) => e)
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'LEDGER_FINDING_NOT_REPAIRABLE',
      })
      expect(ctx.governance.ensureLedgerEvidenceQueued).not.toHaveBeenCalled()
      expect(ctx.outboxService.retryTerminal).not.toHaveBeenCalled()
      expect(ctx.findings.rows[0]?.status).toBe('open')
    })

    it('rejects missing work for families that cannot be rebuilt safely (contract activation)', async () => {
      const { ctx, id } = openFinding({
        aggregateType: 'contract',
        eventType: 'contract.activated',
      })
      const error = await ctx.service
        .repairFinding(id, ADMIN, 'rebuild contract')
        .catch((e: unknown) => e)
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'LEDGER_FINDING_NOT_REPAIRABLE',
      })
    })

    it('is idempotent for a duplicate repair: one outbox item, the same linkage', async () => {
      const { ctx, id } = openFinding({})
      const created = { _id: oid() }
      ctx.governance.ensureLedgerEvidenceQueued.mockResolvedValue(created)
      const first = await ctx.service.repairFinding(
        id,
        ADMIN,
        'repair once please'
      )
      const second = await ctx.service.repairFinding(
        id,
        ADMIN,
        'repair twice please'
      )
      expect(ctx.governance.ensureLedgerEvidenceQueued).toHaveBeenCalledTimes(1)
      expect(second).toMatchObject({
        alreadyRepaired: true,
        outboxId: first.outboxId,
      })
    })

    it('requires a reason, the admin role and an existing, unresolved finding', async () => {
      const { ctx, id } = openFinding({})
      await expect(
        ctx.service.repairFinding(id, ADMIN, '  ')
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        ctx.service.repairFinding(id, ADMIN, 'abc')
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        ctx.service.repairFinding(id, STAFF, 'a valid reason')
      ).rejects.toBeInstanceOf(ForbiddenException)
      await expect(
        ctx.service.repairFinding(
          new ObjectId().toHexString(),
          ADMIN,
          'a valid reason'
        )
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(ctx.governance.ensureLedgerEvidenceQueued).not.toHaveBeenCalled()

      const resolved = openFinding({ status: 'resolved' })
      const error = await resolved.ctx.service
        .repairFinding(resolved.id, ADMIN, 'a valid reason')
        .catch((e: unknown) => e)
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'LEDGER_FINDING_NOT_REPAIRABLE',
      })
    })
  })
})
