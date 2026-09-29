import { ServiceUnavailableException } from '@nestjs/common'
import { VnpayAdapter } from './vnpay.adapter'

describe('VnpayAdapter', () => {
  const configService = {
    getOrThrow: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    configService.getOrThrow.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        'rentalFlow.vnpayGatewayUrl':
          'http://localhost:8888/order/create_payment_for_transaction',
        'rentalFlow.vnpayReturnUrl':
          'http://localhost:3001/api/v1/bank/vnpay/return',
      }
      return values[key]
    })
  })

  it('creates a bridge request using the server-owned transaction reference', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        paymentUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?x=1',
      }),
    })
    const adapter = new VnpayAdapter(configService as never, fetcher)

    await expect(
      adapter.createPaymentIntent({
        amount: 1_500_000,
        description: 'Deposit DP-001',
        customerRef: 'tenant-1',
        txRef: 'VNPAY-001',
      })
    ).resolves.toMatchObject({
      provider: 'vnpay',
      txRef: 'VNPAY-001',
      redirectUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?x=1',
    })

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8888/order/create_payment_for_transaction',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          transactionId: 'VNPAY-001',
          amount: 1_500_000,
          returnUrl: 'http://localhost:3001/api/v1/bank/vnpay/return',
          language: 'vn',
        }),
      })
    )
  })

  it('fails closed when the bridge response has no payment URL', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({}),
    })
    const adapter = new VnpayAdapter(configService as never, fetcher)

    await expect(
      adapter.createPaymentIntent({
        amount: 1,
        description: 'Deposit',
        customerRef: 'tenant-1',
        txRef: 'VNPAY-001',
      })
    ).rejects.toThrow(ServiceUnavailableException)
  })
})
