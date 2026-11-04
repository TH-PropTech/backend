import {
  calculateRepresentativeMonthlyRent,
  validateSettlementPolicy,
  validateRentalPackages,
  type RentalPackageInput,
  type RentalPackageRecord,
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

  it('accepts rents from a few hundred thousand dong up to the ceiling', () => {
    for (const monthlyRent of [100_000, 500_000, 12_000_000, 1_000_000_000]) {
      expect(() =>
        validateRentalPackages([
          { ...validPackages[0]!, monthlyRent, packageId: `r-${monthlyRent}` },
        ])
      ).not.toThrow()
    }
  })

  it('rejects a rent above one billion dong a month', () => {
    expect(() =>
      validateRentalPackages([
        { ...validPackages[0]!, monthlyRent: 1_000_000_001 },
      ])
    ).toThrow('INVALID_RENTAL_PACKAGE')
  })

  it('caps a fixed deposit at 12 months of rent', () => {
    const rent = 12_000_000
    expect(() =>
      validateRentalPackages([
        {
          ...validPackages[0]!,
          monthlyRent: rent,
          depositPolicy: { type: 'FIXED_AMOUNT', amount: rent * 12 },
        },
      ])
    ).not.toThrow()
    expect(() =>
      validateRentalPackages([
        {
          ...validPackages[0]!,
          monthlyRent: rent,
          depositPolicy: { type: 'FIXED_AMOUNT', amount: rent * 12 + 1 },
        },
      ])
    ).toThrow('fixed deposit exceeds 12 months of rent')
  })

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

  it('keeps the legacy package snapshot unchanged (except the default move-out policy) when settlement policy is absent', () => {
    const result = validateRentalPackages([validPackages[0]!])

    expect(result.packages[0]).toEqual({
      ...validPackages[0],
      moveOutPolicy: { responseDays: 3 },
      resolvedDepositAmount: 24_000_000,
      status: 'active',
    })
  })
})

describe('prepaid rent policy', () => {
  const pkg = (
    prepaidRent?: RentalPackageInput['prepaidRent']
  ): RentalPackageInput => ({
    packageId: 'pkg-6',
    version: 1,
    durationMonths: 6,
    monthlyRent: 10_000_000,
    depositPolicy: { type: 'MONTHS_OF_RENT', months: 1 },
    status: 'active',
    ...(prepaidRent ? { prepaidRent } : {}),
  })
  const first = (input: RentalPackageInput): RentalPackageRecord =>
    validateRentalPackages([input]).packages[0]!

  it('snapshots nothing extra for a legacy package without a prepayment policy', () => {
    const snapshot = first(pkg())
    expect(snapshot.prepaidRent).toBeUndefined()
    expect(snapshot.resolvedPrepaidRentMonths).toBeUndefined()
    expect(snapshot.resolvedPrepaidRentAmount).toBeUndefined()
  })

  it('resolves "deposit only" to zero prepaid months', () => {
    expect(first(pkg({ type: 'NONE' }))).toMatchObject({
      prepaidRent: { type: 'NONE' },
      resolvedPrepaidRentMonths: 0,
      resolvedPrepaidRentAmount: 0,
    })
  })

  it('resolves N prepaid months to months and money', () => {
    expect(first(pkg({ type: 'MONTHS', months: 2 }))).toMatchObject({
      resolvedPrepaidRentMonths: 2,
      resolvedPrepaidRentAmount: 20_000_000,
    })
  })

  it('resolves full prepayment to the whole package duration', () => {
    expect(first(pkg({ type: 'FULL' }))).toMatchObject({
      resolvedPrepaidRentMonths: 6,
      resolvedPrepaidRentAmount: 60_000_000,
    })
  })

  it('rejects prepaid months that are not whole months within the package duration', () => {
    for (const months of [0, -1, 1.5, 7]) {
      expect(() =>
        validateRentalPackages([pkg({ type: 'MONTHS', months })])
      ).toThrow('INVALID_RENTAL_PACKAGE: invalid prepaid rent months')
    }
  })

  it('keeps the prepayment policy independent from the deposit amount', () => {
    const snapshot = first(pkg({ type: 'MONTHS', months: 3 }))
    expect(snapshot.resolvedDepositAmount).toBe(10_000_000)
    expect(snapshot.resolvedPrepaidRentAmount).toBe(30_000_000)
  })
  describe('move-out response days', () => {
    const base: RentalPackageInput = {
      packageId: 'pkg-mo',
      version: 1,
      durationMonths: 12,
      monthlyRent: 12_000_000,
      depositPolicy: { type: 'MONTHS_OF_RENT', months: 2 },
      status: 'active',
    }
    const withDays = (responseDays: unknown): RentalPackageInput =>
      ({ ...base, moveOutPolicy: { responseDays } }) as RentalPackageInput

    it.each([1, 7, 15])('accepts %i days and keeps it in the record', days => {
      const result = validateRentalPackages([withDays(days)])
      expect(result.packages[0]?.moveOutPolicy).toEqual({ responseDays: days })
    })

    it.each([0, 16, -1, 1.5, Number.NaN, '3'])('rejects %p', days => {
      expect(() => validateRentalPackages([withDays(days)])).toThrow(
        'INVALID_RENTAL_PACKAGE: invalid move-out response days'
      )
    })

    it('defaults legacy packages without the field to 3 days', () => {
      const result = validateRentalPackages([base])
      expect(result.packages[0]?.moveOutPolicy).toEqual({ responseDays: 3 })
    })
  })
})
