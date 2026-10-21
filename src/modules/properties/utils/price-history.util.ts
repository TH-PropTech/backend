export interface PriceHistoryPoint {
  price: number
  at: Date
}

interface PriceHistoryHolder {
  priceMonthly: number
  priceHistory?: PriceHistoryPoint[]
  createdAt?: Date
}

/**
 * Đổi giá thuê đại diện và ghi lịch sử. Căn hộ cũ chưa có lịch sử được gieo điểm
 * đầu bằng giá hiện tại tại `createdAt`, nên đường giá không mất đoạn trước lần đổi đầu tiên.
 */
export function recordPriceChange(
  apartment: PriceHistoryHolder,
  newPrice: number,
  now: Date = new Date()
): void {
  const history = [...(apartment.priceHistory ?? [])]
  if (history.length === 0 && apartment.createdAt) {
    history.push({ price: apartment.priceMonthly, at: apartment.createdAt })
  }
  const last = history[history.length - 1]
  if (!last || last.price !== newPrice) {
    history.push({ price: newPrice, at: now })
  }
  apartment.priceHistory = history
  apartment.priceMonthly = newPrice
}

/** Giá có hiệu lực tại thời điểm `moment`, hoặc null khi tin chưa tồn tại lúc đó. */
export function priceAt(
  history: readonly PriceHistoryPoint[],
  moment: Date
): number | null {
  let result: number | null = null
  for (const point of history) {
    if (new Date(point.at).getTime() <= moment.getTime()) result = point.price
    else break
  }
  return result
}
