import { ObjectId } from 'mongodb'
import { ContractsService } from '../../contracts/services/contracts.service'
import { MoveInSettlementsService } from '../../rental/services/move-in-settlements.service'
import { FabricGovernanceService } from './fabric-governance.service'
import { FabricService } from './fabric.service'
import { LedgerEvidenceQueryService } from './ledger-evidence-query.service'
import { LedgerOutboxService } from './ledger-outbox.service'
import { LedgerProjectionService } from './ledger-projection.service'
import {
  FakeFabricLedger,
  makeDue,
  sha,
} from '../utils/fabric-integration.fixtures'
import { memoryRepository } from '../utils/fabric-memory-repository.fixtures'
import { ContractTemplateGovernanceService } from '../../contracts/legal/contract-template-governance.service'
import { ContractLayoutService } from '../../contracts/layout/contract-layout.service'
import { PlatformFeesService } from '../../payments/services/platform-fees.service'

/**
 * PROP-399 task 13.1: dòng bằng chứng end-to-end bằng service THẬT (governance, outbox, projection,
 * contracts, move-in settlements, evidence query) trên repository trong bộ nhớ và một sổ cái giả có ngữ
 * nghĩa chaincode: deposit + governance → activation chờ cả hai parent → quyết toán → bàn giao → bằng
 * chứng cho participant.
 */
type Row = Record<string, unknown>

const CONTRACT_ID = new ObjectId()
const DEPOSIT_ID = new ObjectId('507f1f77bcf86cd799439099')
const SETTLEMENT_ID = new ObjectId()
const PAYMENT_ID = new ObjectId()
const ARTIFACT_HASH = 'a'.repeat(64)
const DEPOSIT_HASH = 'd'.repeat(64)
const PAYMENT_HASH = 'e'.repeat(64)
const ADMIN = { id: 'admin-1', role: 'admin' }

const PII = [
  'Nguyen Van A',
  'Tran Thi B',
  '079123456789',
  '079987654321',
  'PRIVATE-NOTE',
  'STAFF-OVERRIDE-TEXT',
  'INV-REF-77',
]

function smartCaEvidence(
  role: 'tenant' | 'landlord',
  tx: string
): Record<string, unknown> {
  return {
    contractId: CONTRACT_ID.toHexString(),
    signerId: `${role}-1`,
    role,
    artifactHash: ARTIFACT_HASH,
    providerTransactionId: tx,
    certificateSerial: `cert-${role}`,
    certificateSubject: `CN=${role}`,
    certificateIssuer: 'CN=VNPT',
    signatureHash: `sig-${role}`,
    signedAt: new Date('2030-01-01T00:00:00.000Z'),
  }
}

function buildWorld(
  options: {
    simulation?: boolean
    withDeposit?: boolean
    publishGovernance?: boolean
  } = {}
): {
  ledger: FakeFabricLedger
  backend: FakeFabricLedger | FabricService
  contractRow: Row
  contracts: ReturnType<typeof memoryRepository<Row>>
  deposits: ReturnType<typeof memoryRepository<Row>>
  payments: ReturnType<typeof memoryRepository<Row>>
  settlements: ReturnType<typeof memoryRepository<Row>>
  snapshots: ReturnType<typeof memoryRepository<Row>>
  outboxRows: ReturnType<typeof memoryRepository<Row>>
  logs: ReturnType<typeof memoryRepository<Row>>
  outbox: LedgerOutboxService
  governance: FabricGovernanceService
  moveIn: MoveInSettlementsService
  evidence: LedgerEvidenceQueryService
  cycle: (times?: number) => Promise<void>
  item: (key: string) => Row
  enqueueDeposit: () => Promise<void>
  activate: () => Promise<void>
  addSettlementAndHandover: () => Promise<Row>
} {
  const withDeposit = options.withDeposit ?? true
  const ledger = new FakeFabricLedger()

  // ── Repository trong bộ nhớ ───────────────────────────────────────────────
  const contractRow: Row = {
    _id: CONTRACT_ID,
    contractCode: 'HD-INT-1',
    propertyId: 'property-1',
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
    tenantName: 'Nguyen Van A',
    tenantCccd: '079123456789',
    landlordName: 'Tran Thi B',
    landlordCccd: '079987654321',
    monthlyRent: 10_000_000,
    deposit: withDeposit ? 20_000_000 : 0,
    depositAgreementId: withDeposit ? DEPOSIT_ID.toHexString() : null,
    startDate: new Date('2030-01-01T00:00:00.000Z'),
    status: 'awaiting-signature',
    signedByTenant: false,
    signedByLandlord: false,
    tenantSignature: null,
    landlordSignature: null,
    contentLockedHash: ARTIFACT_HASH,
    contentLockedAt: new Date('2029-12-01T00:00:00.000Z'),
    artifactRef: {
      artifactId: 'artifact-1',
      revision: 1,
      templateKey: 'lease-vn',
      templateVersion: 1,
      hashSchemaVersion: 1,
      artifactHash: ARTIFACT_HASH,
      contentType: 'application/pdf',
      lockedAt: new Date('2029-12-01T00:00:00.000Z'),
    },
    executionPolicySnapshot: {
      policyId: 'SIGN_FIRST',
      version: 1,
      strategy: 'SIGN_FIRST',
      contentHash: 'policy-hash',
    },
    ledgerStatus: null,
    settlementId: SETTLEMENT_ID.toHexString(),
  }
  const contracts = memoryRepository<Row>([contractRow])
  const deposits = memoryRepository<Row>(
    withDeposit
      ? [
          {
            _id: DEPOSIT_ID,
            status: 'paid',
            depositHash: DEPOSIT_HASH,
            paidAt: new Date('2029-12-15T00:00:00.000Z'),
            ledgerStatus: 'pending',
          },
        ]
      : []
  )
  const payments = memoryRepository<Row>([])
  const settlements = memoryRepository<Row>([])
  const snapshots = memoryRepository<Row>([])
  const outboxRows = memoryRepository<Row>([])
  const logs = memoryRepository<Row>([])

  // ── Backend Fabric: giả lập có ngữ nghĩa chaincode, hoặc FabricService THẬT ở chế độ simulation ──
  let backend: FakeFabricLedger | FabricService = ledger
  if (options.simulation) {
    const real = new FabricService(
      logs as never,
      { get: jest.fn(() => false) } as never
    )
    backend = real
  }

  const projection = new LedgerProjectionService(
    contracts as never,
    deposits as never,
    payments as never,
    undefined,
    snapshots as never,
    settlements as never
  )
  const outbox = new LedgerOutboxService(
    outboxRows as never,
    backend as never,
    projection
  )

  // ── Governance THẬT với nguồn mock ─────────────────────────────────────────
  const H = (c: string): string => c.repeat(64)
  const governance = new FabricGovernanceService(
    snapshots as never,
    {
      getCurrentPublishedTerms: jest.fn().mockResolvedValue({
        key: 'rental-service-terms',
        version: 1,
        contentHash: H('1'),
      }),
    } as never,
    {
      findAll: jest.fn().mockResolvedValue([
        {
          key: 'MAX_DEPOSIT_LIMIT_PERCENT',
          value: '5',
          unit: '%',
          status: 'active',
        },
      ]),
    } as never,
    {
      listActive: jest
        .fn()
        .mockResolvedValue([
          { policyId: 'SIGN_FIRST', version: 1, contentHash: H('2') },
        ]),
    } as never,
    outbox,
    backend as never,
    {
      get: jest.fn((token: unknown) =>
        token === ContractTemplateGovernanceService
          ? {
              listLatestPublished: jest
                .fn()
                .mockResolvedValue([
                  { templateKey: 'VN_LEASE', version: 1, contentHash: H('3') },
                ]),
            }
          : token === ContractLayoutService
            ? { listLatestPublished: jest.fn().mockResolvedValue([]) }
            : token === PlatformFeesService
              ? { getEffectiveSchedule: jest.fn().mockResolvedValue(null) }
              : undefined
      ),
    } as never
  )

  // ── ContractsService THẬT (kích hoạt SmartCA) ─────────────────────────────
  const contractsService = Object.create(
    ContractsService.prototype
  ) as ContractsService
  Reflect.set(contractsService, 'contractRepository', contracts)
  Reflect.set(contractsService, 'depositAgreementRepository', deposits)
  Reflect.set(contractsService, 'ledgerOutboxService', outbox)
  Reflect.set(contractsService, 'governanceService', governance)
  Reflect.set(contractsService, 'fabricService', backend)
  Reflect.set(contractsService, 'apartmentRepository', { findOne: jest.fn() })
  Reflect.set(contractsService, 'paymentsService', {
    generateSchedule: jest.fn().mockResolvedValue([]),
    generatePlatformFeeInvoices: jest.fn().mockResolvedValue([]),
  })

  // ── Move-in settlements THẬT ───────────────────────────────────────────────
  const moveIn = new MoveInSettlementsService(
    settlements as never,
    {} as never,
    {} as never,
    {} as never,
    undefined,
    outbox
  )

  const evidence = new LedgerEvidenceQueryService(
    logs as never,
    outboxRows as never,
    deposits as never,
    payments as never,
    memoryRepository<Row>([]) as never,
    {
      getStatus: () => ({
        mode: options.simulation ? 'simulation' : 'fabric',
        connectionState: options.simulation ? 'disabled' : 'connected',
      }),
    } as never,
    {
      get: jest.fn((key: string) =>
        key === 'fabric.explorerTxUrlTemplate'
          ? 'https://explorer.example.com/tx/{txId}'
          : undefined
      ),
    } as never
  )

  async function cycle(times = 1): Promise<void> {
    for (let i = 0; i < times; i += 1) {
      makeDue(outboxRows.rows)
      await outbox.processPending(50)
    }
  }

  function item(key: string): Row {
    const [aggregateType, aggregateId, eventType] = key.split(':')
    const row = outboxRows.rows.find(
      r =>
        r.aggregateType === aggregateType &&
        r.aggregateId === aggregateId &&
        r.eventType === eventType
    )
    if (!row) throw new Error(`no outbox item ${key}`)
    return row
  }

  async function enqueueDeposit(): Promise<void> {
    // Giống DepositAgreementsService.enqueue: bằng chứng cọc là parent của activation.
    await outbox.enqueue({
      aggregateType: 'deposit',
      aggregateId: DEPOSIT_ID.toHexString(),
      eventType: 'deposit.paid',
      action: 'recordDeposit',
      args: [
        DEPOSIT_ID.toHexString(),
        DEPOSIT_ID.toHexString(),
        'application-1',
        '20000000',
        DEPOSIT_HASH,
      ],
      metadata: { agreementId: DEPOSIT_ID.toHexString() },
    })
  }

  async function activate(): Promise<void> {
    await contractsService.recordSmartCaSignature(
      smartCaEvidence('tenant', 'tx-t') as never
    )
    await contractsService.recordSmartCaSignature(
      smartCaEvidence('landlord', 'tx-l') as never
    )
  }

  async function addSettlementAndHandover(): Promise<Row> {
    const row: Row = {
      _id: SETTLEMENT_ID,
      contractId: CONTRACT_ID.toHexString(),
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      status: 'paid',
      total: 44_000_000,
      statementHash: 'f'.repeat(64),
      lines: [
        {
          kind: 'DEPOSIT_TOPUP',
          amount: 14_000_000,
          paymentId: 'pay-topup',
          paidAt: new Date('2029-12-20T00:00:00.000Z'),
        },
        {
          kind: 'FIRST_RENT',
          amount: 30_000_000,
          paymentId: 'pay-rent',
          paidAt: new Date('2029-12-21T00:00:00.000Z'),
        },
      ],
      handover: {
        revision: 1,
        handedOverAt: new Date('2030-01-01T00:00:00.000Z'),
        meterReadings: { electricity: 123, water: 456 },
        keyCount: 2,
        inventoryReference: 'INV-REF-77',
        notes: 'PRIVATE-NOTE',
        handoverHash: sha('handover-1'),
        recordedBy: 'landlord-1',
        tenantConfirmation: null,
        landlordConfirmation: null,
        discrepancyNote: 'PRIVATE-NOTE',
        overrideReason: 'STAFF-OVERRIDE-TEXT',
        completedAt: null,
      },
      createdAt: new Date('2029-12-20T00:00:00.000Z'),
    }
    settlements.rows.push(row)
    await moveIn.recordSettlementPaidEvidence(row as never)
    const handoverHash = sha('handover-1')
    await moveIn.confirmHandover(
      SETTLEMENT_ID.toHexString(),
      'tenant-1',
      'tenant',
      handoverHash
    )
    await moveIn.confirmHandover(
      SETTLEMENT_ID.toHexString(),
      'landlord-1',
      'landlord',
      handoverHash
    )
    return row
  }

  return {
    ledger,
    backend,
    contractRow,
    contracts,
    deposits,
    payments,
    settlements,
    snapshots,
    outboxRows,
    logs,
    outbox,
    governance,
    moveIn,
    evidence,
    cycle,
    item,
    enqueueDeposit,
    activate,
    addSettlementAndHandover,
  }
}

type World = ReturnType<typeof buildWorld>

const CONTRACT_KEY = `contract:${CONTRACT_ID.toHexString()}:contract.activated`

function actions(world: World): string[] {
  return world.ledger.submitted.map(entry => entry.action)
}

describe('PROP-399 task 13.1: deposit + governance -> activation -> settlement -> handover -> participant evidence', () => {
  describe('live Fabric (authentic commit metadata)', () => {
    let world: World
    let snapshotId: string

    beforeAll(async () => {
      world = buildWorld()
      await world.enqueueDeposit()
      const published = await world.governance.publish(ADMIN)
      snapshotId = published.snapshot._id.toHexString()
      await world.activate()
    })

    it('binds the eligible governance snapshot and enqueues activation with BOTH parents', () => {
      expect(world.contractRow.governanceSnapshotRef).toEqual({
        snapshotId,
        version: 1,
        manifestHash: world.snapshots.rows[0]?.manifestHash,
      })
      const activation = world.item(CONTRACT_KEY)
      expect(activation.dependencyKeys).toEqual([
        `deposit:${DEPOSIT_ID.toHexString()}:deposit.paid`,
        `governance-snapshot:${snapshotId}:governance.published`,
      ])
      expect(activation.status).toBe('pending')
      expect((activation.payload as { metadata: Row }).metadata).toMatchObject({
        minimumAbiVersion: 2,
        minimumEvidenceSchemaVersion: 3,
        waitingCode: 'CHAINCODE_UPGRADE_REQUIRED',
      })
    })

    it('keeps activation waiting (without burning attempts or submitting) while a parent is unconfirmed, then submits only after both', async () => {
      world.ledger.failNext(
        'publishGovernanceSnapshot',
        new Error('FABRIC_GATEWAY_UNAVAILABLE: blip')
      )
      await world.cycle()

      const waiting = world.item(CONTRACT_KEY)
      expect(waiting).toMatchObject({
        status: 'pending',
        attempts: 0,
        errorCode: 'DEPENDENCY_PENDING',
      })
      expect(String(waiting.lastError)).toContain('governance-snapshot')
      expect(actions(world)).not.toContain('createContract')
      expect(
        world.item(`deposit:${DEPOSIT_ID.toHexString()}:deposit.paid`).status
      ).toBe('confirmed')

      await world.cycle()

      expect(
        actions(world).filter(a => a !== 'publishGovernanceSnapshot' || true)
      ).toEqual([
        'recordDeposit',
        'publishGovernanceSnapshot', // failed once (transient)
        'publishGovernanceSnapshot',
        'createContract',
      ])
      expect(world.ledger.writes.map(w => w.action)).toEqual([
        'recordDeposit',
        'publishGovernanceSnapshot',
        'createContract',
      ])
      expect(
        world.ledger.world.get(`CONTRACT_${CONTRACT_ID.toHexString()}`)
      ).toMatchObject({
        governanceSnapshotId: snapshotId,
        depositId: DEPOSIT_ID.toHexString(),
      })
      expect(world.item(CONTRACT_KEY)).toMatchObject({
        status: 'confirmed',
        errorCode: null,
      })
    })

    it('records payments idempotently: dedup in the outbox, replay-safe on the ledger, conflict is terminal', async () => {
      const args = [
        PAYMENT_ID.toHexString(),
        CONTRACT_ID.toHexString(),
        '10000000',
        PAYMENT_HASH,
      ]
      const enqueue = (
        eventType: string,
        hash: string,
        aggregateType = 'payment'
      ): ReturnType<LedgerOutboxService['enqueue']> =>
        world.outbox.enqueue({
          aggregateType,
          aggregateId: PAYMENT_ID.toHexString(),
          eventType,
          action: 'recordPayment',
          args: [args[0] as string, args[1] as string, args[2] as string, hash],
          metadata: {
            paymentId: PAYMENT_ID.toHexString(),
            contractId: CONTRACT_ID.toHexString(),
          },
          dependencyKey: CONTRACT_KEY,
        })
      world.payments.rows.push({
        _id: PAYMENT_ID,
        contractId: CONTRACT_ID.toHexString(),
        status: 'paid',
        amount: 10_000_000,
        paymentHash: PAYMENT_HASH,
        ledgerStatus: 'pending',
        type: 'rent',
        payerRole: 'tenant',
      })
      const first = await enqueue('payment.paid', PAYMENT_HASH)
      const duplicate = await enqueue('payment.paid', PAYMENT_HASH)
      expect(duplicate).toBe(first) // same (aggregate, event) key -> no second item

      await world.cycle()
      expect(
        world.ledger.writes.filter(w => w.action === 'recordPayment')
      ).toHaveLength(1)

      // Lost-commit-response replay of the identical payload: committed again, state unchanged.
      const before = world.ledger.world.get(
        `PAYMENT_${PAYMENT_ID.toHexString()}`
      )
      await world.ledger.submitTransaction('recordPayment', args)
      expect(world.ledger.replays).toBe(1)
      expect(
        world.ledger.world.get(`PAYMENT_${PAYMENT_ID.toHexString()}`)
      ).toBe(before)
      expect(
        world.ledger.writes.filter(w => w.action === 'recordPayment')
      ).toHaveLength(1)

      // A different payload for the same payment is a conflict -> terminal, ledger untouched.
      await enqueue('payment.paid-corrected', 'c'.repeat(64), 'payment-replay')
      await world.cycle()
      expect(
        world.item(
          `payment-replay:${PAYMENT_ID.toHexString()}:payment.paid-corrected`
        )
      ).toMatchObject({
        status: 'failed',
        errorCode: 'TERMINAL_CONFLICT',
      })
      expect(
        world.ledger.world.get(`PAYMENT_${PAYMENT_ID.toHexString()}`)
      ).toBe(before)
    })

    it('anchors settlement and handover only after the contract, with allowlisted args and canonical keys', async () => {
      await world.addSettlementAndHandover()
      const settled = world.item(
        `move-in-settlement:${SETTLEMENT_ID.toHexString()}:move-in.settled`
      )
      const handover = world.item(
        `move-in-handover:${SETTLEMENT_ID.toHexString()}:handover.completed`
      )
      for (const row of [settled, handover]) {
        expect(row.dependencyKeys).toEqual([CONTRACT_KEY])
        expect(row.status).toBe('pending')
      }
      expect((settled.payload as { args: string[] }).args).toHaveLength(5)
      expect((handover.payload as { args: string[] }).args).toHaveLength(7)
      expect((handover.payload as { args: string[] }).args[5]).toBe('true') // overrideUsed flag only

      await world.cycle()

      const order = world.ledger.writes.map(w => w.action)
      expect(order.indexOf('createContract')).toBeLessThan(
        order.indexOf('recordMoveInSettlement')
      )
      expect(order.indexOf('createContract')).toBeLessThan(
        order.indexOf('recordHandover')
      )
      const settlementRecord = world.ledger.world.get(
        `MOVEIN_${SETTLEMENT_ID.toHexString()}`
      )
      const handoverRecord = world.ledger.world.get(
        `HANDOVER_${SETTLEMENT_ID.toHexString()}`
      )
      expect(settlementRecord?.manifestHash).toBe(
        (world.settlements.rows[0]?.settlementEvidence as Row).manifestHash
      )
      expect(handoverRecord).toMatchObject({
        overrideUsed: true,
        revision: 1,
        handoverHash: sha('handover-1'),
      })
    })

    it('projects authentic tx and block numbers onto every read model', () => {
      const tx = (key: string): string =>
        world.ledger.world.get(key)?.txId as string
      expect(world.contractRow).toMatchObject({
        ledgerStatus: 'confirmed',
        ledgerNetworkMode: 'fabric',
        blockchainAddress: tx(`CONTRACT_${CONTRACT_ID.toHexString()}`),
      })
      expect(world.deposits.rows[0]).toMatchObject({
        ledgerStatus: 'confirmed',
        depositLedgerTxId: tx(`DEPOSIT_${DEPOSIT_ID.toHexString()}`),
      })
      expect(world.payments.rows[0]).toMatchObject({
        ledgerStatus: 'confirmed',
        txHash: tx(`PAYMENT_${PAYMENT_ID.toHexString()}`),
      })
      expect(world.snapshots.rows[0]).toMatchObject({
        ledgerStatus: 'confirmed-fabric',
        txHash: tx(`GOVERNANCE_${snapshotId}`),
      })
      expect((world.snapshots.rows[0]?.blockNumber as number) > 100).toBe(true)
      const settlement = world.settlements.rows[0] as Row
      expect(settlement.settlementEvidence).toMatchObject({
        ledgerStatus: 'confirmed-fabric',
        txHash: tx(`MOVEIN_${SETTLEMENT_ID.toHexString()}`),
      })
      expect(settlement.handoverEvidence).toMatchObject({
        ledgerStatus: 'confirmed-fabric',
        txHash: tx(`HANDOVER_${SETTLEMENT_ID.toHexString()}`),
      })
      expect(
        ((settlement.handoverEvidence as Row).blockNumber as number) > 100
      ).toBe(true)
    })

    it('shows participants one ordered, sanitized timeline with every family and its parents', async () => {
      const dto = await world.evidence.getContractLedgerEvidence(
        CONTRACT_ID.toHexString(),
        world.contractRow
      )

      expect(dto.networkMode).toBe('fabric')
      const types = dto.events.map(event => event.eventType)
      expect(types).toEqual(
        expect.arrayContaining([
          'contract.activated',
          'deposit.paid',
          'payment.paid',
          'governance.published',
          'move-in.settled',
          'handover.completed',
        ])
      )
      expect(
        dto.events.filter(event => event.status === 'confirmed').length
      ).toBeGreaterThanOrEqual(6)
      const activation = dto.events.find(
        event => event.eventType === 'contract.activated'
      )
      expect(activation?.dependsOn).toBe(
        `deposit:${DEPOSIT_ID.toHexString().slice(-6)}:deposit.paid,governance-snapshot:${snapshotId.slice(-6)}:governance.published`
      )
      for (const event of dto.events.filter(e => e.status === 'confirmed')) {
        expect(event.txId).toMatch(/^fabric-tx-\d+$/)
        expect(event.blockNumber).toBeGreaterThan(100)
        expect(event.explorerUrl).toBe(
          `https://explorer.example.com/tx/${event.txId}`
        )
        expect(event.payloadHash).toMatch(/^[a-f0-9]{64}$/)
      }
    })

    it('never lets personal data or private handover details reach the outbox, the ledger or the participant view', async () => {
      const dto = await world.evidence.getContractLedgerEvidence(
        CONTRACT_ID.toHexString(),
        world.contractRow
      )
      const haystacks = [
        JSON.stringify(world.outboxRows.rows),
        JSON.stringify([...world.ledger.world.values()]),
        JSON.stringify(world.ledger.submitted),
        JSON.stringify(dto),
      ]
      for (const text of haystacks) {
        for (const secret of PII) expect(text).not.toContain(secret)
        expect(text).not.toContain('meterReadings')
        expect(text).not.toContain('keyCount')
      }
    })

    it('verifies governance, settlement and handover against the ledger with matching hashes', async () => {
      const settlementKey = `MOVEIN_${SETTLEMENT_ID.toHexString()}`
      expect(
        await world.ledger.evaluateTransaction('readMoveInSettlement', [
          SETTLEMENT_ID.toHexString(),
        ])
      ).toBe(world.ledger.world.get(settlementKey))
      expect(
        await world.ledger.evaluateTransaction('readGovernanceSnapshot', [
          snapshotId,
        ])
      ).toMatchObject({
        manifestHash: world.snapshots.rows[0]?.manifestHash,
      })
    })
  })

  describe('chaincode without evidence schema v3', () => {
    it('holds the activation with CHAINCODE_UPGRADE_REQUIRED (never dropping the governance reference) until the chaincode is upgraded', async () => {
      const world = buildWorld()
      world.ledger.evidenceSchemaVersions = [2]
      await world.enqueueDeposit()
      await world.governance.publish(ADMIN)
      await world.activate()

      await world.cycle(2)
      expect(
        world.item(`deposit:${DEPOSIT_ID.toHexString()}:deposit.paid`).status
      ).toBe('confirmed')
      expect(world.item(CONTRACT_KEY)).toMatchObject({
        status: 'pending',
        errorCode: 'CHAINCODE_UPGRADE_REQUIRED',
      })
      expect(actions(world)).not.toContain('createContract')

      world.ledger.evidenceSchemaVersions = [2, 3]
      await world.cycle()
      expect(world.item(CONTRACT_KEY).status).toBe('confirmed')
      expect(
        world.ledger.world.get(`CONTRACT_${CONTRACT_ID.toHexString()}`)
          ?.governanceSnapshotId
      ).toBeTruthy()
    })
  })

  describe('legacy behaviour without a published snapshot', () => {
    it('keeps the v2 single-parent activation byte-for-byte and needs no governance', async () => {
      const world = buildWorld()
      await world.enqueueDeposit()
      await world.activate()

      expect(world.contractRow.governanceSnapshotRef ?? null).toBeNull()
      const activation = world.item(CONTRACT_KEY)
      expect(activation.dependencyKey).toBe(
        `deposit:${DEPOSIT_ID.toHexString()}:deposit.paid`
      )
      expect(activation.dependencyKeys).toEqual([
        `deposit:${DEPOSIT_ID.toHexString()}:deposit.paid`,
      ])
      world.ledger.evidenceSchemaVersions = [2]
      await world.cycle()
      expect(world.item(CONTRACT_KEY).status).toBe('confirmed')
      expect(
        world.ledger.world.get(`CONTRACT_${CONTRACT_ID.toHexString()}`)
          ?.governanceSnapshotId
      ).toBeNull()
    })
  })

  describe('simulation mode keeps honest labels', () => {
    it('confirms evidence as simulation with no transaction hash or block number, and the participant view shows no block or Explorer link', async () => {
      const world = buildWorld({ simulation: true, withDeposit: false })
      await (world.backend as FabricService).onModuleInit()
      const published = await world.governance.publish(ADMIN)
      await world.activate()
      await world.addSettlementAndHandover()
      await world.cycle(2)

      expect(world.item(CONTRACT_KEY)).toMatchObject({
        status: 'confirmed',
        networkMode: 'simulation',
      })
      expect(world.snapshots.rows[0]).toMatchObject({
        ledgerStatus: 'confirmed-simulation',
        txHash: null,
        blockNumber: null,
      })
      const settlement = world.settlements.rows[0] as Row
      expect(settlement.settlementEvidence).toMatchObject({
        ledgerStatus: 'confirmed-simulation',
        txHash: null,
        blockNumber: null,
      })
      expect(settlement.handoverEvidence).toMatchObject({
        ledgerStatus: 'confirmed-simulation',
        txHash: null,
        blockNumber: null,
      })
      expect(world.contractRow.ledgerNetworkMode).toBe('simulation')

      const dto = await world.evidence.getContractLedgerEvidence(
        CONTRACT_ID.toHexString(),
        world.contractRow
      )
      expect(dto.networkMode).toBe('simulation')
      expect(dto.explorerAvailable).toBe(false)
      for (const event of dto.events) {
        expect(event.blockNumber).toBeNull()
        expect(event.explorerUrl).toBeNull()
      }
      expect(JSON.stringify(world.snapshots.rows)).not.toContain('sim_')
      expect(published.snapshot.ledgerStatus).toBeDefined()
    })
  })
})
