import { createHmac } from 'node:crypto'
import {
  VnpayCallbackVerifier,
  vnpayCanonicalQuery,
} from './vnpay-callback.verifier'
import { GatewayVerificationError } from './payment-provider.port'
import { TEST_PAYMENTS, testConfigService } from './gateway-test.util'

describe('VnpayCallbackVerifier', () => {
  const verifier = new VnpayCallbackVerifier(testConfigService() as never)
  const expected = { txRef: 'VNPAY-001', amount: 1_500_000 }

  function signedQuery(
    overrides: Record<string, string> = {}
  ): Record<string, string> {
    const query = {
      vnp_Amount: '150000000',
      vnp_OrderInfo: 'Deposit DP 001',
      vnp_ResponseCode: '00',
      vnp_TmnCode: TEST_PAYMENTS.vnpay.tmnCode,
      vnp_TransactionNo: '14012345',
      vnp_TransactionStatus: '00',
      vnp_TxnRef: 'VNPAY-001',
      ...overrides,
    }
    return {
      ...query,
      vnp_SecureHash: createHmac('sha512', TEST_PAYMENTS.vnpay.hashSecret)
        .update(vnpayCanonicalQuery(query))
        .digest('hex'),
    }
  }

  function reasonOf(run: () => unknown): string | null {
    try {
      run()
      return null
    } catch (error) {
      return error instanceof GatewayVerificationError ? error.reason : 'other'
    }
  }

  it('accepts a matching successful response and returns the VNPAY transaction no', () => {
    expect(verifier.verify(signedQuery(), 'notify', expected)).toEqual({
      txRef: 'VNPAY-001',
      amount: 1_500_000,
      succeeded: true,
      providerTransactionId: '14012345',
    })
  })

  it('reports a signed non-success response as unsucceeded', () => {
    expect(
      verifier.verify(
        signedQuery({ vnp_ResponseCode: '24', vnp_TransactionStatus: '02' }),
        'return',
        expected
      ).succeeded
    ).toBe(false)
  })

  it.each([
    [
      'invalid-signature',
      (): Record<string, string> => ({ ...signedQuery(), vnp_Amount: '1' }),
    ],
    [
      'merchant-mismatch',
      (): Record<string, string> => signedQuery({ vnp_TmnCode: 'OTHERTMN' }),
    ],
    [
      'unknown-reference',
      (): Record<string, string> => signedQuery({ vnp_TxnRef: 'VNPAY-999' }),
    ],
    [
      'amount-mismatch',
      (): Record<string, string> => signedQuery({ vnp_Amount: '150000100' }),
    ],
    [
      'invalid-payload',
      (): Record<string, string> => ({ vnp_TxnRef: 'VNPAY-001' }),
    ],
  ])('rejects %s before returning settlement data', (reason, build) => {
    expect(reasonOf(() => verifier.verify(build(), 'notify', expected))).toBe(
      reason
    )
  })

  it('extracts the reference only for lookup', () => {
    expect(verifier.extractTxRef({ vnp_TxnRef: 'VNPAY-7' })).toBe('VNPAY-7')
    expect(verifier.extractTxRef({ vnp_TxnRef: ['a', 'b'] })).toBeNull()
  })
})
