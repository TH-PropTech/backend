import { ConflictException, ForbiddenException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Contract } from '../../contracts/schemas/contract.schema'
import type { MoveInSettlement } from '../schemas/move-in-settlement.schema'
import type { MoveOutHandover } from '../schemas/move-out-handover.schema'
import { DepositSettlementStatementsService } from './deposit-settlement-statements.service'
import {
  STORAGE_BASE,
  createMemoryRepo,
  createStorage,
  createSupportMock,
} from './move-out.fixtures'

const CONTRACT_ID = new ObjectId()
const CID = CONTRACT_ID.toHexString()
const photo = (name: string): string => `${STORAGE_BASE}/apartments/${name}.jpg`

function setup(
  options: {
    utilityRates?: Contract['utilityRates']
    moveOutStatus?: MoveOutHandover['status'] | null
    moveInMeter?: { electricity: number; water: number } | null
  } = {}
): DepositSettlementStatementsService {
  const contract = {
    _id: CONTRACT_ID,
    tenantId: 'tenant',
    landlordId: 'landlord',
    deposit: 10_000_000,
    packageSnapshot: { moveOutPolicy: { responseDays: 4 } },
    utilityRates:
      options.utilityRates === undefined
        ? {
            electricityPerKwh: 3500,
            waterPerM3: 20000,
            serviceFeeMonthly: 200000,
          }
        : options.utilityRates,
  } as unknown as Contract
  const handoverRepo = createMemoryRepo<MoveOutHandover>(
    options.moveOutStatus === null
      ? []
      : ([
          {
            contractId: CID,
            status: options.moveOutStatus ?? 'completed',
            meterReadings: { electricity: 1450, water: 46 },
            meterPhotos: {
              electricity: [photo('out-e')],
              water: [photo('out-w')],
            },
          },
        ] as unknown as MoveOutHandover[])
  )
  const settlementRepo = createMemoryRepo<MoveInSettlement>([
    {
      contractId: CID,
      handover: {
        completedAt: new Date(),
        ...(options.moveInMeter === null
          ? {}
          : {
              meterReadings: options.moveInMeter ?? {
                electricity: 1200,
                water: 40,
              },
            }),
        meterPhotos: { electricity: [photo('in-e')], water: [photo('in-w')] },
      },
    },
  ] as unknown as MoveInSettlement[])
  return new DepositSettlementStatementsService(
    createMemoryRepo() as never,
    { findOne: jest.fn().mockResolvedValue(contract) } as never,
    handoverRepo as never,
    createSupportMock(true) as never,
    createStorage(true),
    settlementRepo as never
  )
}

describe('DepositSettlementStatementsService utility suggestions', () => {
  it('suggests electricity, water and service lines from the readings and rates', async () => {
    const result = await setup().suggestUtilityLines(CID, 'landlord', 2)
    expect(result.lines.map(line => [line.kind, line.amount])).toEqual([
      ['electricity', 875_000],
      ['water', 120_000],
      ['service', 400_000],
    ])
    expect(result.lines[0]!.evidenceUrls).toEqual([
      photo('in-e'),
      photo('out-e'),
    ])
    expect(result.notes).toEqual([])
  })

  it('suggests no meter lines when the move-in readings are missing', async () => {
    const result = await setup({ moveInMeter: null }).suggestUtilityLines(
      CID,
      'landlord'
    )
    expect(result.lines).toEqual([])
    expect(result.notes).toContain('NO_MOVE_IN_READINGS')
  })

  it('reports missing rates instead of inventing prices', async () => {
    const result = await setup({ utilityRates: null }).suggestUtilityLines(
      CID,
      'landlord'
    )
    expect(result).toEqual({ lines: [], notes: ['NO_RATES'] })
  })

  it('only lets the landlord ask and only after the move-out handover completed', async () => {
    await expect(
      setup().suggestUtilityLines(CID, 'tenant')
    ).rejects.toBeInstanceOf(ForbiddenException)
    await expect(
      setup({ moveOutStatus: 'recorded' }).suggestUtilityLines(CID, 'landlord')
    ).rejects.toBeInstanceOf(ConflictException)
    await expect(
      setup({ moveOutStatus: null }).suggestUtilityLines(CID, 'landlord')
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('persists the meter-suggestion source on saved lines and leaves manual lines unchanged', async () => {
    const repo = createMemoryRepo()
    const service = new DepositSettlementStatementsService(
      repo as never,
      {
        findOne: jest.fn().mockResolvedValue({
          _id: CONTRACT_ID,
          tenantId: 'tenant',
          landlordId: 'landlord',
          deposit: 10_000_000,
          packageSnapshot: { moveOutPolicy: { responseDays: 4 } },
        }),
      } as never,
      createMemoryRepo([
        { contractId: CID, status: 'completed' },
      ] as unknown as MoveOutHandover[]) as never,
      createSupportMock(true) as never,
      createStorage(true)
    )
    const saved = await service.saveDraft(CID, 'landlord', [
      {
        reason: 'Tiền điện',
        amount: 875_000,
        evidenceUrls: [photo('in-e')],
        source: 'meter-suggestion',
      },
      { reason: 'Sơn tường', amount: 100_000 },
    ])
    expect(saved.lines[0]!.source).toBe('meter-suggestion')
    expect('source' in saved.lines[1]!).toBe(false)
  })
})
