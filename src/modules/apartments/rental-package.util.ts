/** Durations allowed when creating or revising a listing package. */
export const SUPPORTED_RENTAL_DURATIONS = [3, 6, 12, 24] as const

/** One-month packages are retained only for historical read compatibility. */
export const LEGACY_RENTAL_DURATIONS = [1] as const

export type RentalDurationMonths =
  | (typeof LEGACY_RENTAL_DURATIONS)[number]
  | (typeof SUPPORTED_RENTAL_DURATIONS)[number]

export type AuthorableRentalDuration =
  (typeof SUPPORTED_RENTAL_DURATIONS)[number]

export type DepositPolicyInput =
  | { type: 'MONTHS_OF_RENT'; months: number }
  | { type: 'FIXED_AMOUNT'; amount: number }

export type HoldingDepositInput =
  | { type: 'FIXED_AMOUNT'; amount: number }
  | { type: 'PERCENT_OF_SECURITY'; percent: number }

export type SettlementPolicyInput = {
  holdingDeposit?: HoldingDepositInput
  allowedPaymentCycles: Array<1 | 3 | 6>
  defaultPaymentCycle: 1 | 3 | 6
  firstPaymentDueOffsetDays: number
}

import type { RentalExecutionPolicyRef } from '../rental-flow-config/rental-execution-policy.util'

export type RentalPackageInput = {
  packageId: string
  version: number
  durationMonths: number
  monthlyRent: number
  depositPolicy: DepositPolicyInput
  status: 'active' | 'inactive'
  settlementPolicy?: SettlementPolicyInput
  allowedExecutionPolicies?: RentalExecutionPolicyRef[]
  defaultExecutionPolicy?: RentalExecutionPolicyRef
}

export type RentalPackageSnapshot = {
  packageId: string
  version: number
  durationMonths: RentalDurationMonths
  monthlyRent: number
  depositPolicy: DepositPolicyInput
  resolvedDepositAmount: number
  settlementPolicy?: SettlementPolicyInput
  resolvedHoldingDepositAmount?: number
  resolvedSecurityTopUpAmount?: number
  currency?: 'VND'
  capturedAt?: Date
  allowedExecutionPolicies?: RentalExecutionPolicyRef[]
  defaultExecutionPolicy?: RentalExecutionPolicyRef
}

export type RentalPackageRecord = RentalPackageSnapshot & {
  status: 'active' | 'inactive'
}

export type RentalPackageValidationResult = {
  pricingMode: 'packages' | 'legacy'
  representativeMonthlyRent: number | null
  packages: RentalPackageRecord[]
}

function isAuthorableDuration(
  value: number
): value is AuthorableRentalDuration {
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

export function validateSettlementPolicy(
  policy: SettlementPolicyInput,
  durationMonths: number,
  securityDepositAmount: number
): Pick<
  RentalPackageSnapshot,
  | 'settlementPolicy'
  | 'resolvedHoldingDepositAmount'
  | 'resolvedSecurityTopUpAmount'
> {
  for (const cycleMonths of policy.allowedPaymentCycles) {
    if (cycleMonths > durationMonths) {
      throw new Error('PAYMENT_CYCLE_EXCEEDS_DURATION')
    }
    if (durationMonths % cycleMonths !== 0) {
      throw new Error('PAYMENT_CYCLE_NOT_DIVISOR')
    }
  }

  if (!policy.allowedPaymentCycles.includes(policy.defaultPaymentCycle)) {
    throw new Error('DEFAULT_CYCLE_NOT_ALLOWED')
  }

  if (
    !Number.isInteger(policy.firstPaymentDueOffsetDays) ||
    policy.firstPaymentDueOffsetDays < 0 ||
    policy.firstPaymentDueOffsetDays > 15
  ) {
    throw new Error('FIRST_PAYMENT_OFFSET_INVALID')
  }

  if (!policy.holdingDeposit) {
    return { settlementPolicy: policy }
  }

  const holdingDeposit = policy.holdingDeposit
  const rawHoldingDepositAmount =
    holdingDeposit.type === 'FIXED_AMOUNT'
      ? holdingDeposit.amount
      : (securityDepositAmount * holdingDeposit.percent) / 100

  if (
    !Number.isFinite(rawHoldingDepositAmount) ||
    rawHoldingDepositAmount <= 0
  ) {
    throw new Error('HOLDING_DEPOSIT_INVALID')
  }

  const resolvedHoldingDepositAmount =
    Math.floor(rawHoldingDepositAmount / 1000) * 1000

  if (resolvedHoldingDepositAmount <= 0) {
    throw new Error('HOLDING_DEPOSIT_INVALID')
  }
  if (resolvedHoldingDepositAmount > securityDepositAmount) {
    throw new Error('HOLDING_DEPOSIT_EXCEEDS_SECURITY')
  }

  return {
    settlementPolicy: policy,
    resolvedHoldingDepositAmount,
    resolvedSecurityTopUpAmount:
      securityDepositAmount - resolvedHoldingDepositAmount,
  }
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
      !isAuthorableDuration(packageItem.durationMonths) ||
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
    const settlementSnapshot = packageItem.settlementPolicy
      ? validateSettlementPolicy(
          packageItem.settlementPolicy,
          packageItem.durationMonths,
          resolvedDepositAmount
        )
      : {}

    return {
      packageId: packageItem.packageId,
      version: packageItem.version,
      durationMonths: packageItem.durationMonths,
      monthlyRent: packageItem.monthlyRent,
      depositPolicy: packageItem.depositPolicy,
      resolvedDepositAmount,
      status: packageItem.status,
      ...settlementSnapshot,
      ...(packageItem.allowedExecutionPolicies
        ? { allowedExecutionPolicies: packageItem.allowedExecutionPolicies }
        : {}),
      ...(packageItem.defaultExecutionPolicy
        ? { defaultExecutionPolicy: packageItem.defaultExecutionPolicy }
        : {}),
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
