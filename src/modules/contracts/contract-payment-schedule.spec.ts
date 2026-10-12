import {
  addMonthsClamped,
  buildRentSchedule,
} from './contract-payment-schedule'

const iso = (date: Date): string => date.toISOString().slice(0, 10)

describe('buildRentSchedule', () => {
  it('builds one row per month with consecutive periods and the monthly amount', () => {
    const rows = buildRentSchedule({
      startDate: '2026-10-11',
      durationMonths: 12,
      paymentDay: 5,
      monthlyRent: 12_500_000,
    })

    expect(rows).toHaveLength(12)
    expect(rows[0]).toMatchObject({ period: 1, amount: 12_500_000 })
    expect(iso(rows[0]!.from)).toBe('2026-10-11')
    expect(iso(rows[0]!.to)).toBe('2026-11-10')
    expect(iso(rows[1]!.from)).toBe('2026-11-11')
    expect(iso(rows[11]!.to)).toBe('2027-10-10')
  })

  it('never puts the first due date before the lease start', () => {
    const [first, second] = buildRentSchedule({
      startDate: '2026-10-11',
      durationMonths: 3,
      paymentDay: 5,
      monthlyRent: 1,
    })

    expect(iso(first!.dueDate)).toBe('2026-10-11')
    expect(iso(second!.dueDate)).toBe('2026-11-05')
  })

  it('clamps month ends instead of overflowing into the next month', () => {
    expect(iso(addMonthsClamped(new Date('2026-01-31'), 1))).toBe('2026-02-28')
    const rows = buildRentSchedule({
      startDate: '2026-01-31',
      durationMonths: 3,
      paymentDay: 31,
      monthlyRent: 1,
    })
    expect(rows.map(row => iso(row.from))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ])
    expect(rows.slice(1).every(row => row.dueDate.getUTCDate() <= 28)).toBe(
      true
    )
  })

  it('returns an empty schedule for invalid input', () => {
    expect(
      buildRentSchedule({
        startDate: 'oops',
        durationMonths: 12,
        paymentDay: 5,
        monthlyRent: 1,
      })
    ).toEqual([])
    expect(
      buildRentSchedule({
        startDate: '2026-10-11',
        durationMonths: 0,
        paymentDay: 5,
        monthlyRent: 1,
      })
    ).toEqual([])
  })
})
