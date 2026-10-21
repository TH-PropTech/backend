import { describe, expect, it } from 'vitest'
import { priceAt, recordPriceChange } from './price-history.util'

describe('price history', () => {
  it('seeds a legacy apartment with its old price at createdAt before the change', () => {
    const apartment = {
      priceMonthly: 12_000_000,
      createdAt: new Date('2026-01-10T00:00:00Z'),
    }
    recordPriceChange(apartment, 13_000_000, new Date('2026-05-01T00:00:00Z'))
    expect(apartment.priceMonthly).toBe(13_000_000)
    expect(
      (apartment as { priceHistory?: unknown[] }).priceHistory
    ).toHaveLength(2)
  })

  it('does not append when the price is unchanged', () => {
    const apartment = {
      priceMonthly: 12_000_000,
      priceHistory: [{ price: 12_000_000, at: new Date('2026-01-10') }],
    }
    recordPriceChange(apartment, 12_000_000)
    expect(apartment.priceHistory).toHaveLength(1)
  })

  it('returns the price effective at a moment, null before the listing existed', () => {
    const history = [
      { price: 12_000_000, at: new Date('2026-02-01') },
      { price: 13_000_000, at: new Date('2026-05-01') },
    ]
    expect(priceAt(history, new Date('2026-01-31'))).toBeNull()
    expect(priceAt(history, new Date('2026-03-31'))).toBe(12_000_000)
    expect(priceAt(history, new Date('2026-06-30'))).toBe(13_000_000)
  })
})
