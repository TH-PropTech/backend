import {
  DEFAULT_LEASE_COMPLIANCE_LIMITS,
  loadLeaseComplianceLimits,
  validateLeaseCompliance,
} from './lease-compliance.validator'

describe('validateLeaseCompliance', () => {
  const valid = { latePenaltyRate: 10, terminationNoticeDays: 30 }

  it('accepts terms inside the legal limits', () => {
    expect(validateLeaseCompliance(valid)).toEqual([])
  })

  it('reports each violation with its legal basis', () => {
    const violations = validateLeaseCompliance({
      latePenaltyRate: 25,
      terminationNoticeDays: 10,
      deposit: 10_000_000,
      propertyValue: 100_000_000,
      startDate: new Date('2030-02-01'),
      endDate: new Date('2030-01-01'),
    })
    expect(violations).toHaveLength(4)
    expect(violations.join(' ')).toContain('Điều 468 Bộ luật Dân sự 2015')
    expect(violations.join(' ')).toContain('Điều 130 Luật Nhà ở 2023')
    expect(violations.join(' ')).toContain('Điều 23 Luật KDBDS 2023')
  })

  it('skips the deposit check when the property value is unknown', () => {
    expect(
      validateLeaseCompliance({
        ...valid,
        deposit: 999_000_000,
        propertyValue: 0,
      })
    ).toEqual([])
  })

  it('uses the supplied limits instead of the defaults', () => {
    const strict = {
      ...DEFAULT_LEASE_COMPLIANCE_LIMITS,
      maxLatePenaltyRatePerYear: 5,
    }
    expect(validateLeaseCompliance(valid, strict)).toHaveLength(1)
  })
})

describe('loadLeaseComplianceLimits', () => {
  it('reads the three policy values as numbers', async () => {
    const values: Record<string, string> = {
      MAX_LATE_PAYMENT_INTEREST_RATE_YEAR: '15',
      MIN_TERMINATION_NOTICE_DAYS: '45',
      MAX_DEPOSIT_LIMIT_PERCENT: '8',
    }
    const limits = await loadLeaseComplianceLimits({
      getValue: (key: string) => Promise.resolve(values[key] ?? ''),
    })
    expect(limits).toEqual({
      maxLatePenaltyRatePerYear: 15,
      minTerminationNoticeDays: 45,
      maxDepositPercent: 8,
    })
  })
})
