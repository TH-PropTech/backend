import { generatePaymentSchedule } from './payment-schedule.util'
import { UnprocessableEntityException } from '@nestjs/common'

describe('payment schedule', () => {
  it('clamps a payment day beyond month end', () => {
    const schedule = generatePaymentSchedule({
      contractId: 'contract-1',
      startDate: new Date('2030-01-01T00:00:00.000Z'),
      durationMonths: 3,
      monthlyRent: 12_000_000,
      paymentDay: 31,
    })

    expect(
      schedule.map(item => item.dueDate.toISOString().slice(0, 10))
    ).toEqual(['2030-01-31', '2030-02-28', '2030-03-31'])
    expect(schedule.map(item => item.periodKey)).toEqual([
      '2030-01',
      '2030-02',
      '2030-03',
    ])
  })

  it('rejects invalid duration and payment day', () => {
    expect(() =>
      generatePaymentSchedule({
        contractId: 'contract-1',
        startDate: new Date('2030-01-01T00:00:00.000Z'),
        durationMonths: 0,
        monthlyRent: 12_000_000,
        paymentDay: 10,
      })
    ).toThrow(UnprocessableEntityException)
    expect(() =>
      generatePaymentSchedule({
        contractId: 'contract-1',
        startDate: new Date('2030-01-01T00:00:00.000Z'),
        durationMonths: 0,
        monthlyRent: 12_000_000,
        paymentDay: 10,
      })
    ).toThrow('INVALID_PAYMENT_SCHEDULE')
    expect(() =>
      generatePaymentSchedule({
        contractId: 'contract-1',
        startDate: new Date('2030-01-01T00:00:00.000Z'),
        durationMonths: 1,
        monthlyRent: 12_000_000,
        paymentDay: 32,
      })
    ).toThrow('INVALID_PAYMENT_SCHEDULE')
  })

  it('generates one invoice per three-month cycle with its covered period', () => {
    const schedule = generatePaymentSchedule({
      contractId: 'contract-1',
      startDate: new Date('2030-01-01T00:00:00.000Z'),
      durationMonths: 12,
      monthlyRent: 10_000_000,
      paymentDay: 10,
      cycleMonths: 3,
    })

    expect(schedule).toHaveLength(4)
    expect(schedule[0]).toMatchObject({
      periodKey: '2030-01',
      amount: 30_000_000,
      cycleMonths: 3,
      periodStart: new Date('2030-01-01T00:00:00.000Z'),
      periodEnd: new Date('2030-03-31T00:00:00.000Z'),
    })
  })

  it('preserves the monthly schedule shape when the payment cycle is one month', () => {
    expect(
      generatePaymentSchedule({
        contractId: 'contract-1',
        startDate: new Date('2030-01-01T00:00:00.000Z'),
        durationMonths: 1,
        monthlyRent: 12_000_000,
        paymentDay: 10,
        cycleMonths: 1,
      })
    ).toEqual([
      {
        contractId: 'contract-1',
        periodKey: '2030-01',
        amount: 12_000_000,
        dueDate: new Date('2030-01-10T00:00:00.000Z'),
        status: 'unpaid',
      },
    ])
  })
})

describe('payment schedule with prepaid rent', () => {
  const base = {
    contractId: 'contract-1',
    startDate: new Date('2030-01-01T00:00:00.000Z'),
    durationMonths: 12,
    monthlyRent: 10_000_000,
    paymentDay: 5,
  }
  const total = (items: Array<{ amount: number }>): number =>
    items.reduce((sum, item) => sum + item.amount, 0)

  it('keeps the legacy schedule when no prepayment policy is given', () => {
    const legacy = generatePaymentSchedule({ ...base, cycleMonths: 3 })
    expect(legacy).toHaveLength(4)
    expect(legacy.every(item => item.cycleMonths === 3)).toBe(true)
  })

  it('merges the prepaid months into the first invoice and bills the rest monthly', () => {
    const schedule = generatePaymentSchedule({ ...base, prepaidMonths: 2 })

    expect(schedule).toHaveLength(11)
    expect(schedule[0]).toMatchObject({
      periodKey: '2030-01',
      amount: 20_000_000,
      periodStart: new Date('2030-01-01T00:00:00.000Z'),
      periodEnd: new Date('2030-02-28T00:00:00.000Z'),
    })
    expect(schedule[0]?.cycleMonths).toBeUndefined()
    expect(schedule[1]).toMatchObject({
      periodKey: '2030-03',
      amount: 10_000_000,
    })
    expect(total(schedule)).toBe(120_000_000)
  })

  it('bills the whole duration at once when the rent is fully prepaid', () => {
    const schedule = generatePaymentSchedule({ ...base, prepaidMonths: 12 })

    expect(schedule).toHaveLength(1)
    expect(schedule[0]).toMatchObject({
      periodKey: '2030-01',
      amount: 120_000_000,
      periodEnd: new Date('2030-12-31T00:00:00.000Z'),
    })
  })

  it('splits the remainder by the chosen cycle when it divides evenly', () => {
    const schedule = generatePaymentSchedule({
      ...base,
      prepaidMonths: 3,
      cycleMonths: 3,
    })

    expect(schedule.map(item => item.periodKey)).toEqual([
      '2030-01',
      '2030-04',
      '2030-07',
      '2030-10',
    ])
    expect(schedule.every(item => item.cycleMonths === 3)).toBe(true)
    expect(total(schedule)).toBe(120_000_000)
  })

  it('falls back to monthly invoices when the remainder does not divide by the cycle', () => {
    const schedule = generatePaymentSchedule({
      ...base,
      prepaidMonths: 2,
      cycleMonths: 3,
    })

    expect(schedule).toHaveLength(11)
    expect(schedule.slice(1).every(item => item.amount === 10_000_000)).toBe(
      true
    )
    expect(total(schedule)).toBe(120_000_000)
  })

  it('always covers every month exactly once, whatever the prepayment', () => {
    for (let prepaid = 0; prepaid <= 12; prepaid++) {
      for (const cycleMonths of [1, 3, 6] as const) {
        const schedule = generatePaymentSchedule({
          ...base,
          prepaidMonths: prepaid,
          cycleMonths,
        })
        expect(total(schedule)).toBe(120_000_000)
      }
    }
  })

  it('with a deposit-only package the first rent is due on the first payment day after move-in', () => {
    const early = generatePaymentSchedule({
      ...base,
      startDate: new Date('2030-01-15T00:00:00.000Z'),
      paymentDay: 1,
      prepaidMonths: 0,
    })
    expect(early[0]?.dueDate.toISOString().slice(0, 10)).toBe('2030-02-01')
    expect(early[0]?.periodKey).toBe('2030-01')

    const sameMonth = generatePaymentSchedule({
      ...base,
      startDate: new Date('2030-01-01T00:00:00.000Z'),
      paymentDay: 5,
      prepaidMonths: 0,
    })
    expect(sameMonth[0]?.dueDate.toISOString().slice(0, 10)).toBe('2030-01-05')
  })

  it('rejects a prepayment longer than the contract', () => {
    expect(() =>
      generatePaymentSchedule({ ...base, prepaidMonths: 13 })
    ).toThrow('INVALID_PAYMENT_SCHEDULE')
    expect(() =>
      generatePaymentSchedule({ ...base, prepaidMonths: -1 })
    ).toThrow('INVALID_PAYMENT_SCHEDULE')
    expect(() =>
      generatePaymentSchedule({ ...base, prepaidMonths: 1.5 })
    ).toThrow('INVALID_PAYMENT_SCHEDULE')
  })
})
