import { isAllowed } from './permission-policy'

describe('isAllowed (staff policy)', () => {
  it('allows when nothing matches (behaviour before the matrix existed)', () => {
    expect(isAllowed([], 'update', 'Apartment')).toBe(true)
    expect(
      isAllowed(
        [{ action: 'read', subject: 'Kyc', allowed: false }],
        'approve',
        'Kyc'
      )
    ).toBe(true)
  })

  it('blocks only what the admin switched off', () => {
    const entries = [{ action: 'approve', subject: 'Kyc', allowed: false }]
    expect(isAllowed(entries, 'approve', 'Kyc')).toBe(false)
    expect(isAllowed(entries, 'read', 'Kyc')).toBe(true)
    expect(isAllowed(entries, 'approve', 'Apartment')).toBe(true)
  })

  it('an exact entry beats manage on the subject', () => {
    const entries = [
      { action: 'manage', subject: 'SupportTicket', allowed: true },
      { action: 'update', subject: 'SupportTicket', allowed: false },
    ]
    expect(isAllowed(entries, 'update', 'SupportTicket')).toBe(false)
    expect(isAllowed(entries, 'read', 'SupportTicket')).toBe(true)
  })

  it('falls back to manage on the subject, then the action on all, then manage on all', () => {
    expect(
      isAllowed(
        [{ action: 'manage', subject: 'Kyc', allowed: false }],
        'read',
        'Kyc'
      )
    ).toBe(false)
    expect(
      isAllowed(
        [{ action: 'delete', subject: 'all', allowed: false }],
        'delete',
        'CommunityPost'
      )
    ).toBe(false)
    expect(
      isAllowed(
        [{ action: 'manage', subject: 'all', allowed: false }],
        'read',
        'Contract'
      )
    ).toBe(false)
  })

  it('a more specific allow overrides a broader deny', () => {
    const entries = [
      { action: 'manage', subject: 'all', allowed: false },
      { action: 'read', subject: 'Kyc', allowed: true },
    ]
    expect(isAllowed(entries, 'read', 'Kyc')).toBe(true)
    expect(isAllowed(entries, 'approve', 'Kyc')).toBe(false)
  })
})
