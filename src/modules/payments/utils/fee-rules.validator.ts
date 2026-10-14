import type { PlatformFeeScheduleRules } from './platform-fee.types'

export function validateFeeRules(rules: PlatformFeeScheduleRules): string[] {
  const errors: string[] = []
  const requiredDurations = [3, 6, 12, 24]
  for (const duration of requiredDurations) {
    const matches = rules.landlordCommission.tiers.filter(
      tier =>
        duration >= tier.minDurationMonths && duration <= tier.maxDurationMonths
    )
    if (matches.length !== 1) errors.push('COMMISSION_TIER_GAP')
  }
  const tiers = [...rules.landlordCommission.tiers].sort(
    (a, b) => a.minDurationMonths - b.minDurationMonths
  )
  for (let i = 1; i < tiers.length; i += 1) {
    const previous = tiers[i - 1]
    const current = tiers[i]
    if (
      previous &&
      current &&
      current.minDurationMonths <= previous.maxDurationMonths
    )
      errors.push('COMMISSION_TIER_OVERLAP')
  }
  const allRules = [
    ...rules.landlordCommission.tiers,
    ...(rules.tenantServiceFee ? [rules.tenantServiceFee] : []),
  ]
  for (const rule of allRules) {
    if (!Number.isFinite(rule.value) || rule.value < 0 || rule.value > 100)
      errors.push('FEE_VALUE_INVALID')
    if (
      rule.minAmount !== undefined &&
      (!Number.isInteger(rule.minAmount) || rule.minAmount < 0)
    )
      errors.push('FEE_AMOUNT_INVALID')
    if (
      rule.maxAmount !== undefined &&
      (!Number.isInteger(rule.maxAmount) || rule.maxAmount < 0)
    )
      errors.push('FEE_AMOUNT_INVALID')
    if (
      rule.minAmount !== undefined &&
      rule.maxAmount !== undefined &&
      rule.minAmount > rule.maxAmount
    )
      errors.push('FEE_AMOUNT_RANGE_INVALID')
  }
  if (
    rules.landlordCommission.tiers.some(
      tier =>
        !Number.isInteger(tier.minDurationMonths) ||
        !Number.isInteger(tier.maxDurationMonths) ||
        tier.minDurationMonths < 1 ||
        tier.maxDurationMonths < tier.minDurationMonths
    )
  )
    errors.push('COMMISSION_TIER_INVALID')
  if (rules.vatRatePercent < 0 || rules.vatRatePercent > 20)
    errors.push('VAT_RATE_INVALID')
  if (rules.roundingUnit !== 1000) errors.push('ROUNDING_UNIT_INVALID')
  if (
    !Number.isInteger(rules.landlordCommission.dueDaysAfterActivation) ||
    rules.landlordCommission.dueDaysAfterActivation < 1 ||
    rules.landlordCommission.dueDaysAfterActivation > 365
  )
    errors.push('FEE_DUE_DAYS_INVALID')
  return [...new Set(errors)]
}
