import { renderMoveInHandoverPdf } from './move-in-handover-pdf.renderer'
import {
  UTILITY_SETTLEMENT_NOTE,
  describeUtilityRates,
  resolveContractUtilityRates,
} from './utility-note.util'
import type { Contract } from '../../contracts/schemas/contract.schema'
import type { MoveInSettlement } from '../schemas/move-in-settlement.schema'

const rates = {
  electricityPerKwh: 3500,
  waterPerM3: 20000,
  serviceFeeMonthly: 200000,
}

describe('utility note', () => {
  it('states that utilities and service fees are settled at hand-back', () => {
    expect(UTILITY_SETTLEMENT_NOTE).toContain(
      'bàn giao lại nhà khi hết hợp đồng'
    )
  })

  it('describes the agreed rates or returns null without them', () => {
    expect(describeUtilityRates(rates)).toContain('điện 3.500 đồng/kWh')
    expect(describeUtilityRates({ ...rates, note: 'Theo công tơ' })).toContain(
      'Ghi chú: Theo công tơ'
    )
    expect(describeUtilityRates(null)).toBeNull()
  })

  it('lets an amendment override the rates fixed at contract creation', () => {
    const amended = { ...rates, electricityPerKwh: 4000 }
    expect(
      resolveContractUtilityRates({
        utilityRates: rates,
        effectiveCommercial: { utilityRates: amended },
      })
    ).toEqual(amended)
    expect(resolveContractUtilityRates({ utilityRates: rates })).toEqual(rates)
    expect(resolveContractUtilityRates({})).toBeNull()
  })

  it('still renders a move-in PDF for contracts with and without rates', async () => {
    const handover = {
      revision: 1,
      handedOverAt: new Date('2030-01-05T10:00:00Z'),
      meterReadings: { electricity: 120, water: 30 },
      keyCount: 2,
      inventoryReference: null,
      inventoryItems: [],
      discrepancies: [],
      responseDueAt: null,
      completionReason: 'both-confirmed',
      notes: null,
      handoverHash: 'h'.repeat(64),
      recordedBy: 'landlord-1',
      tenantConfirmation: null,
      landlordConfirmation: { at: new Date('2030-01-05T10:00:00Z'), hash: 'h' },
      discrepancyNote: null,
      completedAt: new Date('2030-01-05T12:00:00Z'),
    }
    const settlement = { handover } as unknown as MoveInSettlement
    const base = {
      contractCode: 'HD-1',
      propertyAddress: 'Căn 101',
      landlordName: 'A',
      tenantName: 'B',
    } as Pick<
      Contract,
      'contractCode' | 'propertyAddress' | 'landlordName' | 'tenantName'
    >
    for (const utilityRates of [rates, undefined]) {
      const buffer = await renderMoveInHandoverPdf(
        { ...base, ...(utilityRates ? { utilityRates } : {}) },
        settlement
      )
      expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
    }
  })
})
