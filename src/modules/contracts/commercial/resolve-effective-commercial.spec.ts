import { resolveEffectiveCommercial } from './resolve-effective-commercial'
import type { Contract } from '../schemas/contract.schema'

describe('resolveEffectiveCommercial', () => {
  const base = {
    monthlyRent: 10_000_000,
    deposit: 20_000_000,
    paymentDay: 1,
    latePenaltyRate: 0,
    terminationNoticeDays: 30,
    durationMonths: 12,
  }

  it('prefers the explicit effective snapshot', () => {
    expect(
      resolveEffectiveCommercial({
        ...base,
        effectiveCommercial: { ...base, monthlyRent: 12_000_000 },
        commercialDraft: { ...base, monthlyRent: 11_000_000 },
        contentLockedAt: new Date(),
      } as Contract).monthlyRent
    ).toBe(12_000_000)
  })

  it('uses a locked draft and ignores an unlocked draft', () => {
    const draft = { ...base, monthlyRent: 12_000_000 }
    expect(
      resolveEffectiveCommercial({
        ...base,
        commercialDraft: draft,
        contentLockedHash: 'locked',
      } as Contract)
    ).toEqual(draft)
    expect(
      resolveEffectiveCommercial({
        ...base,
        commercialDraft: draft,
      } as Contract).monthlyRent
    ).toBe(base.monthlyRent)
  })

  it('merges contract-level occupants and utility rates into every source', () => {
    const occupants = [
      { fullName: 'Nguyễn Văn A', birthYear: 1995, relationship: 'Bạn' },
    ]
    const utilityRates = {
      electricityPerKwh: 3500,
      waterPerM3: 20000,
      serviceFeeMonthly: 0,
    }
    const contract = { ...base, occupants, utilityRates } as Contract
    expect(resolveEffectiveCommercial(contract)).toMatchObject({
      occupants,
      utilityRates,
    })
    const amended = [
      { fullName: 'Trần Thị B', birthYear: 2000, relationship: 'Chị' },
    ]
    expect(
      resolveEffectiveCommercial({
        ...contract,
        effectiveCommercial: { ...base, occupants: amended },
      }).occupants
    ).toEqual(amended)
  })

  it('falls back to immutable legacy contract fields', () => {
    expect(resolveEffectiveCommercial(base as Contract)).toEqual(base)
  })
})
