import {
  consumeSigningGrant,
  createSigningGrant,
  type SigningGrantInput,
} from './signing-grant.util'

const input: SigningGrantInput = {
  userId: 'tenant-1',
  role: 'tenant',
  contractId: 'contract-1',
  contentLockedHash: 'a'.repeat(64),
  biometricGrantId: 'bio-1',
  otpSessionId: 'otp-1',
}

describe('signing grant', () => {
  it('creates and consumes a grant only for its bound identity and hash', () => {
    const now = new Date('2030-01-01T00:00:00.000Z')
    const created = createSigningGrant(input, now, 60_000)

    expect(created.grantId).toMatch(/^sg_/)
    expect(() =>
      consumeSigningGrant(
        created.record,
        created.grantId,
        input,
        new Date('2030-01-01T00:00:30.000Z')
      )
    ).not.toThrow()
  })

  it('rejects expiry, replay and mismatched content', () => {
    const now = new Date('2030-01-01T00:00:00.000Z')
    const created = createSigningGrant(input, now, 60_000)
    expect(() =>
      consumeSigningGrant(
        created.record,
        created.grantId,
        { ...input, contentLockedHash: 'b'.repeat(64) },
        now
      )
    ).toThrow('SIGNING_GRANT_INVALID')
    expect(() =>
      consumeSigningGrant(
        created.record,
        created.grantId,
        input,
        new Date('2030-01-01T00:01:01.000Z')
      )
    ).toThrow('SIGNING_GRANT_INVALID')
    const consumed = consumeSigningGrant(
      created.record,
      created.grantId,
      input,
      now
    )
    expect(() =>
      consumeSigningGrant(consumed, created.grantId, input, now)
    ).toThrow('SIGNING_GRANT_INVALID')
  })
})
