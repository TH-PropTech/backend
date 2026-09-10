export const SUPPORTED_RENTAL_DURATIONS = [1, 3, 6, 12] as const

export type RentalDurationMonths = (typeof SUPPORTED_RENTAL_DURATIONS)[number]

export type DepositPolicyInput =
  | { type: 'MONTHS_OF_RENT'; months: number }
  | { type: 'FIXED_AMOUNT'; amount: number }

export type RentalPackageInput = {
  packageId: string
  version: number
  durationMonths: number
  monthlyRent: number
  depositPolicy: DepositPolicyInput
  status: 'active' | 'inactive'
}

export type RentalPackageSnapshot = {
  packageId: string
  version: number
  durationMonths: RentalDurationMonths
  monthlyRent: number
  depositPolicy: DepositPolicyInput
  resolvedDepositAmount: number
}

export type RentalPackageRecord = RentalPackageSnapshot & {
  status: 'active' | 'inactive'
}

export type RentalPackageValidationResult = {
  pricingMode: 'packages' | 'legacy'
  representativeMonthlyRent: number | null
  packages: RentalPackageRecord[]
}

function isSupportedDuration(value: number): value is RentalDurationMonths {
  return (SUPPORTED_RENTAL_DURATIONS as readonly number[]).includes(value)
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function resolveDepositAmount(
  monthlyRent: number,
  policy: DepositPolicyInput
): number {
  if (policy.type === 'MONTHS_OF_RENT') {
    if (!isPositiveInteger(policy.months) || policy.months > 12) {
      throw new Error('INVALID_RENTAL_PACKAGE: invalid deposit months')
    }
    return monthlyRent * policy.months
  }

  if (!isPositiveInteger(policy.amount)) {
    throw new Error('INVALID_RENTAL_PACKAGE: invalid fixed deposit amount')
  }
  return policy.amount
}

export function calculateRepresentativeMonthlyRent(
  packages: RentalPackageInput[]
): number | null {
  const activeRents = packages
    .filter(packageItem => packageItem.status === 'active')
    .map(packageItem => packageItem.monthlyRent)

  return activeRents.length > 0 ? Math.min(...activeRents) : null
}

export function validateRentalPackages(
  packages: RentalPackageInput[]
): RentalPackageValidationResult {
  if (packages.length === 0) {
    return {
      pricingMode: 'legacy',
      representativeMonthlyRent: null,
      packages: [],
    }
  }

  const activeDurations = new Set<number>()
  const snapshots = packages.map(packageItem => {
    if (
      packageItem.packageId.trim() === '' ||
      !Number.isInteger(packageItem.version) ||
      packageItem.version < 1 ||
      !isSupportedDuration(packageItem.durationMonths) ||
      !isPositiveInteger(packageItem.monthlyRent)
    ) {
      throw new Error('INVALID_RENTAL_PACKAGE: invalid package fields')
    }

    if (packageItem.status === 'active') {
      if (activeDurations.has(packageItem.durationMonths)) {
        throw new Error('INVALID_RENTAL_PACKAGE: duplicate active duration')
      }
      activeDurations.add(packageItem.durationMonths)
    }

    const resolvedDepositAmount = resolveDepositAmount(
      packageItem.monthlyRent,
      packageItem.depositPolicy
    )

    return {
      packageId: packageItem.packageId,
      version: packageItem.version,
      durationMonths: packageItem.durationMonths,
      monthlyRent: packageItem.monthlyRent,
      depositPolicy: packageItem.depositPolicy,
      resolvedDepositAmount,
      status: packageItem.status,
    }
  })

  if (activeDurations.size === 0) {
    throw new Error(
      'INVALID_RENTAL_PACKAGE: at least one active package required'
    )
  }

  return {
    pricingMode: 'packages',
    representativeMonthlyRent: Math.min(
      ...snapshots
        .filter((_packageItem, index) => packages[index]?.status === 'active')
        .map(packageItem => packageItem.monthlyRent)
    ),
    packages: snapshots,
  }
}
