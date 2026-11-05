/** Giới hạn pháp lý mặc định khi chưa đọc được chính sách từ DB. */
export const DEFAULT_LEASE_COMPLIANCE_LIMITS = Object.freeze({
  maxLatePenaltyRatePerYear: 20,
  minTerminationNoticeDays: 30,
  maxDepositPercent: 5,
})

export const MAX_CUSTOM_CLAUSES_LENGTH = 2000

export type LeaseComplianceLimits = {
  maxLatePenaltyRatePerYear: number
  minTerminationNoticeDays: number
  maxDepositPercent: number
}

export type LeaseComplianceInput = {
  latePenaltyRate: number
  terminationNoticeDays: number
  deposit?: number | undefined
  propertyValue?: number | undefined
  startDate?: Date | undefined
  endDate?: Date | undefined
}

/** Trả về danh sách vi phạm (rỗng = hợp lệ), mỗi mục kèm căn cứ pháp lý. */
export function validateLeaseCompliance(
  input: LeaseComplianceInput,
  limits: LeaseComplianceLimits = DEFAULT_LEASE_COMPLIANCE_LIMITS
): string[] {
  const violations: string[] = []

  if (input.latePenaltyRate > limits.maxLatePenaltyRatePerYear) {
    violations.push(
      `Lãi suất phạt chậm đóng ${input.latePenaltyRate}%/năm vượt mức tối đa ${limits.maxLatePenaltyRatePerYear}%/năm ` +
        `theo Khoản 1 Điều 468 Bộ luật Dân sự 2015`
    )
  }

  if (input.terminationNoticeDays < limits.minTerminationNoticeDays) {
    violations.push(
      `Thời hạn báo trước chấm dứt ${input.terminationNoticeDays} ngày thấp hơn tối thiểu ${limits.minTerminationNoticeDays} ngày ` +
        `theo Khoản 3 Điều 130 Luật Nhà ở 2023`
    )
  }

  const { deposit, propertyValue } = input
  if (
    deposit !== undefined &&
    propertyValue !== undefined &&
    propertyValue > 0
  ) {
    const depositPercent = (deposit / propertyValue) * 100
    if (depositPercent > limits.maxDepositPercent) {
      violations.push(
        `Tiền cọc ${deposit.toLocaleString('vi-VN')}đ chiếm ${depositPercent.toFixed(1)}% giá trị tài sản, ` +
          `vượt mức tối đa ${limits.maxDepositPercent}% theo Khoản 5 Điều 23 Luật KDBDS 2023`
      )
    }
  }

  if (input.startDate && input.endDate && input.endDate <= input.startDate) {
    violations.push('Ngày kết thúc hợp đồng phải sau ngày bắt đầu')
  }

  return violations
}

type PolicyValueReader = {
  getValue(key: string, fallback: string): Promise<string>
}

/** Đọc giới hạn pháp lý hiện hành từ chính sách; thiếu chính sách thì dùng mặc định. */
export async function loadLeaseComplianceLimits(
  policies: PolicyValueReader
): Promise<LeaseComplianceLimits> {
  const [maxRate, minNotice, maxDeposit] = await Promise.all([
    policies.getValue(
      'MAX_LATE_PAYMENT_INTEREST_RATE_YEAR',
      String(DEFAULT_LEASE_COMPLIANCE_LIMITS.maxLatePenaltyRatePerYear)
    ),
    policies.getValue(
      'MIN_TERMINATION_NOTICE_DAYS',
      String(DEFAULT_LEASE_COMPLIANCE_LIMITS.minTerminationNoticeDays)
    ),
    policies.getValue(
      'MAX_DEPOSIT_LIMIT_PERCENT',
      String(DEFAULT_LEASE_COMPLIANCE_LIMITS.maxDepositPercent)
    ),
  ])
  return {
    maxLatePenaltyRatePerYear: Number(maxRate),
    minTerminationNoticeDays: Number(minNotice),
    maxDepositPercent: Number(maxDeposit),
  }
}
