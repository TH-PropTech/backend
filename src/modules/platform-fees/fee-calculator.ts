import type {
  FeeQuoteLine,
  PlatformFeeScheduleRules,
} from './platform-fee.types'

export function calculateFeeQuote(
  rules: PlatformFeeScheduleRules,
  input: { durationMonths: number; monthlyRent: number }
): FeeQuoteLine[] {
  const tier = rules.landlordCommission.tiers.find(
    item =>
      input.durationMonths >= item.minDurationMonths &&
      input.durationMonths <= item.maxDurationMonths
  )
  const rawCommission = tier
    ? tier.basis === 'MONTHS_OF_RENT'
      ? input.monthlyRent * tier.value
      : (input.monthlyRent * input.durationMonths * tier.value) / 100
    : 0
  const result: FeeQuoteLine[] = []
  if (tier)
    result.push(
      quoteLine(
        'LANDLORD_COMMISSION',
        'landlord',
        clamp(rawCommission, tier.minAmount, tier.maxAmount),
        rules
      )
    )
  const service = rules.tenantServiceFee
  if (service) {
    const raw =
      service.basis === 'FIXED'
        ? service.value
        : (input.monthlyRent * service.value) / 100
    result.push(
      quoteLine(
        'TENANT_SERVICE',
        'tenant',
        clamp(raw, service.minAmount, service.maxAmount),
        rules
      )
    )
  }
  return result
}

function quoteLine(
  feeKind: FeeQuoteLine['feeKind'],
  payerRole: FeeQuoteLine['payerRole'],
  rawBase: number,
  rules: PlatformFeeScheduleRules
): FeeQuoteLine {
  const unit = rules.roundingUnit
  if (rules.pricesIncludeVat) {
    const amount = ceilToUnit(rawBase, unit)
    const amountBeforeVat =
      Math.round(amount / (1 + rules.vatRatePercent / 100) / unit) * unit
    return {
      feeKind,
      payerRole,
      amountBeforeVat,
      vatAmount: amount - amountBeforeVat,
      amount,
    }
  }
  const amountBeforeVat = ceilToUnit(rawBase, unit)
  const vatAmount = ceilToUnit(
    (amountBeforeVat * rules.vatRatePercent) / 100,
    unit
  )
  return {
    feeKind,
    payerRole,
    amountBeforeVat,
    vatAmount,
    amount: amountBeforeVat + vatAmount,
  }
}

function clamp(value: number, minimum?: number, maximum?: number): number {
  return Math.max(
    minimum ?? 0,
    Math.min(maximum ?? Number.POSITIVE_INFINITY, value)
  )
}

function ceilToUnit(value: number, unit: number): number {
  return Math.ceil(value / unit) * unit
}
