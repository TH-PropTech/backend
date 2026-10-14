import { calculateFeeQuote } from './fee-calculator'
import { validateFeeRules } from './fee-rules.validator'
import type { PlatformFeeScheduleRules } from './platform-fee.types'

const rules: PlatformFeeScheduleRules = {
  landlordCommission: {
    tiers: [
      {
        minDurationMonths: 3,
        maxDurationMonths: 6,
        basis: 'MONTHS_OF_RENT',
        value: 0.5,
      },
      {
        minDurationMonths: 12,
        maxDurationMonths: 24,
        basis: 'MONTHS_OF_RENT',
        value: 1,
      },
    ],
    dueDaysAfterActivation: 7,
  },
  tenantServiceFee: {
    basis: 'PERCENT_OF_MONTHLY_RENT',
    value: 2,
    minAmount: 100_000,
    maxAmount: 500_000,
  },
  vatRatePercent: 10,
  pricesIncludeVat: false,
  roundingUnit: 1000,
  disclosure: { tenantText: 'Phí dịch vụ', landlordText: 'Hoa hồng' },
}

describe('platform fee rules', () => {
  it('calculates commission and VAT for a 12-month rental', () => {
    expect(
      calculateFeeQuote(rules, {
        durationMonths: 12,
        monthlyRent: 10_000_000,
      })[0]
    ).toEqual({
      feeKind: 'LANDLORD_COMMISSION',
      payerRole: 'landlord',
      amountBeforeVat: 10_000_000,
      vatAmount: 1_000_000,
      amount: 11_000_000,
    })
  })

  it('reports uncovered standard duration tiers', () => {
    expect(
      validateFeeRules({
        ...rules,
        landlordCommission: {
          ...rules.landlordCommission,
          tiers: rules.landlordCommission.tiers.slice(0, 1),
        },
      })
    ).toContain('COMMISSION_TIER_GAP')
  })

  it('calculates included VAT and applies min/max bounds', () => {
    const quote = calculateFeeQuote(
      { ...rules, pricesIncludeVat: true },
      { durationMonths: 12, monthlyRent: 10_000_000 }
    )
    expect(quote[0]).toEqual(
      expect.objectContaining({
        amount: 10_000_000,
        amountBeforeVat: 9_091_000,
        vatAmount: 909_000,
      })
    )
    expect(quote[1]?.amount).toBe(200_000)
  })
})
