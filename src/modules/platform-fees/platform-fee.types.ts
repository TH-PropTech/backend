export type PlatformFeeScheduleRules = {
  landlordCommission: {
    tiers: Array<{
      minDurationMonths: number
      maxDurationMonths: number
      basis: 'MONTHS_OF_RENT' | 'PERCENT_OF_TOTAL_RENT'
      value: number
      minAmount?: number
      maxAmount?: number
    }>
    dueDaysAfterActivation: number
  }
  tenantServiceFee: {
    basis: 'FIXED' | 'PERCENT_OF_MONTHLY_RENT'
    value: number
    minAmount?: number
    maxAmount?: number
  } | null
  vatRatePercent: number
  pricesIncludeVat: boolean
  roundingUnit: 1000
  disclosure: { tenantText: string; landlordText: string }
}

export type FeeQuoteLine = {
  feeKind: 'LANDLORD_COMMISSION' | 'TENANT_SERVICE'
  payerRole: 'landlord' | 'tenant'
  amountBeforeVat: number
  vatAmount: number
  amount: number
}
