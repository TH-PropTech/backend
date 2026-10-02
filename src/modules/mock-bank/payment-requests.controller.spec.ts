import { PaymentRequestsController } from './payment-requests.controller'

describe('PaymentRequestsController', () => {
  it('returns a deposit request for the authenticated tenant', async () => {
    const service = {
      getDepositPaymentRequest: jest
        .fn()
        .mockResolvedValue({ deepLink: 'mockbank://pay' }),
    }
    const controller = new PaymentRequestsController(service as never)

    const result = await controller.getDepositRequest('deposit-1', {
      _id: 'tenant-1',
      roles: ['tenant'],
    })

    expect(result).toEqual({ deepLink: 'mockbank://pay' })
    expect(service.getDepositPaymentRequest).toHaveBeenCalledWith(
      'deposit-1',
      'tenant-1',
      false
    )
  })

  it('passes staff access to payment request lookup', async () => {
    const service = {
      getPaymentRequest: jest.fn().mockResolvedValue(null),
    }
    const controller = new PaymentRequestsController(service as never)

    await controller.getPaymentRequest('payment-1', {
      _id: 'staff-1',
      roles: ['staff'],
    })

    expect(service.getPaymentRequest).toHaveBeenCalledWith(
      'payment-1',
      'staff-1',
      true
    )
  })

  it('maps payment and deposit receipt lookups with participant access', async () => {
    const service = {
      getPaymentReceipt: jest.fn().mockResolvedValue({ receiptCode: 'RCP-1' }),
      getDepositReceipt: jest.fn().mockResolvedValue({ receiptCode: 'RCP-2' }),
    }
    const controller = new PaymentRequestsController(service as never)

    await controller.getPaymentReceipt('payment-1', {
      _id: 'tenant-1',
      roles: ['tenant'],
    })
    await controller.getDepositReceipt('deposit-1', {
      _id: 'admin-1',
      roles: ['admin'],
    })

    expect(service.getPaymentReceipt).toHaveBeenCalledWith(
      'payment-1',
      'tenant-1',
      false
    )
    expect(service.getDepositReceipt).toHaveBeenCalledWith(
      'deposit-1',
      'admin-1',
      true
    )
  })
})
