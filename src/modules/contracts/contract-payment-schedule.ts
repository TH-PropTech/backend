export type RentScheduleRow = {
  period: number
  /** Ngày bắt đầu và kết thúc của kỳ thuê. */
  from: Date
  to: Date
  /** Hạn thanh toán của kỳ. */
  dueDate: Date
  amount: number
}

const MAX_PERIODS = 120

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

/** Cộng `months` tháng theo lịch, giữ nguyên ngày (kẹp về ngày cuối tháng nếu tháng đích ngắn hơn). */
export function addMonthsClamped(date: Date, months: number): Date {
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months
  const year = Math.floor(total / 12)
  const month = total % 12
  const day = Math.min(date.getUTCDate(), daysInMonth(year, month))
  return new Date(Date.UTC(year, month, day))
}

/**
 * Lịch thanh toán tiền thuê hằng tháng: mỗi kỳ là một tháng liên tiếp tính từ ngày bắt đầu; hạn thanh toán
 * là ngày `paymentDay` của tháng dương lịch chứa ngày bắt đầu kỳ đó (đúng điều khoản "chậm nhất vào ngày N hằng tháng"),
 * riêng kỳ đầu không sớm hơn ngày bắt đầu thuê.
 */
export function buildRentSchedule(input: {
  startDate: Date | string
  durationMonths: number
  paymentDay: number
  monthlyRent: number
}): RentScheduleRow[] {
  const start = new Date(input.startDate)
  if (
    Number.isNaN(start.getTime()) ||
    !Number.isFinite(input.durationMonths) ||
    input.durationMonths < 1
  ) {
    return []
  }
  const periods = Math.min(Math.floor(input.durationMonths), MAX_PERIODS)
  const paymentDay = Math.min(
    Math.max(Math.floor(input.paymentDay) || 1, 1),
    28
  )
  const rows: RentScheduleRow[] = []
  for (let index = 0; index < periods; index += 1) {
    const from = addMonthsClamped(start, index)
    const nextStart = addMonthsClamped(start, index + 1)
    const to = new Date(nextStart.getTime() - 24 * 60 * 60 * 1000)
    const dueInMonth = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), paymentDay)
    )
    const dueDate = dueInMonth < start ? start : dueInMonth
    rows.push({
      period: index + 1,
      from,
      to,
      dueDate,
      amount: input.monthlyRent,
    })
  }
  return rows
}
