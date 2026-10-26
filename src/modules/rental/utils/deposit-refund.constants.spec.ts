import {
  DEFAULT_MOVE_OUT_RESPONSE_DAYS,
  DEPOSIT_REFUND_DUE_DAYS,
  DEPOSIT_REFUND_DUE_TEXT,
  MAX_MOVE_OUT_RESPONSE_DAYS,
  MIN_MOVE_OUT_RESPONSE_DAYS,
} from './deposit-refund.constants'

describe('deposit refund constants', () => {
  it('uses 7 calendar days and prints the same number in contract text', () => {
    expect(DEPOSIT_REFUND_DUE_DAYS).toBe(7)
    expect(DEPOSIT_REFUND_DUE_TEXT).toBe('07 (bảy) ngày')
    expect(DEPOSIT_REFUND_DUE_TEXT).not.toContain('làm việc')
  })

  it('keeps the default response days inside the allowed range', () => {
    expect(DEFAULT_MOVE_OUT_RESPONSE_DAYS).toBe(3)
    expect(DEFAULT_MOVE_OUT_RESPONSE_DAYS).toBeGreaterThanOrEqual(
      MIN_MOVE_OUT_RESPONSE_DAYS
    )
    expect(DEFAULT_MOVE_OUT_RESPONSE_DAYS).toBeLessThanOrEqual(
      MAX_MOVE_OUT_RESPONSE_DAYS
    )
  })
})
