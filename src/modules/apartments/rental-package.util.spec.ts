import {
  calculateRepresentativeMonthlyRent,
  validateSettlementPolicy,
  validateRentalPackages,
  type RentalPackageInput,
  type SettlementPolicyInput,
} from './rental-package.util'

describe('rental package rules', () => {
  const validPackages: RentalPackageInput[] = [
    {
      packageId: 'pkg-12',
      version: 1,
      durationMonths: 12,
      monthlyRent: 12_000_000,
      depositPolicy: { type: 'MONTHS_OF_RENT', months: 2 },
      status: 'active',
    },
    {
      packageId: 'pkg-3',
      version: 1,
      durationMonths: 3,
      monthlyRent: 14_000_000,
      depositPolicy: { type: 'FIXED_AMOUNT', amount: 20_000_000 },
      status: 'active',
    },
  ]

  it('derives the representative rent from active packages', () => {
    expect(calculateRepresentativeMonthlyRent(validPackages)).toBe(12_000_000)
  })

  it('rejects duplicate durations and invalid deposit policies', () => {
    const firstPackage = validPackages[0]!
    const duplicate = [
      ...validPackages,
      { ...firstPackage, packageId: 'pkg-12-b' },
    ]

    expect(() => validateRentalPackages(duplicate)).toThrow(
      'INVALID_RENTAL_PACKAGE'
    )
    expect(() =>
      validateRentalPackages([
        {
          ...firstPackage,
          depositPolicy: { type: 'MONTHS_OF_RENT', months: 0 },
        },
      ])
    ).toThrow('INVALID_RENTAL_PACKAGE')
  })

  it('accepts a legacy listing without packages for read compatibility', () => {
    expect(validateRentalPackages([])).toEqual({
      pricingMode: 'legacy',
      representativeMonthlyRent: null,
      packages: [],
    })
  })

  it('allows 24-month authoring and rejects new one-month packages', () => {
    expect(
      validateRentalPackages([
        {
          ...validPackages[0]!,
          packageId: 'pkg-24',
          durationMonths: 24,
        },
      ]).packages[0]?.durationMonths
    ).toBe(24)

    expect(() =>
      validateRentalPackages([
        {
          ...validPackages[0]!,
          packageId: 'pkg-legacy-1',
          durationMonths: 1,
        },
      ])
    ).toThrow('INVALID_RENTAL_PACKAGE')
  })

  it('snapshots holding deposit and remaining security deposit for a settlement policy', () => {
    const result = validateRentalPackages([
      {
        ...validPackages[0]!,
        settlementPolicy: {
          holdingDeposit: { type: 'FIXED_AMOUNT', amount: 6_000_500 },
          allowedPaymentCycles: [1, 3, 6],
          defaultPaymentCycle: 3,
          firstPaymentDueOffsetDays: 3,
        },
      },
    ])

    expect(result.packages[0]).toMatchObject({
      resolvedDepositAmount: 24_000_000,
      settlementPolicy: {
        holdingDeposit: { type: 'FIXED_AMOUNT', amount: 6_000_500 },
        allowedPaymentCycles: [1, 3, 6],
        defaultPaymentCycle: 3,
        firstPaymentDueOffsetDays: 3,
      },
      resolvedHoldingDepositAmount: 6_000_000,
      resolvedSecurityTopUpAmount: 18_000_000,
    })
  })

  const invalidSettlementPolicies: Array<{
    code: string
    policy: Partial<SettlementPolicyInput>
    durationMonths: number
  }> = [
    {
      code: 'PAYMENT_CYCLE_EXCEEDS_DURATION',
      policy: { allowedPaymentCycles: [6], defaultPaymentCycle: 6 },
      durationMonths: 3,
    },
    {
      code: 'DEFAULT_CYCLE_NOT_ALLOWED',
      policy: { allowedPaymentCycles: [1, 3], defaultPaymentCycle: 6 },
      durationMonths: 12,
    },
    {
      code: 'HOLDING_DEPOSIT_EXCEEDS_SECURITY',
      policy: { holdingDeposit: { type: 'FIXED_AMOUNT', amount: 25_000_000 } },
      durationMonths: 12,
    },
    {
      code: 'HOLDING_DEPOSIT_INVALID',
      policy: {
        holdingDeposit: { type: 'PERCENT_OF_SECURITY', percent: 0 },
      },
      durationMonths: 12,
    },
    {
      code: 'FIRST_PAYMENT_OFFSET_INVALID',
      policy: { firstPaymentDueOffsetDays: 16 },
      durationMonths: 12,
    },
  ]

  it('rejects a payment cycle that does not divide the package duration', () => {
    expect(() =>
      validateSettlementPolicy(
        {
          allowedPaymentCycles: [3],
          defaultPaymentCycle: 3,
          firstPaymentDueOffsetDays: 0,
        },
        8,
        12_000_000
      )
    ).toThrow('PAYMENT_CYCLE_NOT_DIVISOR')
  })

  it.each(invalidSettlementPolicies)(
    'rejects settlement policy with $code',
    ({ code, policy, durationMonths }) => {
      const [packageItem] = validPackages
      if (!packageItem) throw new Error('Missing rental package test fixture')

      expect(() =>
        validateRentalPackages([
          {
            ...packageItem,
            durationMonths,
            settlementPolicy: {
              allowedPaymentCycles: [1, 3, 6],
              defaultPaymentCycle: 1,
              firstPaymentDueOffsetDays: 0,
              ...policy,
            },
          },
        ])
      ).toThrow(code)
    }
  )

  it('keeps the legacy package snapshot unchanged when settlement policy is absent', () => {
    const result = validateRentalPackages([validPackages[0]!])

    expect(result.packages[0]).toEqual({
      ...validPackages[0],
      resolvedDepositAmount: 24_000_000,
      status: 'active',
    })
  })
})
