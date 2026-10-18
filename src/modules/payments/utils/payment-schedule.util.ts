import { UnprocessableEntityException } from '@nestjs/common'

export type PaymentScheduleInput = {
  contractId: string
  startDate: Date
  durationMonths: number
  monthlyRent: number
  paymentDay: number
  cycleMonths?: 1 | 3 | 6
  /**
   * Số tháng tiền thuê trả trước trong kỳ đầu (gói có chính sách trả trước).
   * - vắng mặt: lịch cũ, mọi kỳ cùng độ dài `cycleMonths`;
   * - 0 (chỉ cọc): lịch như cũ nhưng hạn của kỳ đầu là ngày thanh toán đầu tiên KỂ TỪ ngày bắt đầu thuê;
   * - 1..durationMonths: kỳ đầu gộp `prepaidMonths` tháng (trả khi nhận nhà), phần còn lại chia theo `cycleMonths`
   *   (nếu số tháng còn lại không chia hết cho chu kỳ thì thu từng tháng).
   */
  prepaidMonths?: number
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

function invalid(): never {
  throw new UnprocessableEntityException('INVALID_PAYMENT_SCHEDULE')
}

export function generatePaymentSchedule(
  input: PaymentScheduleInput
): PaymentScheduleItem[] {
  const cycleMonths = input.cycleMonths ?? 1
  const prepaid = input.prepaidMonths
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
    Number.isNaN(input.startDate.getTime())
  ) {
    invalid()
  }
  if (prepaid === undefined) {
    if (input.durationMonths % cycleMonths !== 0) invalid()
  } else if (
    !Number.isInteger(prepaid) ||
    prepaid < 0 ||
    prepaid > input.durationMonths
  ) {
    invalid()
  }

  const startYear = input.startDate.getUTCFullYear()
  const startMonth = input.startDate.getUTCMonth()

  /** Kỳ bắt đầu sau `offset` tháng kể từ ngày bắt đầu thuê và kéo dài `span` tháng. */
  const buildItem = (offset: number, span: number): PaymentScheduleItem => {
    const targetMonth = startMonth + offset
    const year = startYear + Math.floor(targetMonth / 12)
    const monthIndex = targetMonth % 12
    const periodKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`
    const day = Math.min(input.paymentDay, daysInMonth(year, monthIndex))

    const item: PaymentScheduleItem = {
      contractId: input.contractId,
      periodKey,
      amount: input.monthlyRent * span,
      dueDate: new Date(Date.UTC(year, monthIndex, day)),
      status: 'unpaid',
    }
    if (span > 1) {
      const endMonth = monthIndex + span - 1
      const endYear = year + Math.floor(endMonth / 12)
      const endMonthIndex = endMonth % 12
      // chu kỳ chuẩn (3/6 tháng) ghi `cycleMonths`; kỳ trả trước có số tháng tuỳ ý chỉ ghi khoảng thời gian
      if (span === 3 || span === 6) item.cycleMonths = span
      item.periodStart = new Date(Date.UTC(year, monthIndex, 1))
      item.periodEnd = new Date(Date.UTC(endYear, endMonthIndex + 1, 0))
    }
    return item
  }

  const items: PaymentScheduleItem[] = []
  const firstSpan = prepaid && prepaid > 0 ? prepaid : 0
  if (firstSpan > 0) items.push(buildItem(0, firstSpan))

  const remaining = input.durationMonths - firstSpan
  const span = remaining % cycleMonths === 0 ? cycleMonths : 1
  for (let offset = firstSpan; offset < input.durationMonths; offset += span) {
    items.push(buildItem(offset, span))
  }

  if (prepaid === 0) {
    // chỉ cọc: kỳ đầu không thu khi nhận nhà nên hạn là ngày thanh toán đầu tiên không trước ngày bắt đầu thuê
    const first = items[0]
    if (first) {
      const startDay = Date.UTC(
        startYear,
        startMonth,
        input.startDate.getUTCDate()
      )
      let due = first.dueDate
      let guard = 0
      while (due.getTime() < startDay && guard++ < 2) {
        const year = due.getUTCFullYear()
        const monthIndex = due.getUTCMonth() + 1
        const nextYear = year + Math.floor(monthIndex / 12)
        const nextMonth = monthIndex % 12
        due = new Date(
          Date.UTC(
            nextYear,
            nextMonth,
            Math.min(input.paymentDay, daysInMonth(nextYear, nextMonth))
          )
        )
      }
      first.dueDate = due
    }
  }
  return items
}
