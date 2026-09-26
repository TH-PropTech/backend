import { buildReviewedLeaseTemplateSeed } from './lease-template.seed'

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
      expect.arrayContaining(['monthlyRent', 'latePenaltyRate'])
    )
    expect(seed.clauses.every(clause => clause.protected)).toBe(true)
    expect(seed.clauses.every(clause => clause.contentHash.length === 64)).toBe(
      true
    )
    expect(seed.reviewReference).toContain('PROP-321')
  })
})
