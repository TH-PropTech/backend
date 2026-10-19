import {
  computeRentalExecutionPolicyHash,
  DEFAULT_RENTAL_EXECUTION_POLICY_INPUTS,
  getDefaultRentalExecutionPolicyRef,
  isRentalExecutionStrategy,
} from './rental-execution-policy.util'

describe('rental execution policy utilities', () => {
  it('accepts only the SIGN_FIRST strategy', () => {
    expect(isRentalExecutionStrategy('DEPOSIT_FIRST')).toBe(false)
    expect(isRentalExecutionStrategy('SIGN_FIRST')).toBe(true)
    expect(isRentalExecutionStrategy('CUSTOM_GRAPH')).toBe(false)
  })

  it('generates deterministic policy hashes', () => {
    const input = DEFAULT_RENTAL_EXECUTION_POLICY_INPUTS[0]
    const first = computeRentalExecutionPolicyHash({ ...input, version: 1 })
    const second = computeRentalExecutionPolicyHash({ ...input, version: 1 })
    expect(first).toBe(second)
    expect(first).toHaveLength(64)
  })

  it('provides a sign-first default reference', () => {
    expect(getDefaultRentalExecutionPolicyRef()).toEqual(
      expect.objectContaining({
        policyId: 'sign-first',
        version: 1,
        strategy: 'SIGN_FIRST',
      })
    )
  })
})
