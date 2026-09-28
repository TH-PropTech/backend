import { filterFeeQuoteForRole } from './fee-visibility.policy'

describe('filterFeeQuoteForRole', () => {
  const quote = [
    {
      feeKind: 'LANDLORD_COMMISSION' as const,
      payerRole: 'landlord' as const,
      amountBeforeVat: 1000,
      vatAmount: 100,
      amount: 1100,
    },
    {
      feeKind: 'TENANT_SERVICE' as const,
      payerRole: 'tenant' as const,
      amountBeforeVat: 2000,
      vatAmount: 200,
      amount: 2200,
    },
  ]
  it('shows only the viewer payer line and gives staff full visibility', () => {
    expect(filterFeeQuoteForRole(quote, 'tenant')).toEqual([quote[1]])
    expect(filterFeeQuoteForRole(quote, 'landlord')).toEqual([quote[0]])
    expect(filterFeeQuoteForRole(quote, 'staff')).toEqual(quote)
  })
})
