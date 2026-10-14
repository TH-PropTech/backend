import { ObjectId } from 'mongodb'
import { MoveInSettlementsService } from '../../rental/services/move-in-settlements.service'
import { memoryRepository } from '../utils/fabric-memory-repository.fixtures'
import { LedgerReconciliationService } from './ledger-reconciliation.service'

type Row = Record<string, unknown>

const HASH = 'a'.repeat(64)
const OTHER_HASH = 'b'.repeat(64)
const ADMIN = { id: 'admin-integration', role: 'admin' }
const SCOPE = {
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-10-31T00:00:00.000Z',
  eventTypes: ['governance.published'],
}

type MemoryRows = ReturnType<typeof memoryRepository<Row>>

interface ReconciliationWorld {
  service: LedgerReconciliationService
  runs: MemoryRows
  findings: MemoryRows
  outbox: MemoryRows
  snapshots: MemoryRows
  fabric: {
    getStatus: jest.Mock
    evaluateTransaction: jest.Mock
  }
  governance: {
    ensureLedgerEvidenceQueued: jest.Mock
  }
}

function snapshot(overrides: Row = {}): Row {
  return {
    _id: new ObjectId(),
    status: 'published',
    manifestHash: HASH,
    ledgerStatus: 'confirmed-fabric',
    createdAt: new Date('2026-10-05T00:00:00.000Z'),
    ...overrides,
  }
}

function outboxFor(item: Row, overrides: Row = {}): Row {
  return {
    _id: new ObjectId(),
    aggregateType: 'governance-snapshot',
    aggregateId: (item._id as ObjectId).toHexString(),
    eventType: 'governance.published',
    status: 'confirmed',
    attempts: 1,
    txHash: 'tx-integration',
    ...overrides,
  }
}

function buildWorld(options: {
  snapshots?: Row[]
  outbox?: Row[]
  findings?: Row[]
  runs?: Row[]
  pageSize?: number
}): ReconciliationWorld {
  const runs = memoryRepository<Row>(options.runs ?? [])
  const findings = memoryRepository<Row>(options.findings ?? [])
  const outbox = memoryRepository<Row>(options.outbox ?? [])
  const snapshots = memoryRepository<Row>(options.snapshots ?? [])
  const fabric = {
    getStatus: jest.fn(() => ({ mode: 'fabric' })),
    evaluateTransaction: jest.fn((action: string) => {
      if (action === 'listEvidenceKeys') {
        return Promise.resolve({ keys: [], bookmark: '', hasMore: false })
      }
      return Promise.resolve({ manifestHash: HASH })
    }),
  }
  const governance = { ensureLedgerEvidenceQueued: jest.fn() }
  const moveIn = {
    ensureSettlementEvidenceQueued: jest.fn(),
    ensureHandoverEvidenceQueued: jest.fn(),
  }
  const service = new LedgerReconciliationService(
    runs as never,
    findings as never,
    outbox as never,
    memoryRepository<Row>([]) as never,
    memoryRepository<Row>([]) as never,
    memoryRepository<Row>([]) as never,
    memoryRepository<Row>([]) as never,
    snapshots as never,
    fabric as never,
    { retryTerminal: jest.fn() } as never,
    governance as never,
    {
      get: jest.fn((key: string) =>
        key === 'fabric.reconciliation.pageSize'
          ? (options.pageSize ?? 2)
          : undefined
      ),
    } as never,
    {
      get: jest.fn((token: unknown) => {
        if (token === MoveInSettlementsService) return moveIn
        throw new Error('Unexpected module token')
      }),
    } as never
  )

  return { service, runs, findings, outbox, snapshots, fabric, governance }
}

async function run(
  world: ReconciliationWorld
): Promise<Awaited<ReturnType<LedgerReconciliationService['processRun']>>> {
  const queued = await world.service.startRun(SCOPE, ADMIN, { process: false })
  return world.service.processRun(queued._id.toHexString())
}

describe('Ledger reconciliation integration (PROP-399 task 13.2)', () => {
  it.each([
    {
      label: 'missing outbox',
      projection: 'pending',
      outbox: false,
      ledger: { manifestHash: HASH },
      category: 'missing_delivery_work',
    },
    {
      label: 'missing projection',
      projection: 'pending',
      outbox: true,
      ledger: { manifestHash: HASH },
      category: 'missing_local_projection',
    },
    {
      label: 'missing ledger record',
      projection: 'confirmed-fabric',
      outbox: true,
      ledger: new Error('ERR_NOT_FOUND: governance snapshot does not exist'),
      category: 'missing_ledger_evidence',
    },
    {
      label: 'hash mismatch',
      projection: 'confirmed-fabric',
      outbox: true,
      ledger: { manifestHash: OTHER_HASH },
      category: 'hash_schema_mismatch',
    },
    {
      label: 'Fabric unavailable',
      projection: 'confirmed-fabric',
      outbox: true,
      ledger: new Error('FABRIC_GATEWAY_UNAVAILABLE: connection refused'),
      category: 'unverifiable',
    },
  ])(
    'persists the $label finding across real service/repository boundaries',
    async testCase => {
      const item = snapshot({ ledgerStatus: testCase.projection })
      const world = buildWorld({
        snapshots: [item],
        outbox: testCase.outbox ? [outboxFor(item)] : [],
      })
      world.fabric.evaluateTransaction.mockImplementation((action: string) => {
        if (action === 'listEvidenceKeys') {
          return Promise.resolve({ keys: [], bookmark: '', hasMore: false })
        }
        if (testCase.ledger instanceof Error) {
          return Promise.reject(testCase.ledger)
        }
        return Promise.resolve(testCase.ledger)
      })

      const result = await run(world)

      expect(result.status).toBe('completed-with-findings')
      expect(world.findings.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: testCase.category,
            aggregateId: (item._id as ObjectId).toHexString(),
            status: 'open',
          }),
        ])
      )
    }
  )

  it('repairs missing work only through the idempotent producer and never mutates Fabric', async () => {
    const item = snapshot({ ledgerStatus: 'pending' })
    const world = buildWorld({ snapshots: [item] })
    await run(world)
    const finding = world.findings.rows[0]
    const recovery = { _id: new ObjectId() }
    world.governance.ensureLedgerEvidenceQueued.mockResolvedValue(recovery)
    world.fabric.evaluateTransaction.mockClear()

    const repaired = await world.service.repairFinding(
      (finding?._id as ObjectId).toHexString(),
      ADMIN,
      'restore missing delivery work'
    )

    expect(repaired).toMatchObject({
      alreadyRepaired: false,
      outboxId: recovery._id.toHexString(),
    })
    expect(world.governance.ensureLedgerEvidenceQueued).toHaveBeenCalledWith(
      (item._id as ObjectId).toHexString()
    )
    expect(world.fabric.evaluateTransaction).not.toHaveBeenCalled()
    expect(world.findings.rows[0]).toMatchObject({
      status: 'repair-pending',
      recoveryOutboxId: recovery._id.toHexString(),
    })
  })

  it('resumes at the committed checkpoint without recounting the completed page', async () => {
    const items = [snapshot(), snapshot(), snapshot()]
    const world = buildWorld({
      snapshots: items,
      outbox: items.map(item => outboxFor(item)),
      pageSize: 2,
    })
    const originalFindOne = world.outbox.findOne.getMockImplementation()!
    let calls = 0
    world.outbox.findOne.mockImplementation((options: unknown) => {
      calls += 1
      if (calls === 3)
        return Promise.reject(new Error('transient repository failure'))
      return originalFindOne(options) as Promise<unknown>
    })

    const failed = await run(world)
    expect(failed.status).toBe('failed')
    expect(failed.counters.examined).toBe(2)
    expect(failed.checkpoint).toMatchObject({
      eventType: 'governance.published',
    })

    await world.service.resumeRun(failed._id.toHexString(), ADMIN, {
      process: false,
    })
    const resumed = await world.service.processRun(failed._id.toHexString())
    expect(resumed.status).toBe('completed')
    expect(resumed.counters).toMatchObject({ examined: 3, consistent: 3 })
    expect(resumed.checkpoint).toBeNull()
  })

  it('keeps finding history and resolves it after all three sources agree', async () => {
    const item = snapshot({ ledgerStatus: 'pending' })
    const world = buildWorld({ snapshots: [item] })
    await run(world)
    const firstSeenAt = world.findings.rows[0]?.firstSeenAt

    item.ledgerStatus = 'confirmed-fabric'
    world.outbox.rows.push(outboxFor(item))
    const resolvedByRun = await run(world)

    expect(world.findings.rows).toHaveLength(1)
    expect(world.findings.rows[0]).toMatchObject({
      status: 'resolved',
      firstSeenAt,
      resolution: {
        actorId: 'system',
        reason: `RECONCILIATION_RUN:${resolvedByRun._id.toHexString()}`,
      },
    })
  })
})
