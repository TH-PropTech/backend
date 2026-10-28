import { buildReviewedLeaseTemplateSeed } from './lease-template.seed'
import { DEPOSIT_REFUND_DUE_TEXT } from '../../rental/utils/deposit-refund.constants'

describe('reviewed lease template seed', () => {
  it.each([
    'PRIVATE_CIVIL_APARTMENT_LEASE',
    'REAL_ESTATE_BUSINESS_STANDARD',
  ] as const)('contains a complete reviewed %s baseline', profile => {
    const seed = buildReviewedLeaseTemplateSeed(profile)

    expect(seed.schemaVersion).toBe(2)
    expect(seed.clauses).toHaveLength(12)
    expect(seed.annexDefinitions).toHaveLength(4)
    expect(seed.allowedVariables).toEqual(
      expect.arrayContaining([
        'monthlyRent',
        'latePenaltyRate',
        'moveOutResponseDays',
      ])
    )
    expect(seed.clauses.every(clause => clause.protected)).toBe(true)
    expect(seed.clauses.every(clause => clause.contentHash.length === 64)).toBe(
      true
    )
    expect(seed.reviewReference).toContain('PROP-321')
    expect(seed.reviewReference).toContain('MOVE-OUT')
  })

  it('declares the move-out variable as allowed and referenced by Điều 9', () => {
    const seed = buildReviewedLeaseTemplateSeed('PRIVATE_CIVIL_APARTMENT_LEASE')
    const article9 = seed.clauses[8]!

    expect(seed.allowedVariables).toContain('moveOutResponseDays')
    expect(article9.variableRefs).toContain('moveOutResponseDays')
    expect(article9.content).toContain('{{moveOutResponseDays}}')
  })

  it('uses the shared 07 calendar-day refund wording and drops working days for the deposit', () => {
    const article5 = buildReviewedLeaseTemplateSeed(
      'PRIVATE_CIVIL_APARTMENT_LEASE'
    ).clauses[4]!
    expect(article5.content).toContain(DEPOSIT_REFUND_DUE_TEXT)
    expect(article5.content).not.toContain('ngày làm việc')
  })
})
