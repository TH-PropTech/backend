import { computeLatePenalty, daysLateBetween } from './late-penalty'

/** Cùng bảng với blockchain/chaincode/test/proptech-contract.test.js (PENALTY_FORMULA_CASES). */
const FORMULA_CASES: ReadonlyArray<[number, number, number, number]> = [
  [5_000_000, 10, 20, 27_397],
  [6_000_000, 12, 5, 9_863],
  [4_000_000, 10, 9, 9_863],
  [1_000_000, 20, 1, 548],
  [12_345_678, 7, 3, 7_103],
]

describe('computeLatePenalty', () => {
  it.each(FORMULA_CASES)(
    'base %i at %i%%/year for %i days = %i VND',
    (base, rate, days, expected) => {
      expect(computeLatePenalty(base, rate, days)).toBe(expected)
    }
  )

  it('returns 0 when the rounded amount is below half a dong', () => {
    expect(computeLatePenalty(100, 10, 1)).toBe(0)
  })
})

describe('daysLateBetween (Asia/Ho_Chi_Minh calendar)', () => {
  it('counts calendar days between the due date and the payment date', () => {
    expect(
      daysLateBetween(
        new Date('2026-11-05T00:00:00+07:00'),
        new Date('2026-11-25T10:00:00+07:00')
      )
    ).toBe(20)
  })

  it('returns 0 when paid on the due date itself, even late at night', () => {
    expect(
      daysLateBetween(
        new Date('2026-11-05T00:00:00+07:00'),
        new Date('2026-11-05T23:59:00+07:00')
      )
    ).toBe(0)
  })

  it('uses the Vietnam date across the UTC midnight boundary', () => {
    // 2026-11-05T17:30Z is already 2026-11-06 00:30 in Vietnam.
    expect(
      daysLateBetween(
        new Date('2026-11-05T00:00:00+07:00'),
        new Date('2026-11-05T17:30:00.000Z')
      )
    ).toBe(1)
    // 2026-11-05T16:59Z is still 2026-11-05 23:59 in Vietnam.
    expect(
      daysLateBetween(
        new Date('2026-11-05T00:00:00+07:00'),
        new Date('2026-11-05T16:59:00.000Z')
      )
    ).toBe(0)
  })

  it('returns a negative number when paid before the due date', () => {
    expect(
      daysLateBetween(
        new Date('2026-11-05T00:00:00+07:00'),
        new Date('2026-11-03T09:00:00+07:00')
      )
    ).toBe(-2)
  })
})
