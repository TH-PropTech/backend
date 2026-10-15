import type { PlatformFeeScheduleRules } from '../modules/payments/utils/platform-fee.types'
import type {
  PlatformFeeScheduleRepository,
  PlatformFeeScheduleView,
} from '../modules/payments/utils/platform-fee-schedule.repository'

export const PLATFORM_FEE_DRAFT_SEED: PlatformFeeScheduleRules = {
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
  disclosure: {
    tenantText: 'Phí dịch vụ nền tảng được thanh toán riêng.',
    landlordText: 'Hoa hồng nền tảng được thanh toán riêng.',
  },
}

export async function seedPlatformFeeDraft(
  repository: Pick<PlatformFeeScheduleRepository, 'findOne' | 'create' | 'save'>
): Promise<PlatformFeeScheduleView> {
  const existing = await repository.findOne({
    where: { scheduleId: 'platform-fee-default', version: 1 },
  })
  if (existing) return existing
  return repository.save(
    repository.create({
      scheduleId: 'platform-fee-default',
      version: 1,
      status: 'draft',
      rules: PLATFORM_FEE_DRAFT_SEED,
      legalReviewStatus: 'draft',
      reviewReference: null,
      contentHash: null,
      draftRevision: 1,
      createdBy: 'seed',
    })
  )
}
