import { validateDepositConsent } from './deposit-consent.util'

describe('deposit consent', () => {
  const agreement = {
    status: 'accepted' as const,
    contentRevision: 2,
    contentHash: 'a'.repeat(64),
  }

  it('accepts matching current tenant consent', () => {
    expect(
      validateDepositConsent(agreement, {
        expectedRevision: 2,
        expectedContentHash: 'a'.repeat(64),
      })
    ).toBe(true)
  })

  it('rejects stale hash, revision or non-accepted state', () => {
    expect(() =>
      validateDepositConsent(agreement, {
        expectedRevision: 1,
        expectedContentHash: 'a'.repeat(64),
      })
    ).toThrow('DEPOSIT_CONSENT_REQUIRED')
    expect(() =>
      validateDepositConsent(agreement, {
        expectedRevision: 2,
        expectedContentHash: 'b'.repeat(64),
      })
    ).toThrow('DEPOSIT_CONSENT_REQUIRED')
    expect(() =>
      validateDepositConsent(
        { ...agreement, status: 'draft' },
        { expectedRevision: 2, expectedContentHash: 'a'.repeat(64) }
      )
    ).toThrow('DEPOSIT_CONSENT_REQUIRED')
  })
})
