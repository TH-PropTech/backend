import { createHmac } from 'node:crypto'
import { VnpayAdapter } from './vnpay.adapter'
import { TEST_PAYMENTS, testConfigService } from './gateway-test.util'

describe('VnpayAdapter', () => {
  const adapter = new VnpayAdapter(testConfigService() as never)

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-03T08:00:00.000Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('builds a locally signed VNPAY URL from the server-owned attempt', async () => {
    const intent = await adapter.createPaymentIntent({
      amount: 5_000_000,
      description: 'Deposit DP-001',
      customerRef: 'tenant-1',
      txRef: 'VNPAY-abc123',
      expiresAt: new Date('2026-10-03T08:15:00.000Z'),
      clientIp: '::ffff:10.0.0.7',
    })

    // Golden canonical query: ASCII-sorted keys, spaces as `+`, GMT+7 dates.
    const expectedQuery =
      'vnp_Amount=500000000&vnp_Command=pay&vnp_CreateDate=20261003150000' +
      '&vnp_CurrCode=VND&vnp_ExpireDate=20261003151500&vnp_IpAddr=10.0.0.7' +
      '&vnp_Locale=vn&vnp_OrderInfo=Deposit+DP-001&vnp_OrderType=other' +
      '&vnp_ReturnUrl=http%3A%2F%2Flocalhost%3A3001%2Fapi%2Fv1%2Fbank%2Fvnpay%2Freturn' +
      '&vnp_TmnCode=TESTTMN1&vnp_TxnRef=VNPAY-abc123&vnp_Version=2.1.0'
    const expectedHash = createHmac('sha512', TEST_PAYMENTS.vnpay.hashSecret)
      .update(expectedQuery)
      .digest('hex')

    expect(intent).toEqual({
      provider: 'vnpay',
      txRef: 'VNPAY-abc123',
      redirectUrl: `${TEST_PAYMENTS.vnpay.payUrl}?${expectedQuery}&vnp_SecureHash=${expectedHash}`,
      expiresAt: new Date('2026-10-03T08:15:00.000Z'),
    })
  })

  it('encodes Vietnamese order info consistently in the URL and the hash', async () => {
    const intent = await adapter.createPaymentIntent({
      amount: 1,
      description: 'Đặt cọc căn hộ A-12',
      customerRef: 'tenant-1',
      txRef: 'VNPAY-1',
      expiresAt: new Date('2026-10-03T08:15:00.000Z'),
    })
    const url = new URL(intent.redirectUrl)
    expect(url.searchParams.get('vnp_OrderInfo')).toBe('Đặt cọc căn hộ A-12')
    expect(url.searchParams.get('vnp_Amount')).toBe('100')
    expect(url.searchParams.get('vnp_IpAddr')).toBe('127.0.0.1')

    const query = intent.redirectUrl.split('?')[1] ?? ''
    const signed = query.slice(0, query.indexOf('&vnp_SecureHash='))
    expect(url.searchParams.get('vnp_SecureHash')).toBe(
      createHmac('sha512', TEST_PAYMENTS.vnpay.hashSecret)
        .update(signed)
        .digest('hex')
    )
  })

  it('issues unique server-generated references', () => {
    expect(adapter.newTxRef()).toMatch(/^VNPAY-[a-f0-9]{24}$/)
    expect(adapter.newTxRef()).not.toBe(adapter.newTxRef())
  })
})
