import { BadRequestException, ConflictException } from '@nestjs/common'
import { createHmac } from 'node:crypto'
import { VnpayCallbackVerifier } from './vnpay-callback.verifier'

describe('VnpayCallbackVerifier', () => {
  const secret = 'a'.repeat(32)
  const verifier = new VnpayCallbackVerifier()

  function signedQuery(
    overrides: Record<string, string> = {}
  ): Record<string, string> {
    const query = {
      vnp_Amount: '150000000',
      vnp_ResponseCode: '00',
      vnp_TxnRef: 'VNPAY-001',
      ...overrides,
    }
    const payload = Object.entries(query)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(value).replace(/%20/g, '+')}`
      )
      .join('&')
    return {
      ...query,
      vnp_SecureHash: createHmac('sha512', secret)
        .update(payload)
        .digest('hex'),
    }
  }

  it('accepts a matching successful response', () => {
    expect(
      verifier.verify(signedQuery(), {
        secret,
        txRef: 'VNPAY-001',
        amount: 1_500_000,
      })
    ).toEqual({ txRef: 'VNPAY-001', amount: 1_500_000, succeeded: true })
  })

  it('rejects an invalid signature before returning settlement data', () => {
    expect(() =>
      verifier.verify(signedQuery({ vnp_SecureHash: 'invalid' }), {
        secret,
        txRef: 'VNPAY-001',
        amount: 1_500_000,
      })
    ).toThrow(BadRequestException)
  })

  it('rejects a response with a different amount', () => {
    expect(() =>
      verifier.verify(signedQuery({ vnp_Amount: '150000100' }), {
        secret,
        txRef: 'VNPAY-001',
        amount: 1_500_000,
      })
    ).toThrow(ConflictException)
  })
})
