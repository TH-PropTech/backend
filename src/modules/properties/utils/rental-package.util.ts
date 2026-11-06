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

/**
 * Tiền thuê tenant phải trả TRƯỚC (cùng lúc đặt cọc / nhận nhà), tách khỏi tiền cọc:
 * - NONE: chỉ đặt cọc, không thu trước tiền thuê; kỳ thuê đầu tiên thu theo lịch thanh toán thường.
 * - MONTHS: trả trước `months` tháng tiền thuê (1..thời hạn gói).
 * - FULL: trả trước toàn bộ tiền thuê của thời hạn gói.
 * Vắng mặt = gói cũ, giữ hành vi cũ (kỳ thanh toán đầu thu khi nhận nhà).
 */
export type PrepaidRentInput =
  | { type: 'NONE' }
  | { type: 'MONTHS'; months: number }
  | { type: 'FULL' }

export type SettlementPolicyInput = {
  holdingDeposit?: HoldingDepositInput
  allowedPaymentCycles: Array<1 | 3 | 6>
  defaultPaymentCycle: 1 | 3 | 6
  firstPaymentDueOffsetDays: number
}

import {
  MAX_CUSTOM_CLAUSES_LENGTH,
  validateLeaseCompliance,
} from '../../contracts/legal/lease-compliance.validator'
import {
  DEFAULT_MOVE_OUT_RESPONSE_DAYS,
  MAX_MOVE_OUT_RESPONSE_DAYS,
  MIN_MOVE_OUT_RESPONSE_DAYS,
} from '../../rental/utils/deposit-refund.constants'
import type { RentalExecutionPolicyRef } from '../../rental/utils/rental-execution-policy.util'

/** Số ngày theo lịch khách có để phản hồi biên bản trả nhà và bảng khấu trừ cọc. */
export type MoveOutPolicy = { responseDays: number }

export type RentalPackageInput = {
  packageId: string
  version: number
  durationMonths: number
  monthlyRent: number
  depositPolicy: DepositPolicyInput
  status: 'active' | 'inactive'
  settlementPolicy?: SettlementPolicyInput
  paymentDay?: number
  latePenaltyRate?: number
  terminationNoticeDays?: number
  customClauses?: string
  utilityRates?: UtilityRates
  prepaidRent?: PrepaidRentInput
  moveOutPolicy?: MoveOutPolicy
  allowedExecutionPolicies?: RentalExecutionPolicyRef[]
  defaultExecutionPolicy?: RentalExecutionPolicyRef
}

/** Đơn giá điện, nước, dịch vụ do hai bên thỏa thuận; không phải giá nhà nước quy định. */
export type UtilityRates = {
  electricityPerKwh: number
  waterPerM3: number
  serviceFeeMonthly: number
  note?: string
}

const MAX_UTILITY_RATE_VND = 10_000_000
const MAX_UTILITY_NOTE_LENGTH = 500

/** Trả về thông báo lỗi tiếng Việt đầu tiên, hoặc null khi đơn giá hợp lệ. */
export function validateUtilityRates(rates: UtilityRates): string | null {
  const fields: Array<[keyof UtilityRates, string]> = [
    ['electricityPerKwh', 'Đơn giá điện'],
    ['waterPerM3', 'Đơn giá nước'],
    ['serviceFeeMonthly', 'Phí dịch vụ hằng tháng'],
  ]
  for (const [key, label] of fields) {
    const value = rates[key]
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > MAX_UTILITY_RATE_VND
    ) {
      return `${label} phải là số từ 0 đến ${MAX_UTILITY_RATE_VND.toLocaleString('vi-VN')} đồng.`
    }
  }
  if (rates.note !== undefined && rates.note.length > MAX_UTILITY_NOTE_LENGTH) {
    return `Ghi chú cách tính tối đa ${MAX_UTILITY_NOTE_LENGTH} ký tự.`
  }
  return null
}

export type RentalPackageSnapshot = {
  packageId: string
  version: number
  durationMonths: RentalDurationMonths
  monthlyRent: number
  depositPolicy: DepositPolicyInput
  resolvedDepositAmount: number
  /** Điều khoản hợp đồng do chủ nhà đặt. Vắng mặt = gói cũ (1 / 0 / 30 / rỗng). */
  paymentDay?: number
  latePenaltyRate?: number
  terminationNoticeDays?: number
  customClauses?: string
  utilityRates?: UtilityRates
  settlementPolicy?: SettlementPolicyInput
  resolvedHoldingDepositAmount?: number
  resolvedSecurityTopUpAmount?: number
  prepaidRent?: PrepaidRentInput
  /** Số tháng tiền thuê trả trước đã quy đổi (0 = chỉ cọc). Vắng mặt = gói cũ. */
  resolvedPrepaidRentMonths?: number
  resolvedPrepaidRentAmount?: number
  /** Vắng mặt = gói cũ, đọc là mặc định 3 ngày. Được chốt vào snapshot khi khách nộp đơn. */
  moveOutPolicy?: MoveOutPolicy
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

/** Ceiling for a monthly rent in VND (1 billion): above it the figure is a slip in the unit. */
export const MAX_MONTHLY_RENT_VND = 1_000_000_000
const MAX_DEPOSIT_MONTHS = 12

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
  if (policy.amount > monthlyRent * MAX_DEPOSIT_MONTHS) {
    throw new Error(
      'INVALID_RENTAL_PACKAGE: fixed deposit exceeds 12 months of rent'
    )
  }
  return policy.amount
}

/** Quy đổi chính sách trả trước thành số tháng và số tiền; ném lỗi nếu số tháng không hợp lệ. */
export function resolvePrepaidRent(
  policy: PrepaidRentInput,
  monthlyRent: number,
  durationMonths: number
): Pick<
  RentalPackageSnapshot,
  'prepaidRent' | 'resolvedPrepaidRentMonths' | 'resolvedPrepaidRentAmount'
> {
  let months: number
  if (policy.type === 'NONE') {
    months = 0
  } else if (policy.type === 'FULL') {
    months = durationMonths
  } else if (policy.type === 'MONTHS') {
    if (
      !Number.isInteger(policy.months) ||
      policy.months < 1 ||
      policy.months > durationMonths
    ) {
      throw new Error('INVALID_RENTAL_PACKAGE: invalid prepaid rent months')
    }
    months = policy.months
  } else {
    throw new Error('INVALID_RENTAL_PACKAGE: invalid prepaid rent type')
  }
  return {
    prepaidRent: policy,
    resolvedPrepaidRentMonths: months,
    resolvedPrepaidRentAmount: monthlyRent * months,
  }
}

/** Kiểm tra số ngày phản hồi (số nguyên 1..15); gói cũ không có trường thì dùng mặc định. */
export function resolveMoveOutPolicy(policy?: MoveOutPolicy): MoveOutPolicy {
  if (!policy) return { responseDays: DEFAULT_MOVE_OUT_RESPONSE_DAYS }
  const days = policy.responseDays
  if (
    !Number.isInteger(days) ||
    days < MIN_MOVE_OUT_RESPONSE_DAYS ||
    days > MAX_MOVE_OUT_RESPONSE_DAYS
  ) {
    throw new Error('INVALID_RENTAL_PACKAGE: invalid move-out response days')
  }
  return { responseDays: days }
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

type LeaseTermsFields = Pick<
  RentalPackageInput,
  | 'paymentDay'
  | 'latePenaltyRate'
  | 'terminationNoticeDays'
  | 'customClauses'
  | 'utilityRates'
>

/** Kiểm tra điều khoản hợp đồng do chủ nhà đặt và chỉ giữ lại các trường được nhập. */
function resolveLeaseTerms(packageItem: LeaseTermsFields): LeaseTermsFields {
  const { paymentDay, latePenaltyRate, terminationNoticeDays } = packageItem
  const customClauses = packageItem.customClauses?.trim()
  const { utilityRates } = packageItem
  if (utilityRates) {
    const utilityError = validateUtilityRates(utilityRates)
    if (utilityError) throw new Error(`INVALID_RENTAL_PACKAGE: ${utilityError}`)
  }
  if (
    paymentDay !== undefined &&
    (!Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 31)
  ) {
    throw new Error('INVALID_RENTAL_PACKAGE: invalid payment day')
  }
  if (customClauses && customClauses.length > MAX_CUSTOM_CLAUSES_LENGTH) {
    throw new Error('INVALID_RENTAL_PACKAGE: custom clauses too long')
  }
  const violations = validateLeaseCompliance({
    latePenaltyRate: latePenaltyRate ?? 0,
    terminationNoticeDays: terminationNoticeDays ?? 30,
  })
  if (violations.length > 0) {
    throw new Error(`INVALID_RENTAL_PACKAGE: ${violations.join('; ')}`)
  }
  return {
    ...(paymentDay !== undefined ? { paymentDay } : {}),
    ...(latePenaltyRate !== undefined ? { latePenaltyRate } : {}),
    ...(terminationNoticeDays !== undefined ? { terminationNoticeDays } : {}),
    ...(customClauses ? { customClauses } : {}),
    ...(utilityRates ? { utilityRates } : {}),
  }
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
      !isPositiveInteger(packageItem.monthlyRent) ||
      packageItem.monthlyRent > MAX_MONTHLY_RENT_VND
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
    const prepaidSnapshot = packageItem.prepaidRent
      ? resolvePrepaidRent(
          packageItem.prepaidRent,
          packageItem.monthlyRent,
          packageItem.durationMonths
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
      ...prepaidSnapshot,
      moveOutPolicy: resolveMoveOutPolicy(packageItem.moveOutPolicy),
      ...resolveLeaseTerms(packageItem),
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
