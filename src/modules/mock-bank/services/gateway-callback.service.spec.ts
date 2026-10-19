import { ObjectId } from 'mongodb'
import { createHmac } from 'node:crypto'
import { GatewayCallbackService } from './gateway-callback.service'
import { GatewayVerificationError } from '../providers/payment-provider.port'
import { MocbankCallbackVerifier } from '../providers/mocbank-callback.verifier'
import {
  TEST_PAYMENTS,
  testConfigService,
} from '../providers/gateway-test.util'

describe('GatewayCallbackService', () => {
  function createContext(attemptOverrides: Record<string, unknown> = {}): {
    service: GatewayCallbackService
    verifier: { extractTxRef: jest.Mock; verify: jest.Mock }
    mockBankService: { settleVerifiedAttempt: jest.Mock }
    attempt: Record<string, unknown>
  } {
    const attempt = {
      _id: new ObjectId(),
      provider: 'momo',
      txRef: 'MOMO-1',
      amount: 2_000_000,
      contractId: 'contract-1',
      clientChannel: 'web',
      status: 'pending',
      ...attemptOverrides,
    }
    const verifier = {
      extractTxRef: jest.fn().mockReturnValue('MOMO-1'),
      verify: jest.fn().mockReturnValue({
        txRef: 'MOMO-1',
        amount: 2_000_000,
        succeeded: true,
        providerTransactionId: 'T-1',
      }),
    }
    const mockBankService = {
      settleVerifiedAttempt: jest.fn().mockResolvedValue('settled'),
    }
    const service = new GatewayCallbackService(
      { findOne: jest.fn().mockResolvedValue(attempt) } as never,
      { verifierFor: jest.fn().mockReturnValue(verifier) } as never,
      mockBankService as never,
      testConfigService() as never
    )
    return { service, verifier, mockBankService, attempt }
  }

  it('settles a verified notification against the stored attempt amount', async () => {
    const context = createContext()

    const result = await context.service.handleNotify('momo', {
      orderId: 'MOMO-1',
    })

    expect(result).toMatchObject({ ok: true, outcome: 'settled' })
    expect(context.verifier.verify).toHaveBeenCalledWith(
      { orderId: 'MOMO-1' },
      'notify',
      { txRef: 'MOMO-1', amount: 2_000_000, payeeAccountNumber: null }
    )
    expect(context.mockBankService.settleVerifiedAttempt).toHaveBeenCalledWith(
      context.attempt,
      expect.objectContaining({ succeeded: true }),
      expect.stringMatching(/^[a-f0-9]{64}$/)
    )
  })

  it('verifies against the payee account stored on the attempt', async () => {
    const context = createContext({ payeeAccountNumber: '810000000002' })

    await context.service.handleNotify('momo', { orderId: 'MOMO-1' })

    expect(context.verifier.verify).toHaveBeenCalledWith(
      { orderId: 'MOMO-1' },
      'notify',
      {
        txRef: 'MOMO-1',
        amount: 2_000_000,
        payeeAccountNumber: '810000000002',
      }
    )
  })

  it('rejects a payee mismatch without settling', async () => {
    const context = createContext()
    context.verifier.verify.mockRejectedValue(
      new GatewayVerificationError('payee-mismatch')
    )

    const result = await context.service.handleNotify('momo', {
      orderId: 'MOMO-1',
    })

    expect(result).toMatchObject({ ok: false, reason: 'payee-mismatch' })
    expect(context.mockBankService.settleVerifiedAttempt).not.toHaveBeenCalled()
  })

  it('treats a reference owned by another provider as unknown', async () => {
    const context = createContext({ provider: 'momo' })

    const result = await context.service.handleNotify('zalopay', {
      app_trans_id: 'MOMO-1',
    })

    expect(result).toMatchObject({ ok: false, reason: 'unknown-reference' })
    expect(context.verifier.verify).not.toHaveBeenCalled()
    expect(context.mockBankService.settleVerifiedAttempt).not.toHaveBeenCalled()
  })

  it('redirects a tampered web return to the failure URL without echoing the query', async () => {
    const context = createContext()
    context.verifier.verify.mockImplementation(() => {
      throw new GatewayVerificationError('invalid-signature')
    })

    const url = await context.service.handleReturn('momo', {
      orderId: 'MOMO-1',
      evil: '<script>',
    })

    expect(url).toBe(
      'http://localhost:3000/contracts/contract-1?payment=failed&provider=momo'
    )
    expect(context.mockBankService.settleVerifiedAttempt).not.toHaveBeenCalled()
  })

  it('redirects a mobile attempt to the app deep link', async () => {
    const context = createContext({ clientChannel: 'mobile' })

    await expect(
      context.service.handleReturn('momo', { orderId: 'MOMO-1' })
    ).resolves.toBe('thproptech://payment-result?status=succeeded&txRef=MOMO-1')
  })

  it('redirects an unknown reference to the generic web failure page', async () => {
    const context = createContext()
    context.verifier.extractTxRef.mockReturnValue(null)

    await expect(context.service.handleReturn('momo', {})).resolves.toBe(
      'http://localhost:3000/payments?payment=failed&provider=momo'
    )
  })

  it('includes the stored reference on a verified return without a contract', async () => {
    const context = createContext({ contractId: null })

    await expect(
      context.service.handleReturn('momo', { orderId: 'MOMO-1' })
    ).resolves.toBe(
      'http://localhost:3000/payments?payment=succeeded&provider=momo&txRef=MOMO-1'
    )
  })

  it('does not include a reference after a tampered return without a contract', async () => {
    const context = createContext({ contractId: null })
    context.verifier.verify.mockImplementation(() => {
      throw new GatewayVerificationError('invalid-signature')
    })

    await expect(
      context.service.handleReturn('momo', { orderId: 'MOMO-1' })
    ).resolves.toBe(
      'http://localhost:3000/payments?payment=failed&provider=momo'
    )
  })

  it('reports internal settlement errors so gateways retry', async () => {
    const context = createContext()
    context.mockBankService.settleVerifiedAttempt.mockRejectedValue(
      new Error('DEPOSIT_NOT_PAYMENT_PENDING')
    )

    const result = await context.service.handleNotify('momo', {})

    expect(result).toMatchObject({ ok: false, reason: 'internal-error' })
    expect(context.service.toMomoStatus(result)).toBe(500)
    expect(context.service.toZalopayAck(result).return_code).toBe(0)
  })

  it('awaits an asynchronous verifier before settling', async () => {
    const context = createContext({ provider: 'mocbank', txRef: 'MOCBANK-1' })
    context.verifier.verify.mockResolvedValue({
      txRef: 'MOCBANK-1',
      amount: 2_000_000,
      succeeded: true,
      providerTransactionId: 'TX_1',
    })

    const result = await context.service.handleNotify('mocbank', {})

    expect(result).toMatchObject({ ok: true, outcome: 'settled' })
    expect(context.mockBankService.settleVerifiedAttempt).toHaveBeenCalledWith(
      context.attempt,
      expect.objectContaining({ providerTransactionId: 'TX_1' }),
      expect.any(String)
    )
  })

  it('maps a rejected asynchronous verifier to a reason, not a crash', async () => {
    const context = createContext({ provider: 'mocbank' })
    context.verifier.verify.mockRejectedValue(
      new GatewayVerificationError('amount-mismatch')
    )

    const result = await context.service.handleNotify('mocbank', {})

    expect(result).toMatchObject({ ok: false, reason: 'amount-mismatch' })
    expect(context.mockBankService.settleVerifiedAttempt).not.toHaveBeenCalled()
  })

  it('reports an unavailable reconciliation as internal-error so Ví Mộc retries', async () => {
    const context = createContext({ provider: 'mocbank' })
    context.verifier.verify.mockRejectedValue(
      new Error('MOCBANK_RECONCILE_UNAVAILABLE')
    )

    const result = await context.service.handleNotify('mocbank', {})

    expect(result).toMatchObject({ ok: false, reason: 'internal-error' })
    expect(context.service.toMocbankStatus(result)).toBe(503)
    expect(context.mockBankService.settleVerifiedAttempt).not.toHaveBeenCalled()
  })

  it('maps Ví Mộc webhook results to HTTP statuses', () => {
    const { service } = createContext()
    const ok = (outcome: string): never =>
      ({ ok: true, outcome, attempt: null }) as never
    const failed = (reason: string): never =>
      ({ ok: false, reason, attempt: null }) as never

    expect(service.toMocbankStatus(ok('settled'))).toBe(200)
    expect(service.toMocbankStatus(ok('replayed'))).toBe(200)
    expect(service.toMocbankStatus(ok('failed'))).toBe(200)
    expect(service.toMocbankStatus(failed('internal-error'))).toBe(503)
    expect(service.toMocbankStatus(failed('amount-mismatch'))).toBe(400)
    expect(service.toMocbankStatus(failed('unknown-reference'))).toBe(400)
    expect(service.toMocbankStatus(failed('invalid-payload'))).toBe(400)
  })

  it('maps ZaloPay and MoMo acknowledgements', () => {
    const { service } = createContext()
    const settled = { ok: true, outcome: 'settled', attempt: null } as never
    const replayed = { ok: true, outcome: 'replayed', attempt: null } as never
    const badMac = {
      ok: false,
      reason: 'invalid-signature',
      attempt: null,
    } as never

    expect(service.toZalopayAck(settled)).toEqual({
      return_code: 1,
      return_message: 'success',
    })
    expect(service.toZalopayAck(replayed).return_code).toBe(2)
    expect(service.toZalopayAck(badMac)).toEqual({
      return_code: -1,
      return_message: 'mac not equal',
    })
    expect(service.toMomoStatus(settled)).toBe(204)
    expect(service.toMomoStatus(badMac)).toBe(400)
  })
})

describe('GatewayCallbackService with the Ví Mộc verifier', () => {
  const moc = TEST_PAYMENTS.mocbank
  const attempt = {
    _id: new ObjectId(),
    provider: 'mocbank',
    txRef: 'MOCBANK-abc',
    amount: 5_000_000,
    contractId: 'contract-1',
    clientChannel: 'web',
    status: 'pending',
  }
  const reconcile = (): jest.Mock =>
    jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        success: true,
        data: {
          paymentId: 'PAY_ABC123',
          orderId: 'MOCBANK-abc',
          amount: 5_000_000,
          status: 'SUCCESS',
          transactionCode: 'TX_1',
        },
      }),
    })

  function setup(settle: jest.Mock): {
    service: GatewayCallbackService
    fetcher: jest.Mock
  } {
    const fetcher = reconcile()
    const verifier = new MocbankCallbackVerifier(
      testConfigService() as never,
      fetcher
    )
    const service = new GatewayCallbackService(
      { findOne: jest.fn().mockResolvedValue(attempt) } as never,
      { verifierFor: jest.fn().mockReturnValue(verifier) } as never,
      { settleVerifiedAttempt: settle } as never,
      testConfigService() as never
    )
    return { service, fetcher }
  }

  const successWebhook = {
    event: 'payment.success',
    paymentId: 'PAY_ABC123',
    orderId: 'MOCBANK-abc',
    amount: 5_000_000,
  }

  function signedReturn(): Record<string, string> {
    const fields = {
      moc_payment_id: 'PAY_ABC123',
      moc_order_id: 'MOCBANK-abc',
      moc_status: 'SUCCESS',
      moc_ts: String(Math.floor(Date.now() / 1000)),
    }
    return {
      ...fields,
      moc_sig: createHmac('sha256', moc.merchantSecret)
        .update(Object.values(fields).join('.'))
        .digest('hex'),
    }
  }

  it('settles on the webhook and treats the later return as a replay', async () => {
    const settle = jest
      .fn()
      .mockResolvedValueOnce('settled')
      .mockResolvedValueOnce('replayed')
    const { service } = setup(settle)

    const notify = await service.handleNotify('mocbank', successWebhook)
    const redirect = await service.handleReturn('mocbank', signedReturn())

    expect(notify).toMatchObject({ ok: true, outcome: 'settled' })
    expect(service.toMocbankStatus(notify)).toBe(200)
    expect(redirect).toBe(
      'http://localhost:3000/contracts/contract-1?payment=succeeded&provider=mocbank'
    )
    expect(settle).toHaveBeenCalledTimes(2)
    expect(settle).toHaveBeenNthCalledWith(
      1,
      attempt,
      expect.objectContaining({
        succeeded: true,
        providerTransactionId: 'TX_1',
      }),
      expect.any(String)
    )
  })

  it('answers a retried webhook 200 without a second settlement', async () => {
    const settle = jest
      .fn()
      .mockResolvedValueOnce('settled')
      .mockResolvedValueOnce('replayed')
    const { service } = setup(settle)

    const first = await service.handleNotify('mocbank', successWebhook)
    const retry = await service.handleNotify('mocbank', successWebhook)

    expect(service.toMocbankStatus(first)).toBe(200)
    expect(retry).toMatchObject({ ok: true, outcome: 'replayed' })
    expect(service.toMocbankStatus(retry)).toBe(200)
  })

  it('answers 503 and does not settle when reconciliation is unreachable', async () => {
    const settle = jest.fn()
    const { service, fetcher } = setup(settle)
    fetcher.mockRejectedValue(new Error('down'))

    const result = await service.handleNotify('mocbank', successWebhook)

    expect(result).toMatchObject({ ok: false, reason: 'internal-error' })
    expect(service.toMocbankStatus(result)).toBe(503)
    expect(settle).not.toHaveBeenCalled()
  })

  it('answers 400 and does not settle when the webhook amount differs', async () => {
    const settle = jest.fn()
    const { service } = setup(settle)

    const result = await service.handleNotify('mocbank', {
      ...successWebhook,
      amount: 1,
    })

    expect(service.toMocbankStatus(result)).toBe(400)
    expect(settle).not.toHaveBeenCalled()
  })
})
