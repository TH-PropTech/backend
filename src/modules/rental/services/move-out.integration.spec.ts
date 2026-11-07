import { ObjectId } from 'mongodb'
import { ContractEvidencePackageService } from '../../contracts/services/contract-evidence-package.service'
import type { Contract } from '../../contracts/schemas/contract.schema'
import type { DepositSettlementStatement } from '../schemas/deposit-settlement-statement.schema'
import type { MoveInSettlement } from '../schemas/move-in-settlement.schema'
import type { MoveOutHandover } from '../schemas/move-out-handover.schema'
import { DepositSettlementStatementsService } from './deposit-settlement-statements.service'
import { MoveOutHandoversService } from './move-out-handovers.service'
import {
  STORAGE_BASE,
  createMemoryRepo,
  createStorage,
  createSupportMock,
} from './move-out.fixtures'

const CONTRACT_ID = new ObjectId()
const CID = CONTRACT_ID.toHexString()
const DEPOSIT = 10_000_000
const HASH = 'a'.repeat(64)
const T0 = new Date('2030-03-01T00:00:00.000Z')
const at = (days: number): Date => new Date(T0.getTime() + days * 86_400_000)

const HANDOVER_INPUT = {
  handedBackAt: '2030-03-01T09:00:00.000Z',
  electricity: 220,
  water: 80,
  keyCount: 2,
  meterPhotos: {
    electricity: [`${STORAGE_BASE}/apartments/dien.jpg`],
    water: [`${STORAGE_BASE}/apartments/nuoc.png`],
  },
  inventoryItems: [{ name: 'Sofa', quantity: 1, condition: 'good' as const }],
}
const LINE = {
  reason: 'Sơn lại tường',
  amount: 2_000_000,
  evidenceUrls: [`${STORAGE_BASE}/apartments/a.jpg`],
}

type Ctx = {
  handovers: MoveOutHandoversService
  statements: DepositSettlementStatementsService
  handoverRepo: ReturnType<typeof createMemoryRepo<MoveOutHandover>>
  statementRepo: ReturnType<typeof createMemoryRepo<DepositSettlementStatement>>
}

function setup(): Ctx {
  const contract = {
    _id: CONTRACT_ID,
    contractCode: 'HD-1',
    tenantId: 'tenant',
    landlordId: 'landlord',
    status: 'active',
    deposit: DEPOSIT,
    packageSnapshot: { moveOutPolicy: { responseDays: 5 } },
  } as unknown as Contract
  const contractRepo = { findOne: jest.fn().mockResolvedValue(contract) }
  const settlementRepo = createMemoryRepo<MoveInSettlement>([
    { contractId: CID, handover: { completedAt: T0, inventoryItems: [] } },
  ] as unknown as MoveInSettlement[])
  const handoverRepo = createMemoryRepo<MoveOutHandover>()
  const statementRepo = createMemoryRepo<DepositSettlementStatement>()
  const support = createSupportMock(true)
  const handovers = new MoveOutHandoversService(
    handoverRepo as never,
    contractRepo as never,
    settlementRepo as never,
    support as never
  )
  const statements = new DepositSettlementStatementsService(
    statementRepo as never,
    contractRepo as never,
    handoverRepo as never,
    support as never,
    createStorage()
  )
  return { handovers, statements, handoverRepo, statementRepo }
}

async function completedHandover(ctx: Ctx): Promise<MoveOutHandover> {
  const recorded = await ctx.handovers.record(
    CID,
    'landlord',
    HANDOVER_INPUT,
    T0
  )
  return ctx.handovers.confirm(CID, 'tenant', recorded.handoverHash, at(1))
}

describe('move-out flow (handover → statement → refund → evidence)', () => {
  it('happy path: accepted statement, refund, acknowledgement, full evidence package', async () => {
    const ctx = setup()
    const handover = await completedHandover(ctx)
    expect(handover.status).toBe('completed')

    await ctx.statements.saveDraft(CID, 'landlord', [LINE], at(2))
    const submitted = await ctx.statements.submit(CID, 'landlord', at(2))
    expect(submitted.status).toBe('awaiting-tenant')
    const responded = await ctx.statements.respond(
      CID,
      'tenant',
      [{ lineId: submitted.lines[0]!.id, decision: 'accept' }],
      at(3)
    )
    expect(responded.status).toBe('accepted')

    const refunded = await ctx.statements.recordRefund(
      CID,
      'landlord',
      {
        amount: DEPOSIT - LINE.amount,
        transactionRef: 'FT1',
        paidAt: at(4).toISOString(),
      },
      at(4)
    )
    const closed = await ctx.statements.acknowledgeRefund(
      CID,
      'tenant',
      refunded.refunds[0]!.id,
      at(5)
    )
    expect(closed.status).toBe('closed')

    const plan = new ContractEvidencePackageService().buildPlan({
      contract: { id: CID, contractCode: 'HD-1', status: 'active' },
      viewer: { role: 'tenant' },
      artifact: {
        artifactId: 'a',
        revision: 1,
        contentType: 'application/pdf',
        byteLength: 10,
        recordedHash: HASH,
        computedHash: HASH,
      },
      ledgerEvents: [],
      governance: null,
      moveOut: {
        moveOutPolicy: { responseDays: 5 },
        handover: handover as never,
        statement: closed as never,
      },
      projection: { expectedHash: HASH, projectedHash: HASH },
      ledger: { status: 'verified', networkMode: 'fabric' },
      generatedAt: at(6),
    })
    expect(plan.entries.map(e => e.path)).toEqual(
      expect.arrayContaining([
        'evidence/move-out-handover.json',
        'evidence/deposit-statement.json',
        'evidence/deposit-refunds.json',
      ])
    )
  })

  it('statement is blocked until the handover is completed', async () => {
    const ctx = setup()
    await ctx.handovers.record(CID, 'landlord', HANDOVER_INPUT, T0)
    await expect(
      ctx.statements.saveDraft(CID, 'landlord', [LINE], at(1))
    ).rejects.toThrow('MOVE_OUT_HANDOVER_NOT_COMPLETED')
  })

  it('dispute path: rejected line shrinks the refundable amount, still closes after refund', async () => {
    const ctx = setup()
    await completedHandover(ctx)
    await ctx.statements.saveDraft(CID, 'landlord', [LINE], at(2))
    const submitted = await ctx.statements.submit(CID, 'landlord', at(2))
    const disputed = await ctx.statements.respond(
      CID,
      'tenant',
      [
        {
          lineId: submitted.lines[0]!.id,
          decision: 'reject',
          note: 'Không đúng',
        },
      ],
      at(3)
    )
    expect(disputed.status).toBe('disputed')
    await expect(
      ctx.statements.recordRefund(
        CID,
        'landlord',
        {
          amount: DEPOSIT + 1,
          transactionRef: 'X',
          paidAt: at(4).toISOString(),
        },
        at(4)
      )
    ).rejects.toThrow('STATEMENT_REFUND_EXCEEDS_LIMIT')
    const refunded = await ctx.statements.recordRefund(
      CID,
      'landlord',
      { amount: DEPOSIT, transactionRef: 'FT2', paidAt: at(4).toISOString() },
      at(4)
    )
    const closed = await ctx.statements.acknowledgeRefund(
      CID,
      'tenant',
      refunded.refunds[0]!.id,
      at(5)
    )
    expect(closed.status).toBe('closed')
  })

  it('tenant silence: overdue statement is auto-accepted by the deadline sweep', async () => {
    const ctx = setup()
    await completedHandover(ctx)
    await ctx.statements.saveDraft(CID, 'landlord', [LINE], at(2))
    await ctx.statements.submit(CID, 'landlord', at(2))
    expect(await ctx.statements.processDeadlines(at(2 + 6))).toBeGreaterThan(0)
    const row = await ctx.statements.findByContract(CID, 'tenant', false)
    expect(row.status).toBe('accepted')
  })
})

describe('move-out flow with meter photos and utility suggestions', () => {
  const photo = (name: string): string =>
    `${STORAGE_BASE}/apartments/${name}.jpg`

  function setupWithMeters(): Ctx {
    const contract = {
      _id: CONTRACT_ID,
      contractCode: 'HD-1',
      tenantId: 'tenant',
      landlordId: 'landlord',
      status: 'active',
      deposit: DEPOSIT,
      packageSnapshot: { moveOutPolicy: { responseDays: 5 } },
      utilityRates: {
        electricityPerKwh: 3500,
        waterPerM3: 20000,
        serviceFeeMonthly: 200000,
      },
    } as unknown as Contract
    const contractRepo = { findOne: jest.fn().mockResolvedValue(contract) }
    const settlementRepo = createMemoryRepo<MoveInSettlement>([
      {
        contractId: CID,
        handover: {
          completedAt: T0,
          inventoryItems: [],
          meterReadings: { electricity: 1200, water: 40 },
          meterPhotos: {
            electricity: [photo('in-e')],
            water: [photo('in-w')],
          },
        },
      },
    ] as unknown as MoveInSettlement[])
    const handoverRepo = createMemoryRepo<MoveOutHandover>()
    const statementRepo = createMemoryRepo<DepositSettlementStatement>()
    const support = createSupportMock(true)
    const storage = createStorage()
    const handovers = new MoveOutHandoversService(
      handoverRepo as never,
      contractRepo as never,
      settlementRepo as never,
      support as never,
      storage
    )
    const statements = new DepositSettlementStatementsService(
      statementRepo as never,
      contractRepo as never,
      handoverRepo as never,
      support as never,
      storage,
      settlementRepo as never
    )
    return { handovers, statements, handoverRepo, statementRepo }
  }

  it('move-in photos → move-out photos → suggested lines → tenant objects to one line', async () => {
    const ctx = setupWithMeters()
    const recorded = await ctx.handovers.record(
      CID,
      'landlord',
      {
        ...HANDOVER_INPUT,
        electricity: 1450,
        water: 46,
        meterPhotos: {
          electricity: [photo('out-e')],
          water: [photo('out-w')],
        },
      },
      T0
    )
    expect(recorded.meterPhotos).toEqual({
      electricity: [photo('out-e')],
      water: [photo('out-w')],
    })
    await ctx.handovers.confirm(CID, 'tenant', recorded.handoverHash, at(1))

    const suggestion = await ctx.statements.suggestUtilityLines(CID, 'landlord')
    expect(suggestion.lines.map(line => [line.kind, line.amount])).toEqual([
      ['electricity', 875_000],
      ['water', 120_000],
    ])
    expect(suggestion.lines[0]!.evidenceUrls).toEqual([
      photo('in-e'),
      photo('out-e'),
    ])

    await ctx.statements.saveDraft(
      CID,
      'landlord',
      suggestion.lines.map(line => ({
        reason: line.reason,
        amount: line.amount,
        evidenceUrls: line.evidenceUrls,
        source: 'meter-suggestion' as const,
      })),
      at(2)
    )
    const submitted = await ctx.statements.submit(CID, 'landlord', at(2))
    expect(
      submitted.lines.every(line => line.source === 'meter-suggestion')
    ).toBe(true)

    const responded = await ctx.statements.respond(
      CID,
      'tenant',
      [
        { lineId: submitted.lines[0]!.id, decision: 'reject', note: 'Sai số' },
        { lineId: submitted.lines[1]!.id, decision: 'accept' },
      ],
      at(3)
    )
    expect(responded.status).toBe('disputed')
    expect(responded.lines[0]!.tenantResponse?.decision).toBe('reject')
    expect(responded.lines[1]!.tenantResponse?.decision).toBe('accept')
  })

  it('warns when the move-out reading is below the move-in reading, then records once confirmed', async () => {
    const ctx = setupWithMeters()
    const input = {
      ...HANDOVER_INPUT,
      electricity: 1100,
      water: 46,
      meterPhotos: { electricity: [photo('out-e')], water: [photo('out-w')] },
    }
    await expect(
      ctx.handovers.record(CID, 'landlord', input, T0)
    ).rejects.toMatchObject({
      response: { code: 'METER_READING_REGRESSION' },
    })
    const recorded = await ctx.handovers.record(
      CID,
      'landlord',
      { ...input, acknowledgeMeterRegression: true },
      T0
    )
    expect(recorded.meterReadings.electricity).toBe(1100)
  })
})
