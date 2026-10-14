import {
  computeRentalExecutionPolicyHash,
  DEFAULT_RENTAL_EXECUTION_POLICY_INPUTS,
  getDefaultRentalExecutionPolicyRef,
  isRentalExecutionStrategy,
} from './rental-execution-policy.util'

describe('rental execution policy utilities', () => {
  it('accepts only the two allowlisted strategies', () => {
    expect(isRentalExecutionStrategy('DEPOSIT_FIRST')).toBe(true)
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

  it('provides a backward-compatible deposit-first reference', () => {
    expect(getDefaultRentalExecutionPolicyRef()).toEqual(
      expect.objectContaining({
        policyId: 'deposit-first',
        version: 1,
        strategy: 'DEPOSIT_FIRST',
      })
    )
  })
})
