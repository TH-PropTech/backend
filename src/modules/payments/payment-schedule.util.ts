export type PaymentScheduleInput = {
  contractId: string
  startDate: Date
  durationMonths: number
  monthlyRent: number
  paymentDay: number
  cycleMonths?: 1 | 3 | 6
}

export type PaymentScheduleItem = {
  contractId: string
  periodKey: string
  amount: number
  dueDate: Date
  status: 'unpaid'
  cycleMonths?: 1 | 3 | 6
  periodStart?: Date
  periodEnd?: Date
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

export function generatePaymentSchedule(
  input: PaymentScheduleInput
): PaymentScheduleItem[] {
  const cycleMonths = input.cycleMonths ?? 1
  if (
    input.contractId.trim() === '' ||
    !Number.isInteger(input.durationMonths) ||
    input.durationMonths < 1 ||
    input.durationMonths > 60 ||
    !Number.isInteger(input.paymentDay) ||
    input.paymentDay < 1 ||
    input.paymentDay > 31 ||
    !Number.isInteger(input.monthlyRent) ||
    input.monthlyRent <= 0 ||
    ![1, 3, 6].includes(cycleMonths) ||
    input.durationMonths % cycleMonths !== 0 ||
    Number.isNaN(input.startDate.getTime())
  ) {
    throw new UnprocessableEntityException('INVALID_PAYMENT_SCHEDULE')
  }

  const startYear = input.startDate.getUTCFullYear()
  const startMonth = input.startDate.getUTCMonth()
  return Array.from(
    { length: input.durationMonths / cycleMonths },
    (_, index) => {
      const targetMonth = startMonth + index * cycleMonths
      const year = startYear + Math.floor(targetMonth / 12)
      const monthIndex = targetMonth % 12
      const month = String(monthIndex + 1).padStart(2, '0')
      const periodKey = `${year}-${month}`
      const day = Math.min(input.paymentDay, daysInMonth(year, monthIndex))

      const item: PaymentScheduleItem = {
        contractId: input.contractId,
        periodKey,
        amount: input.monthlyRent * cycleMonths,
        dueDate: new Date(Date.UTC(year, monthIndex, day)),
        status: 'unpaid',
      }
      if (cycleMonths > 1) {
        const endMonth = monthIndex + cycleMonths - 1
        const endYear = year + Math.floor(endMonth / 12)
        const endMonthIndex = endMonth % 12
        item.cycleMonths = cycleMonths
        item.periodStart = new Date(Date.UTC(year, monthIndex, 1))
        item.periodEnd = new Date(Date.UTC(endYear, endMonthIndex + 1, 0))
      }
      return item
    }
  )
}
import { UnprocessableEntityException } from '@nestjs/common'
