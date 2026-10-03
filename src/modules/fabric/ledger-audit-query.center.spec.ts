import { NotFoundException, BadRequestException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { LedgerAuditQueryService } from './ledger-audit-query.service'
import { memoryRepository } from './fabric-memory-repository.fixtures'

const HASH = 'a'.repeat(64)
const NOW = new Date('2026-10-02T12:00:00.000Z')

type OutboxRow = Record<string, unknown>

function outboxRow(overrides: OutboxRow = {}): OutboxRow {
  return {
    _id: new ObjectId(),
    aggregateType: 'contract',
    aggregateId: new ObjectId().toHexString(),
    eventType: 'contract.activated',
    status: 'confirmed',
    attempts: 1,
    txHash: 'tx-real',
    networkMode: 'fabric',
    blockNumber: 12,
    errorCode: null,
    lastError: 'raw adapter text with secret-token',
    payloadHash: HASH,
    payload: { action: 'createContract', args: ['SECRET-ARG', 'tenant-cccd'] },
    dependencyKey: null,
    dependencyKeys: null,
    contractId: null,
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    updatedAt: new Date('2026-10-01T10:05:00.000Z'),
    confirmedAt: new Date('2026-10-01T10:05:00.000Z'),
    ...overrides,
  }
}

type FabricStatusStub = Record<string, unknown>

function liveStatus(overrides: FabricStatusStub = {}): FabricStatusStub {
  return {
    mode: 'fabric',
    connectionState: 'connected',
    ready: true,
    chaincodeAbiVersion: 2,
    evidenceSchemaVersions: [2, 3],
    errorCodes: [],
    identities: {
      writer: {
        state: 'ok',
        expiresAt: '2027-01-01T00:00:00.000Z',
        expiringSoon: false,
        errorCode: null,
      },
      reader: {
        state: 'ok',
        expiresAt: '2027-01-01T00:00:00.000Z',
        expiringSoon: false,
        errorCode: null,
      },
      operator: {
        state: 'ok',
        expiresAt: '2027-01-01T00:00:00.000Z',
        expiringSoon: false,
        errorCode: null,
      },
    },
    ledger: {
      height: 42,
      currentBlockHash: 'dead',
      observedAt: '2026-10-02T11:59:00.000Z',
    },
    explorer: {
      enabled: true,
      state: 'ready',
      publicUrl: 'https://explorer.example.com',
    },
    ...overrides,
  }
}

function build(
  options: {
    outbox?: OutboxRow[]
    findings?: OutboxRow[]
    runs?: OutboxRow[]
    status?: FabricStatusStub
    template?: string | undefined
  } = {}
): {
  service: LedgerAuditQueryService
  outbox: ReturnType<typeof memoryRepository>
  fabric: { getStatus: jest.Mock; evaluateTransaction: jest.Mock }
} {
  const outbox = memoryRepository(options.outbox ?? [])
  const logs = memoryRepository([])
  const runs = memoryRepository(options.runs ?? [])
  const findings = memoryRepository(options.findings ?? [])
  const fabric = {
    getStatus: jest.fn(() => options.status ?? liveStatus()),
    evaluateTransaction: jest.fn(),
  }
  const config = {
    get: jest.fn((key: string) =>
      key === 'fabric.explorerTxUrlTemplate'
        ? 'template' in options
          ? options.template
          : 'https://explorer.example.com/tx/{txId}'
        : key === 'fabric.enabled'
          ? true
          : undefined
    ),
  }
  const service = new LedgerAuditQueryService(
    logs as never,
    outbox as never,
    config as never,
    fabric as never,
    runs as never,
    findings as never
  )
  return { service, outbox, fabric }
}

describe('LedgerAuditQueryService Audit Center read model (PROP-399 tasks 7.1/7.2)', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'setTimeout',
        'setInterval',
        'clearTimeout',
        'clearInterval',
        'queueMicrotask',
      ],
    })
  })
  afterEach(() => jest.useRealTimers())

  describe('overview', () => {
    it('counts outbox items by pending, processing, retryable, succeeded and terminal failure', async () => {
      const { service } = build({
        outbox: [
          outboxRow({ status: 'pending', attempts: 0 }),
          outboxRow({ status: 'pending', attempts: 0 }),
          outboxRow({ status: 'pending', attempts: 2 }),
          outboxRow({ status: 'processing', attempts: 0 }),
          outboxRow({ status: 'confirmed' }),
          outboxRow({ status: 'confirmed' }),
          outboxRow({ status: 'confirmed' }),
          outboxRow({ status: 'failed', attempts: 5 }),
        ],
      })
      const overview = await service.getOverview()
      expect(overview.outbox).toMatchObject({
        pending: 2,
        processing: 1,
        retryable: 1,
        succeeded: 3,
        terminalFailure: 1,
      })
    })

    it('reports the oldest pending and oldest terminal-failure age', async () => {
      const { service } = build({
        outbox: [
          outboxRow({
            status: 'pending',
            attempts: 0,
            createdAt: new Date('2026-10-02T11:50:00.000Z'),
          }),
          outboxRow({
            status: 'pending',
            attempts: 0,
            createdAt: new Date('2026-10-02T11:00:00.000Z'),
          }),
          outboxRow({
            status: 'failed',
            createdAt: new Date('2026-09-30T12:00:00.000Z'),
            updatedAt: new Date('2026-10-01T12:00:00.000Z'),
          }),
        ],
      })
      const { outbox } = await service.getOverview()
      expect(outbox.oldestPendingAt).toBe('2026-10-02T11:00:00.000Z')
      expect(outbox.oldestPendingAgeSeconds).toBe(3600)
      expect(outbox.oldestTerminalFailureAt).toBe('2026-10-01T12:00:00.000Z')
      expect(outbox.oldestTerminalFailureAgeSeconds).toBe(24 * 3600)
    })

    it('returns null ages and zero counts for an empty outbox', async () => {
      const { service } = build()
      const { outbox, coverage } = await service.getOverview()
      expect(outbox).toMatchObject({
        pending: 0,
        processing: 0,
        retryable: 0,
        succeeded: 0,
        terminalFailure: 0,
        oldestPendingAt: null,
        oldestPendingAgeSeconds: null,
        oldestTerminalFailureAt: null,
        oldestTerminalFailureAgeSeconds: null,
      })
      expect(coverage.every(entry => entry.total === 0)).toBe(true)
    })

    it('labels live, degraded, unavailable and simulation runtimes truthfully', async () => {
      expect((await build().service.getOverview()).runtime.state).toBe('live')
      expect(
        (
          await build({
            status: liveStatus({
              ready: false,
              errorCodes: ['FABRIC_IDENTITY_EXPIRED'],
            }),
          }).service.getOverview()
        ).runtime.state
      ).toBe('degraded')
      expect(
        (
          await build({
            status: liveStatus({
              connectionState: 'unavailable',
              ready: false,
            }),
          }).service.getOverview()
        ).runtime.state
      ).toBe('unavailable')
      const simulation = (
        await build({
          status: {
            mode: 'simulation',
            connectionState: 'disabled',
            ready: true,
            chaincodeAbiVersion: 2,
            identities: {},
            ledger: { height: null, currentBlockHash: null, observedAt: null },
            explorer: { enabled: false, state: 'disabled', publicUrl: null },
          },
        }).service.getOverview()
      ).runtime
      expect(simulation).toMatchObject({
        mode: 'simulation',
        state: 'simulation',
      })
    })

    it('shows ledger height, current block hash and observation time, and null height without touching readiness', async () => {
      const live = await build().service.getOverview()
      expect(live.ledger).toEqual({
        height: 42,
        currentBlockHash: 'dead',
        observedAt: '2026-10-02T11:59:00.000Z',
      })
      const noHeight = await build({
        status: liveStatus({
          ledger: { height: null, currentBlockHash: null, observedAt: null },
        }),
      }).service.getOverview()
      expect(noHeight.ledger.height).toBeNull()
      expect(noHeight.runtime.ready).toBe(true)
      expect(noHeight.runtime.state).toBe('live')
    })

    it('lists expiring and expired identity roles with their expiry time and never any certificate content', async () => {
      const status = liveStatus({
        identities: {
          writer: {
            state: 'expiring',
            expiresAt: '2026-10-20T00:00:00.000Z',
            expiringSoon: true,
            errorCode: 'FABRIC_IDENTITY_EXPIRING',
          },
          reader: {
            state: 'expired',
            expiresAt: '2026-09-01T00:00:00.000Z',
            expiringSoon: false,
            errorCode: 'FABRIC_IDENTITY_EXPIRED',
          },
          operator: {
            state: 'ok',
            expiresAt: '2027-01-01T00:00:00.000Z',
            expiringSoon: false,
            errorCode: null,
          },
        },
      })
      const overview = await build({ status }).service.getOverview()
      expect(overview.identityWarnings).toEqual([
        {
          role: 'writer',
          state: 'expiring',
          expiresAt: '2026-10-20T00:00:00.000Z',
        },
        {
          role: 'reader',
          state: 'expired',
          expiresAt: '2026-09-01T00:00:00.000Z',
        },
      ])
      expect(JSON.stringify(overview)).not.toMatch(/BEGIN|cert\.pem|key\.pem/)
    })

    it('reports evidence coverage per supported event type', async () => {
      const { service } = build({
        outbox: [
          outboxRow({
            eventType: 'move-in.settled',
            aggregateType: 'move-in-settlement',
            status: 'confirmed',
          }),
          outboxRow({
            eventType: 'move-in.settled',
            aggregateType: 'move-in-settlement',
            status: 'pending',
            attempts: 0,
          }),
          outboxRow({
            eventType: 'move-in.settled',
            aggregateType: 'move-in-settlement',
            status: 'failed',
          }),
          outboxRow({
            eventType: 'handover.completed',
            aggregateType: 'move-in-handover',
            status: 'confirmed',
          }),
        ],
      })
      const { coverage } = await service.getOverview()
      expect(coverage.map(entry => entry.eventType)).toEqual(
        expect.arrayContaining([
          'contract.activated',
          'deposit.paid',
          'payment.paid',
          'contract.amendment-effective',
          'contract.terminated',
          'governance.published',
          'move-in.settled',
          'handover.completed',
        ])
      )
      expect(
        coverage.find(entry => entry.eventType === 'move-in.settled')
      ).toEqual({
        eventType: 'move-in.settled',
        total: 3,
        pending: 1,
        confirmed: 1,
        failed: 1,
      })
      expect(
        coverage.find(entry => entry.eventType === 'handover.completed')
      ).toMatchObject({ total: 1, confirmed: 1 })
    })

    it('summarizes the latest reconciliation run and open findings', async () => {
      const { service } = build({
        runs: [
          {
            _id: new ObjectId(),
            status: 'completed',
            createdAt: new Date('2026-10-01'),
            startedAt: new Date('2026-10-01'),
            completedAt: new Date('2026-10-01'),
            counters: {
              examined: 5,
              consistent: 4,
              findings: 1,
              unverifiable: 0,
            },
            scope: { contractIds: ['secret-contract'] },
          },
          {
            _id: new ObjectId(),
            status: 'completed-with-findings',
            createdAt: new Date('2026-10-02'),
            startedAt: new Date('2026-10-02'),
            completedAt: new Date('2026-10-02'),
            counters: {
              examined: 9,
              consistent: 7,
              findings: 2,
              unverifiable: 0,
            },
            scope: {},
          },
        ],
        findings: [
          { status: 'open' },
          { status: 'open' },
          { status: 'resolved' },
        ],
      })
      const { reconciliation } = await service.getOverview()
      expect(reconciliation.openFindings).toBe(2)
      expect(reconciliation.latestRun).toMatchObject({
        status: 'completed-with-findings',
        counters: { examined: 9, consistent: 7, findings: 2, unverifiable: 0 },
      })
      expect(JSON.stringify(reconciliation)).not.toContain('secret-contract')
    })

    it('never exposes raw args, raw errors, certificates or credentials', async () => {
      const { service } = build({ outbox: [outboxRow({ status: 'failed' })] })
      const serialized = JSON.stringify(await service.getOverview())
      expect(serialized).not.toContain('SECRET-ARG')
      expect(serialized).not.toContain('secret-token')
      expect(serialized).not.toContain('tenant-cccd')
    })
  })

  describe('worker health (additive /fabric/status block)', () => {
    it('is ready when nothing waits too long and degraded when the oldest pending item is stale', async () => {
      const fresh = await build({
        outbox: [
          outboxRow({
            status: 'pending',
            attempts: 0,
            createdAt: new Date('2026-10-02T11:59:00.000Z'),
          }),
        ],
      }).service.getWorkerHealth()
      expect(fresh).toEqual({
        state: 'ready',
        oldestPendingAt: '2026-10-02T11:59:00.000Z',
      })
      const stale = await build({
        outbox: [
          outboxRow({
            status: 'pending',
            attempts: 0,
            createdAt: new Date('2026-10-02T11:00:00.000Z'),
          }),
        ],
      }).service.getWorkerHealth()
      expect(stale).toEqual({
        state: 'degraded',
        oldestPendingAt: '2026-10-02T11:00:00.000Z',
      })
      expect(await build().service.getWorkerHealth()).toEqual({
        state: 'ready',
        oldestPendingAt: null,
      })
    })
  })

  describe('event list filters and pagination', () => {
    const contractA = new ObjectId().toHexString()
    const contractB = new ObjectId().toHexString()
    const settlementA = new ObjectId().toHexString()

    function rows(): OutboxRow[] {
      return [
        outboxRow({
          aggregateId: contractA,
          eventType: 'contract.activated',
          createdAt: new Date('2026-10-01T01:00:00.000Z'),
          txHash: 'tx-a1',
        }),
        outboxRow({
          aggregateType: 'move-in-handover',
          aggregateId: settlementA,
          eventType: 'handover.completed',
          contractId: contractA,
          createdAt: new Date('2026-10-02T01:00:00.000Z'),
          txHash: 'tx-a2',
        }),
        outboxRow({
          aggregateId: contractB,
          eventType: 'contract.activated',
          status: 'pending',
          attempts: 0,
          txHash: null,
          networkMode: null,
          createdAt: new Date('2026-10-03T01:00:00.000Z'),
        }),
        outboxRow({
          aggregateId: contractB,
          eventType: 'contract.terminated',
          status: 'failed',
          createdAt: new Date('2026-10-04T01:00:00.000Z'),
        }),
        outboxRow({
          aggregateId: contractB,
          eventType: 'contract.amendment-effective',
          status: 'pending',
          attempts: 3,
          createdAt: new Date('2026-10-05T01:00:00.000Z'),
        }),
        outboxRow({
          aggregateId: contractB,
          eventType: 'payment.paid',
          status: 'confirmed',
          networkMode: 'simulation',
          txHash: 'sim_x',
          blockNumber: 9,
          createdAt: new Date('2026-10-06T01:00:00.000Z'),
        }),
      ]
    }

    const defaults = { page: 1, limit: 20 }

    it('filters by contract (aggregate and linked contractId) and event type', async () => {
      const { service } = build({ outbox: rows() })
      const byContract = await service.listEvents({
        ...defaults,
        contractId: contractA,
      })
      expect(byContract.total).toBe(2)
      const handover = await service.listEvents({
        ...defaults,
        contractId: contractA,
        eventType: 'handover.completed',
      })
      expect(handover.items.map(item => item.eventType)).toEqual([
        'handover.completed',
      ])
      expect(handover.total).toBe(1)
    })

    it('filters by delivery state, including the retryable bucket', async () => {
      const { service } = build({ outbox: rows() })
      const states = async (
        state: 'pending' | 'retryable' | 'confirmed' | 'failed' | 'processing'
      ): Promise<number> =>
        (await service.listEvents({ ...defaults, state })).total
      expect(await states('pending')).toBe(1)
      expect(await states('retryable')).toBe(1)
      expect(await states('confirmed')).toBe(3)
      expect(await states('failed')).toBe(1)
      expect(await states('processing')).toBe(0)
    })

    it('filters by transaction identifier and by date range (inclusive)', async () => {
      const { service } = build({ outbox: rows() })
      const byTx = await service.listEvents({ ...defaults, txId: 'tx-a2' })
      expect(byTx.items).toHaveLength(1)
      expect(byTx.items[0]?.eventType).toBe('handover.completed')
      const byDate = await service.listEvents({
        ...defaults,
        from: '2026-10-02T00:00:00.000Z',
        to: '2026-10-03T23:59:59.000Z',
      })
      expect(byDate.total).toBe(2)
    })

    it('filters by local verification state', async () => {
      const { service } = build({ outbox: rows() })
      const verified = await service.listEvents({
        ...defaults,
        verificationState: 'verified',
      })
      expect(verified.total).toBe(2)
      const unavailable = await service.listEvents({
        ...defaults,
        verificationState: 'unavailable',
      })
      expect(unavailable.items.map(item => item.eventType)).toEqual([
        'payment.paid',
      ])
      const notRecorded = await service.listEvents({
        ...defaults,
        verificationState: 'not-recorded',
      })
      expect(notRecorded.total).toBe(3)
    })

    it('combines filters with AND semantics', async () => {
      const { service } = build({ outbox: rows() })
      const result = await service.listEvents({
        ...defaults,
        contractId: contractB,
        state: 'pending',
      })
      expect(result.total).toBe(1)
      expect(result.items[0]?.eventType).toBe('contract.activated')
    })

    it('rejects an inverted date range with AUDIT_FILTER_INVALID', async () => {
      const { service } = build({ outbox: rows() })
      const error = await service
        .listEvents({
          ...defaults,
          from: '2026-10-05T00:00:00.000Z',
          to: '2026-10-01T00:00:00.000Z',
        })
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(BadRequestException)
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'AUDIT_FILTER_INVALID',
      })
    })

    it('paginates newest first with accurate metadata at the boundaries', async () => {
      const { service } = build({ outbox: rows() })
      const first = await service.listEvents({ page: 1, limit: 4 })
      expect(first).toMatchObject({
        total: 6,
        page: 1,
        limit: 4,
        totalPages: 2,
      })
      expect(first.items[0]?.eventType).toBe('payment.paid')
      const second = await service.listEvents({ page: 2, limit: 4 })
      expect(second.items).toHaveLength(2)
      const beyond = await service.listEvents({ page: 3, limit: 4 })
      expect(beyond).toMatchObject({ items: [], total: 6, totalPages: 2 })
    })

    it('returns an empty page (not an error) when nothing matches', async () => {
      const { service } = build({ outbox: rows() })
      const result = await service.listEvents({
        ...defaults,
        txId: 'does-not-exist',
      })
      expect(result).toEqual({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      })
    })

    it('maps sanitized summaries: no args, no raw error, authentic block only for Fabric', async () => {
      const { service } = build({ outbox: rows() })
      const page = await service.listEvents({ ...defaults, limit: 20 })
      const serialized = JSON.stringify(page)
      expect(serialized).not.toContain('SECRET-ARG')
      expect(serialized).not.toContain('secret-token')
      const sim = page.items.find(item => item.eventType === 'payment.paid')
      expect(sim).toMatchObject({
        networkMode: 'simulation',
        blockNumber: null,
        explorerUrl: null,
      })
      const live = page.items.find(item => item.txId === 'tx-a1')
      expect(live).toMatchObject({
        networkMode: 'fabric',
        blockNumber: 12,
        explorerUrl: 'https://explorer.example.com/tx/tx-a1',
      })
    })

    it('can filter on events that have an open hash/schema mismatch finding', async () => {
      const mismatched = outboxRow({
        aggregateId: contractA,
        createdAt: new Date('2026-10-01T01:00:00.000Z'),
      })
      const { service } = build({
        outbox: [mismatched, outboxRow({ aggregateId: contractB })],
        findings: [
          {
            status: 'open',
            category: 'hash_schema_mismatch',
            aggregateType: 'contract',
            aggregateId: contractA,
            eventType: 'contract.activated',
          },
        ],
      })
      const result = await service.listEvents({
        ...defaults,
        verificationState: 'mismatch',
      })
      expect(result.total).toBe(1)
      expect(result.items[0]?.aggregateRef).toBe(contractA.slice(-6))
    })
  })

  describe('event detail', () => {
    it('returns a sanitized detail with dependency state, categories and the configured Explorer link', async () => {
      const parent = outboxRow({
        aggregateType: 'deposit',
        aggregateId: 'abcdef123456',
        eventType: 'deposit.paid',
        status: 'confirmed',
      })
      const child = outboxRow({
        status: 'pending',
        attempts: 0,
        errorCode: 'DEPENDENCY_PENDING',
        dependencyKeys: [
          'deposit:abcdef123456:deposit.paid',
          'governance-snapshot:aaaaaaaaaaaaaaaaaaaaaaaa:governance.published',
        ],
      })
      const { service } = build({ outbox: [parent, child] })
      const detail = await service.getEvent(
        (child._id as ObjectId).toHexString()
      )

      expect(detail.dependencies).toEqual([
        { key: 'deposit:123456:deposit.paid', state: 'confirmed' },
        {
          key: 'governance-snapshot:aaaaaa:governance.published',
          state: 'missing',
        },
      ])
      expect(detail.failureCode).toBe('DEPENDENCY_PENDING')
      expect(detail.payloadHash).toBe(HASH)
      expect(JSON.stringify(detail)).not.toContain('SECRET-ARG')
      expect(JSON.stringify(detail)).not.toContain('secret-token')
    })

    it('builds the Explorer link only from the configured template and an authentic Fabric txId', async () => {
      const row = outboxRow({ txHash: 'tx/../evil?x=1' })
      const { service } = build({ outbox: [row] })
      const detail = await service.getEvent((row._id as ObjectId).toHexString())
      expect(detail.explorer).toEqual({
        available: true,
        url: 'https://explorer.example.com/tx/tx%2F..%2Fevil%3Fx%3D1',
        reason: null,
      })
    })

    it.each([
      ['template missing', { template: undefined }, 'EXPLORER_NOT_CONFIGURED'],
      [
        'template without {txId}',
        { template: 'https://explorer.example.com/tx' },
        'EXPLORER_NOT_CONFIGURED',
      ],
      [
        'non-http template',
        { template: 'javascript:alert({txId})' },
        'EXPLORER_NOT_CONFIGURED',
      ],
      [
        'explorer degraded',
        {
          status: liveStatus({
            explorer: { enabled: true, state: 'degraded', publicUrl: null },
          }),
        },
        'EXPLORER_DEGRADED',
      ],
    ])(
      'disables the Explorer action with an explicit reason: %s',
      async (_label, options, reason) => {
        const row = outboxRow()
        const { service } = build({ outbox: [row], ...options })
        const detail = await service.getEvent(
          (row._id as ObjectId).toHexString()
        )
        expect(detail.explorer).toEqual({ available: false, url: null, reason })
        expect(detail.status).toBe('confirmed')
      }
    )

    it('has no Explorer link for simulation or uncommitted events', async () => {
      const sim = outboxRow({ networkMode: 'simulation', txHash: 'sim_x' })
      const pending = outboxRow({
        status: 'pending',
        txHash: null,
        networkMode: null,
        attempts: 0,
      })
      const { service } = build({ outbox: [sim, pending] })
      expect(
        (await service.getEvent((sim._id as ObjectId).toHexString())).explorer
      ).toEqual({
        available: false,
        url: null,
        reason: 'NOT_COMMITTED_ON_FABRIC',
      })
      expect(
        (await service.getEvent((pending._id as ObjectId).toHexString()))
          .explorer.reason
      ).toBe('NOT_COMMITTED_ON_FABRIC')
    })

    it('throws AUDIT_EVENT_NOT_FOUND for unknown or malformed ids', async () => {
      const { service } = build()
      await expect(
        service.getEvent(new ObjectId().toHexString())
      ).rejects.toBeInstanceOf(NotFoundException)
      await expect(service.getEvent('nope')).rejects.toBeInstanceOf(
        NotFoundException
      )
    })

    describe('verification', () => {
      function ledgerRow(extra: OutboxRow = {}): OutboxRow {
        return outboxRow({
          aggregateType: 'move-in-handover',
          aggregateId: new ObjectId().toHexString(),
          eventType: 'handover.completed',
          payload: {
            action: 'recordHandover',
            args: [
              's',
              'c',
              HASH,
              '1',
              '1',
              'false',
              '2026-10-01T00:00:00.000Z',
            ],
          },
          ...extra,
        })
      }

      it('verifies a committed event against the direct ledger key', async () => {
        const row = ledgerRow()
        const { service, fabric } = build({ outbox: [row] })
        fabric.evaluateTransaction.mockResolvedValue({ handoverHash: HASH })
        const detail = await service.getEvent(
          (row._id as ObjectId).toHexString()
        )
        expect(fabric.evaluateTransaction).toHaveBeenCalledWith(
          'readHandover',
          [row.aggregateId]
        )
        expect(detail.verification).toEqual({
          status: 'verified',
          reason: null,
        })
      })

      it('reports mismatch, not-recorded and unavailable distinctly', async () => {
        const row = ledgerRow()
        const { service, fabric } = build({ outbox: [row] })
        const id = (row._id as ObjectId).toHexString()
        fabric.evaluateTransaction.mockResolvedValueOnce({
          handoverHash: 'b'.repeat(64),
        })
        expect((await service.getEvent(id)).verification.status).toBe(
          'mismatch'
        )
        fabric.evaluateTransaction.mockRejectedValueOnce(
          new Error(
            'Fabric query failed: ERR_NOT_FOUND: handover evidence does not exist'
          )
        )
        expect((await service.getEvent(id)).verification.status).toBe(
          'not-recorded'
        )
        fabric.evaluateTransaction.mockRejectedValueOnce(
          new Error('FABRIC_GATEWAY_UNAVAILABLE: x secret-detail')
        )
        const unavailable = await service.getEvent(id)
        expect(unavailable.verification).toEqual({
          status: 'unavailable',
          reason: 'FABRIC_UNAVAILABLE',
        })
        expect(JSON.stringify(unavailable)).not.toContain('secret-detail')
      })

      it('does not query Fabric for uncommitted, simulated or unsupported events', async () => {
        const pending = ledgerRow({
          status: 'pending',
          attempts: 0,
          txHash: null,
          networkMode: null,
        })
        const sim = ledgerRow({ networkMode: 'simulation', txHash: 'sim_x' })
        const unsupported = outboxRow({
          eventType: 'payment.paid',
          aggregateType: 'payment',
        })
        const { service, fabric } = build({
          outbox: [pending, sim, unsupported],
        })
        expect(
          (await service.getEvent((pending._id as ObjectId).toHexString()))
            .verification
        ).toEqual({ status: 'not-recorded', reason: null })
        expect(
          (await service.getEvent((sim._id as ObjectId).toHexString()))
            .verification
        ).toEqual({ status: 'unavailable', reason: 'FABRIC_SIMULATION_MODE' })
        expect(
          (await service.getEvent((unsupported._id as ObjectId).toHexString()))
            .verification
        ).toEqual({
          status: 'unavailable',
          reason: 'VERIFICATION_NOT_SUPPORTED',
        })
        expect(fabric.evaluateTransaction).not.toHaveBeenCalled()
      })
    })
  })
})
