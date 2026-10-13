import type { FeeQuoteLine } from './platform-fee.types'

export function filterFeeQuoteForRole(
  quote: FeeQuoteLine[],
  role: 'tenant' | 'landlord' | 'staff' | 'admin'
): FeeQuoteLine[] {
  if (role === 'staff' || role === 'admin') return quote
  return quote.filter(line => line.payerRole === role)
}
