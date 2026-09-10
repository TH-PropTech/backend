import { reminderDateKey, vietnamDateKey } from './payment-reminder.util'

describe('payment reminder calendar', () => {
  it('uses Vietnam calendar date instead of the server timezone', () => {
    expect(vietnamDateKey(new Date('2030-01-01T16:30:00.000Z'))).toBe(
      '2030-01-01'
    )
    expect(vietnamDateKey(new Date('2030-01-01T17:00:00.000Z'))).toBe(
      '2030-01-02'
    )
  })

  it('calculates seven calendar days before the due date', () => {
    expect(reminderDateKey(new Date('2030-03-01T00:00:00.000Z'))).toBe(
      '2030-02-22'
    )
    expect(reminderDateKey(new Date('2030-01-05T00:00:00.000Z'))).toBe(
      '2029-12-29'
    )
  })

  it('rejects invalid dates', () => {
    expect(() => vietnamDateKey(new Date('invalid'))).toThrow('INVALID_DATE')
  })
})
