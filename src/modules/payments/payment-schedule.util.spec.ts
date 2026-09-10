import { generatePaymentSchedule } from './payment-schedule.util'

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
})
