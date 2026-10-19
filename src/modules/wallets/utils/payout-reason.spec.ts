import { humanizePayoutReason } from './payout-reason'

describe('humanizePayoutReason', () => {
  it('explains awaiting-wallet', () => {
    expect(humanizePayoutReason('awaiting-wallet', null)).toBe(
      'Bạn chưa liên kết ví nhận tiền.'
    )
  })

  it.each(['NOT_CONFIGURED', 'GATEWAY_UNAVAILABLE', 'TRANSFER_FAILED'])(
    'maps known failure code %s to a Vietnamese sentence',
    code => {
      const text = humanizePayoutReason('failed', code)
      expect(text).not.toContain(code)
      expect(text.length).toBeGreaterThan(10)
    }
  )

  it('falls back to a generic sentence for unknown or missing codes', () => {
    const generic = humanizePayoutReason('failed', null)
    expect(humanizePayoutReason('failed', 'WEIRD_CODE')).toBe(generic)
    expect(generic).toContain('không thành công')
  })

  it('describes pending and paid-out', () => {
    expect(humanizePayoutReason('pending', null)).toContain('chờ')
    expect(humanizePayoutReason('paid-out', null)).toContain('thành công')
  })
})
