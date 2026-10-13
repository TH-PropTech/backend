import { buildPaymentRequest } from './payment-request.builder'

describe('buildPaymentRequest', () => {
  const payment = {
    provider: 'mock-bank' as const,
    txRef: 'MOCK-1',
    amount: 2_000_000,
    description: 'Deposit DPA-1',
    qrCode: 'data:text/plain,mock',
    deepLink: 'mockbank://pay?txRef=MOCK-1',
    expiresAt: new Date('2026-10-01T00:00:00.000Z'),
    status: 'pending' as const,
  }

  it('keeps legacy payment fields and builds a complete simulated request', () => {
    const result = buildPaymentRequest({
      payment,
      invoiceCode: 'DPA-000001',
      purpose: 'DEPOSIT',
      lines: [
        {
          kind: 'deposit',
          description: 'Tiền đặt cọc',
          amountBeforeVat: 2_000_000,
          vatAmount: 0,
          amount: 2_000_000,
          paymentId: 'deposit-1',
        },
      ],
      payer: { role: 'tenant', name: 'Nguyễn Văn An' },
      payee: {
        role: 'landlord',
        displayName: 'Trần Minh Bình',
        accountRef: '9704361234567890',
      },
      dueAt: null,
      simulation: true,
    })

    expect(result).toEqual(
      expect.objectContaining({
        txRef: payment.txRef,
        deepLink: payment.deepLink,
        invoiceCode: 'DPA-000001',
        purpose: 'DEPOSIT',
        total: 2_000_000,
        currency: 'VND',
        transferContent: 'TH DPA 000001',
        dueAt: null,
        simulation: true,
        qrFormat: 'simulated',
      })
    )
    expect(result.payer.maskedName).toBe('N*** V*** A***')
    expect(result.payee.maskedAccountRef).toBe('************7890')
    expect(result.payee.displayName).toBe('T*** M*** B***')
  })

  it('removes Vietnamese accents from transfer content', () => {
    const result = buildPaymentRequest({
      payment,
      invoiceCode: 'đặt-cọc số 12',
      purpose: 'DEPOSIT',
      lines: [],
      payer: { role: 'tenant', name: null },
      payee: { role: 'platform', displayName: 'Thạch Homes' },
      simulation: true,
    })

    expect(result.transferContent).toBe('TH DAT COC SO 12')
    expect(result.transferContent).toMatch(/^[A-Z0-9 ]{1,25}$/)
  })

  it('truncates overly long transfer content to the bank limit', () => {
    const result = buildPaymentRequest({
      payment,
      invoiceCode: 'DPA-THIS-INVOICE-CODE-IS-FAR-TOO-LONG-000001',
      purpose: 'DEPOSIT',
      lines: [],
      payer: { role: 'tenant', name: '' },
      payee: { role: 'platform', displayName: '' },
      simulation: true,
    })

    expect(result.transferContent.length).toBeLessThanOrEqual(25)
    expect(result.transferContent.length).toBeGreaterThan(0)
    expect(result.transferContent).toMatch(/^[A-Z0-9 ]{1,25}$/)
    expect(result.payer.maskedName).toBe('***')
    expect(result.payee.maskedAccountRef).toBeNull()
  })
})
