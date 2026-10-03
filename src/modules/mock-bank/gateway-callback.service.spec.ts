import { ObjectId } from 'mongodb'
import { GatewayCallbackService } from './gateway-callback.service'
import { GatewayVerificationError } from './providers/payment-provider.port'
import { testConfigService } from './providers/gateway-test.util'

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
      { txRef: 'MOMO-1', amount: 2_000_000 }
    )
    expect(context.mockBankService.settleVerifiedAttempt).toHaveBeenCalledWith(
      context.attempt,
      expect.objectContaining({ succeeded: true }),
      expect.stringMatching(/^[a-f0-9]{64}$/)
    )
  })

  it('treats a reference owned by another provider as unknown', async () => {
    const context = createContext({ provider: 'momo' })

    const result = await context.service.handleNotify('vnpay', {
      vnp_TxnRef: 'MOMO-1',
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
    expect(context.service.toVnpayAck(result).RspCode).toBe('99')
  })

  it.each([
    [{ ok: true, outcome: 'settled' }, '00'],
    [{ ok: true, outcome: 'duplicate-paid' }, '00'],
    [{ ok: true, outcome: 'failed' }, '00'],
    [{ ok: true, outcome: 'replayed' }, '02'],
    [{ ok: false, reason: 'unknown-reference' }, '01'],
    [{ ok: false, reason: 'amount-mismatch' }, '04'],
    [{ ok: false, reason: 'invalid-signature' }, '97'],
  ])('maps %o to VNPAY RspCode %s', (result, code) => {
    const { service } = createContext()
    expect(
      service.toVnpayAck({ attempt: null, ...result } as never).RspCode
    ).toBe(code)
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
