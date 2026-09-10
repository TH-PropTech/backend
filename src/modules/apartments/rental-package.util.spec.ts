import {
  calculateRepresentativeMonthlyRent,
  validateRentalPackages,
  type RentalPackageInput,
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
})
