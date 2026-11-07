import { vietnamDateKey } from './payment-reminder.util'

const DAYS_PER_YEAR_PERCENT = 36500
const MS_PER_DAY = 86_400_000

/**
 * Lãi chậm trả (đồng) = round(gốc × tỷ lệ %/năm × số ngày / 36500).
 * Chaincode `computeLatePenaltyAmount` dùng đúng biểu thức và thứ tự phép tính này; đổi
 * một trong hai phía sẽ làm lệch ở các ca làm tròn nửa đồng.
 */
export function computeLatePenalty(
  baseAmount: number,
  ratePerYear: number,
  daysLate: number
): number {
  return Math.round(
    (baseAmount * ratePerYear * daysLate) / DAYS_PER_YEAR_PERCENT
  )
}

function dateKeyToUtcMs(key: string): number {
  const [year, month, day] = key.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  return Date.UTC(year, month - 1, day)
}

/**
 * Số ngày lịch (Asia/Ho_Chi_Minh) từ hạn trả đến ngày trả. Trả đúng ngày đến hạn là 0;
 * trả sớm hơn hạn cho số âm, nên người gọi chỉ sinh lãi khi kết quả lớn hơn 0.
 */
export function daysLateBetween(dueDate: Date, paidAt: Date): number {
  return Math.round(
    (dateKeyToUtcMs(vietnamDateKey(paidAt)) -
      dateKeyToUtcMs(vietnamDateKey(dueDate))) /
      MS_PER_DAY
  )
}
