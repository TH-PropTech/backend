export type PaymentScheduleInput = {
  contractId: string
  startDate: Date
  durationMonths: number
  monthlyRent: number
  paymentDay: number
}

export type PaymentScheduleItem = {
  contractId: string
  periodKey: string
  amount: number
  dueDate: Date
  status: 'unpaid'
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

export function generatePaymentSchedule(
  input: PaymentScheduleInput
): PaymentScheduleItem[] {
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
    Number.isNaN(input.startDate.getTime())
  ) {
    throw new Error('INVALID_PAYMENT_SCHEDULE')
  }

  const startYear = input.startDate.getUTCFullYear()
  const startMonth = input.startDate.getUTCMonth()
  return Array.from({ length: input.durationMonths }, (_, index) => {
    const targetMonth = startMonth + index
    const year = startYear + Math.floor(targetMonth / 12)
    const monthIndex = targetMonth % 12
    const month = String(monthIndex + 1).padStart(2, '0')
    const periodKey = `${year}-${month}`
    const day = Math.min(input.paymentDay, daysInMonth(year, monthIndex))

    return {
      contractId: input.contractId,
      periodKey,
      amount: input.monthlyRent,
      dueDate: new Date(Date.UTC(year, monthIndex, day)),
      status: 'unpaid',
    }
  })
}
