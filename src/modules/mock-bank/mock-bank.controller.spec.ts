import { MockBankController } from './mock-bank.controller'

describe('MockBankController', () => {
  it('maps bank headers to the service callback contract', async () => {
    const service = {
      handleRentCallback: jest.fn().mockResolvedValue({ status: 'succeeded' }),
    }
    const controller = new MockBankController(service as never)

    await controller.callbackRent(
      { txRef: 'tx-1', amount: 100, status: 'success' },
      {
        'x-bank-timestamp': '1000',
        'x-bank-nonce': 'nonce',
        'x-bank-signature': 'signature',
      }
    )

    expect(service.handleRentCallback).toHaveBeenCalledWith(
      { txRef: 'tx-1', amount: 100, status: 'success' },
      { timestamp: '1000', nonce: 'nonce', signature: 'signature' }
    )
  })

  it('maps settlement init and callback to the settlement service flow', async () => {
    const service = {
      initSettlementPayment: jest
        .fn()
        .mockResolvedValue({ purpose: 'SETTLEMENT' }),
      handleSettlementCallback: jest
        .fn()
        .mockResolvedValue({ status: 'succeeded' }),
    }
    const controller = new MockBankController(service as never)

    await controller.initSettlement(
      { settlementId: '507f1f77bcf86cd799439011' },
      'tenant-1'
    )
    await controller.callbackSettlement(
      { txRef: 'tx-1', amount: 100, status: 'success' },
      {
        'x-bank-timestamp': '1000',
        'x-bank-nonce': 'nonce',
        'x-bank-signature': 'signature',
      }
    )

    expect(service.initSettlementPayment).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      'tenant-1'
    )
    expect(service.handleSettlementCallback).toHaveBeenCalledWith(
      { txRef: 'tx-1', amount: 100, status: 'success' },
      { timestamp: '1000', nonce: 'nonce', signature: 'signature' }
    )
  })

  it('maps invoice init and callback to the invoice service flow', async () => {
    const service = {
      initInvoicePayment: jest
        .fn()
        .mockResolvedValue({ purpose: 'PLATFORM_FEE' }),
      handleInvoiceCallback: jest
        .fn()
        .mockResolvedValue({ status: 'succeeded' }),
    }
    const controller = new MockBankController(service as never)

    await controller.initInvoice(
      { paymentId: '507f1f77bcf86cd799439011' },
      'landlord-1'
    )
    await controller.callbackInvoice(
      { txRef: 'tx-invoice', amount: 100, status: 'success' },
      {
        'x-bank-timestamp': '1000',
        'x-bank-nonce': 'nonce',
        'x-bank-signature': 'signature',
      }
    )

    expect(service.initInvoicePayment).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      'landlord-1'
    )
    expect(service.handleInvoiceCallback).toHaveBeenCalledWith(
      { txRef: 'tx-invoice', amount: 100, status: 'success' },
      { timestamp: '1000', nonce: 'nonce', signature: 'signature' }
    )
  })

  it('rejects wallet access when the JWT has no user id', () => {
    const controller = new MockBankController({} as never)
    expect(() => controller.wallet({})).toThrow('USER_ID_REQUIRED')
  })

  it('redirects a verified VNPay return to the canonical workspace result', async () => {
    const service = {
      handleVnpayDepositReturn: jest.fn().mockResolvedValue({
        status: 'succeeded',
        redirectUrl: 'http://localhost:3000/contracts/contract-1?payment=vnpay',
      }),
    }
    const response = { redirect: jest.fn() }
    const controller = new MockBankController(service as never)

    await controller.vnpayReturn({ vnp_TxnRef: 'VNPAY-1' }, response as never)

    expect(service.handleVnpayDepositReturn).toHaveBeenCalledWith({
      vnp_TxnRef: 'VNPAY-1',
    })
    expect(response.redirect).toHaveBeenCalledWith(
      302,
      'http://localhost:3000/contracts/contract-1?payment=vnpay'
    )
  })
})
