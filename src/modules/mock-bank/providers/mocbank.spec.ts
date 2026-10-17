import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { createHmac } from 'node:crypto'
import { MocbankAdapter } from './mocbank.adapter'
import { MocbankCallbackVerifier } from './mocbank-callback.verifier'
import { GatewayVerificationError } from './payment-provider.port'
import {
  jsonFetcher,
  TEST_PAYMENTS,
  testConfigService,
} from './gateway-test.util'

const moc = TEST_PAYMENTS.mocbank
const PAYMENT_URL = `${moc.baseUrl}/pay/PAY_ABC123`
const input = {
  amount: 5_000_000,
  description: 'Deposit for apartment A-12',
  customerRef: 'tenant-1',
  txRef: 'MOCBANK-abc',
  expiresAt: new Date(Date.now() + 15 * 60_000),
}

function createReply(
  overrides: Record<string, unknown> = {},
  success = true
): unknown {
  return {
    success,
    data: {
      paymentId: 'PAY_ABC123',
      orderId: input.txRef,
      amount: input.amount,
      status: 'CREATED',
      paymentUrl: PAYMENT_URL,
      ...overrides,
    },
  }
}

function httpFetcher(status: number, body: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  })
}

type FetchCall = [string, RequestInit]

describe('MocbankAdapter', () => {
  const adapter = (fetcher: jest.Mock): MocbankAdapter =>
    new MocbankAdapter(testConfigService() as never, fetcher)

  function sentBody(fetcher: jest.Mock): Record<string, unknown> {
    const [, init] = fetcher.mock.calls[0] as FetchCall
    return JSON.parse(init.body as string) as Record<string, unknown>
  }

  it('generates MOCBANK-<24 hex> references', () => {
    expect(adapter(jest.fn()).newTxRef()).toMatch(/^MOCBANK-[a-f0-9]{24}$/)
  })

  it('creates a session with merchant headers and returns the paymentUrl', async () => {
    const fetcher = jsonFetcher(createReply())

    const intent = await adapter(fetcher).createPaymentIntent(input)

    expect(intent).toEqual({
      provider: 'mocbank',
      txRef: 'MOCBANK-abc',
      redirectUrl: PAYMENT_URL,
      expiresAt: input.expiresAt,
    })
    const [url, init] = fetcher.mock.calls[0] as FetchCall
    expect(url).toBe(`${moc.baseUrl}/api/payments/create`)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'X-Merchant-Id': moc.merchantId,
      'X-Merchant-Secret': moc.merchantSecret,
    })
    expect(sentBody(fetcher)).toEqual({
      orderId: 'MOCBANK-abc',
      amount: 5_000_000,
      description: input.description,
      returnUrl: moc.returnUrl,
      cancelUrl: moc.returnUrl,
      webhookUrl: moc.webhookUrl,
      expiresInMinutes: 15,
      channel: 'web',
    })
  })

  it('forwards the mobile channel', async () => {
    const fetcher = jsonFetcher(createReply())

    await adapter(fetcher).createPaymentIntent({
      ...input,
      clientChannel: 'mobile',
    })

    expect(sentBody(fetcher).channel).toBe('mobile')
  })

  it('omits webhookUrl when none is configured', async () => {
    const fetcher = jsonFetcher(createReply())
    const payments = {
      ...TEST_PAYMENTS,
      mocbank: { ...moc, webhookUrl: '' },
    }

    await new MocbankAdapter(
      testConfigService(payments) as never,
      fetcher
    ).createPaymentIntent(input)

    expect(sentBody(fetcher)).not.toHaveProperty('webhookUrl')
  })

  it.each([
    ['120 minutes ahead', 120 * 60_000, 60],
    ['30 seconds ahead', 30_000, 1],
    ['already in the past', -5 * 60_000, 1],
  ])(
    'clamps expiresInMinutes to 1-60 when expiry is %s',
    async (_l, offset, minutes) => {
      const fetcher = jsonFetcher(createReply())

      await adapter(fetcher).createPaymentIntent({
        ...input,
        expiresAt: new Date(Date.now() + offset),
      })

      expect(sentBody(fetcher).expiresInMinutes).toBe(minutes)
    }
  )

  it('truncates the description to 200 characters', async () => {
    const fetcher = jsonFetcher(createReply())

    await adapter(fetcher).createPaymentIntent({
      ...input,
      description: 'x'.repeat(250),
    })

    expect(String(sentBody(fetcher).description)).toHaveLength(200)
  })

  it('accepts the 50,000,000 VND limit', async () => {
    const fetcher = jsonFetcher(createReply({ amount: 50_000_000 }))

    await expect(
      adapter(fetcher).createPaymentIntent({ ...input, amount: 50_000_000 })
    ).resolves.toMatchObject({ redirectUrl: PAYMENT_URL })
  })

  it('rejects an amount above the limit before calling Mộc Bank', async () => {
    const fetcher = jsonFetcher(createReply())

    await expect(
      adapter(fetcher).createPaymentIntent({ ...input, amount: 50_000_001 })
    ).rejects.toThrow(new BadRequestException('PAYMENT_AMOUNT_OUT_OF_RANGE'))
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    ['success:false', jsonFetcher(createReply({}, false))],
    ['an HTTP 400', httpFetcher(400, createReply())],
    ['an HTTP 500', httpFetcher(500, createReply())],
    ['malformed JSON', jsonFetcher(undefined, true)],
    ['an empty body', jsonFetcher(null)],
    ['a missing data object', jsonFetcher({ success: true })],
    [
      'an http paymentUrl',
      jsonFetcher(createReply({ paymentUrl: 'http://moc.example.test/pay/1' })),
    ],
    [
      'a paymentUrl on another origin',
      jsonFetcher(createReply({ paymentUrl: 'https://evil.example/pay/1' })),
    ],
    ['a different orderId', jsonFetcher(createReply({ orderId: 'OTHER' }))],
    ['a different amount', jsonFetcher(createReply({ amount: 1 }))],
    ['a timeout', jest.fn().mockRejectedValue(new Error('timeout'))],
  ])('answers 503 on %s', async (_label, fetcher) => {
    await expect(adapter(fetcher).createPaymentIntent(input)).rejects.toThrow(
      ServiceUnavailableException
    )
  })

  it('answers 503 on invalid JSON from the gateway', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockRejectedValue(new SyntaxError('bad json')),
    })

    await expect(adapter(fetcher).createPaymentIntent(input)).rejects.toThrow(
      ServiceUnavailableException
    )
  })

  it('logs the failure without secrets', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined)
    const fetcher = httpFetcher(401, {
      success: false,
      error: { code: 'MERCHANT_UNAUTHORIZED', message: 'nope' },
    })

    await expect(adapter(fetcher).createPaymentIntent(input)).rejects.toThrow(
      ServiceUnavailableException
    )

    const logged = warn.mock.calls.map(call => String(call[0])).join('\n')
    expect(logged).toContain('MOCBANK-abc')
    expect(logged).toContain('http=401')
    expect(logged).toContain('MERCHANT_UNAUTHORIZED')
    expect(logged).not.toContain(moc.merchantSecret)
    warn.mockRestore()
  })

  it('sends the landlord payeeAccountNumber so money skips the platform wallet', async () => {
    const fetcher = jsonFetcher(createReply())

    await adapter(fetcher).createPaymentIntent({
      ...input,
      payeeAccountNumber: '810000000002',
    })

    expect(sentBody(fetcher)).toMatchObject({
      payeeAccountNumber: '810000000002',
    })
  })

  it('omits payeeAccountNumber for platform-owned payments', async () => {
    const fetcher = jsonFetcher(createReply())

    await adapter(fetcher).createPaymentIntent(input)

    expect(sentBody(fetcher)).not.toHaveProperty('payeeAccountNumber')
  })

  it('maps PAYEE_NOT_FOUND to 422 LANDLORD_PAYEE_ACCOUNT_INVALID', async () => {
    const fetcher = httpFetcher(400, {
      success: false,
      error: { code: 'PAYEE_NOT_FOUND', message: 'x' },
    })

    await expect(
      adapter(fetcher).createPaymentIntent({
        ...input,
        payeeAccountNumber: '810000000009',
      })
    ).rejects.toThrow(
      new UnprocessableEntityException('LANDLORD_PAYEE_ACCOUNT_INVALID')
    )
  })

  it('returns an unlinked external account link', async () => {
    await expect(adapter(jest.fn()).getAccountLink('u1')).resolves.toEqual({
      provider: 'mocbank',
      externalAccountRef: 'mocbank:u1',
      status: 'unlinked',
      simulation: false,
    })
  })
})

describe('MocbankCallbackVerifier', () => {
  const expected = { txRef: 'MOCBANK-abc', amount: 5_000_000 }

  const verifierWith = (fetcher: jest.Mock): MocbankCallbackVerifier =>
    new MocbankCallbackVerifier(testConfigService() as never, fetcher)

  const sign = (data: string): string =>
    createHmac('sha256', moc.merchantSecret).update(data).digest('hex')

  function webhook(
    body: Record<string, unknown>,
    options: { ts?: number; raw?: string; signAs?: string } = {}
  ): { raw: string; headers: Record<string, string> } {
    const raw = options.raw ?? JSON.stringify(body)
    const ts = String(options.ts ?? Date.now())
    return {
      raw,
      headers: {
        'x-sandbox-timestamp': ts,
        'x-sandbox-signature': sign(`${ts}.${options.signAs ?? raw}`),
      },
    }
  }

  const successBody = {
    id: 'EVT_1',
    event: 'payment.success',
    paymentId: 'PAY_ABC123',
    orderId: 'MOCBANK-abc',
    status: 'SUCCESS',
    amount: 5_000_000,
  }

  function reconcileReply(overrides: Record<string, unknown> = {}): unknown {
    return {
      success: true,
      data: {
        paymentId: 'PAY_ABC123',
        orderId: 'MOCBANK-abc',
        amount: 5_000_000,
        status: 'SUCCESS',
        transactionCode: 'TX_5A3AEA',
        ...overrides,
      },
    }
  }

  async function failureOf(promise: Promise<unknown>): Promise<unknown> {
    try {
      await promise
      return null
    } catch (error) {
      return error instanceof GatewayVerificationError ? error.reason : error
    }
  }

  describe('verifyWebhookEnvelope', () => {
    const verifier = verifierWith(jest.fn())

    it('accepts a correctly signed fresh body', () => {
      const { raw, headers } = webhook(successBody)

      expect(verifier.verifyWebhookEnvelope(raw, headers)).toEqual({
        event: 'payment.success',
        body: successBody,
      })
    })

    it('accepts an upper-case hex signature', () => {
      const { raw, headers } = webhook(successBody)

      expect(() =>
        verifier.verifyWebhookEnvelope(raw, {
          ...headers,
          'x-sandbox-signature': String(
            headers['x-sandbox-signature']
          ).toUpperCase(),
        })
      ).not.toThrow()
    })

    it.each([
      ['a wrong signature', { signAs: 'something else' }],
      ['a timestamp 6 minutes old', { ts: Date.now() - 6 * 60_000 }],
      ['a timestamp 6 minutes in the future', { ts: Date.now() + 6 * 60_000 }],
    ])('rejects %s', (_label, options) => {
      const { raw, headers } = webhook(successBody, options)

      expect(() => verifier.verifyWebhookEnvelope(raw, headers)).toThrow(
        new GatewayVerificationError('invalid-signature')
      )
    })

    it.each(['x-sandbox-signature', 'x-sandbox-timestamp'])(
      'rejects a missing %s header',
      header => {
        const { raw, headers } = webhook(successBody)
        const rest = Object.fromEntries(
          Object.entries(headers).filter(([name]) => name !== header)
        )

        expect(() => verifier.verifyWebhookEnvelope(raw, rest)).toThrow(
          new GatewayVerificationError('invalid-signature')
        )
      }
    )

    it('rejects a non-numeric timestamp', () => {
      const { raw, headers } = webhook(successBody)

      expect(() =>
        verifier.verifyWebhookEnvelope(raw, {
          ...headers,
          'x-sandbox-timestamp': 'abc',
        })
      ).toThrow(new GatewayVerificationError('invalid-signature'))
    })

    it('rejects semantically equal JSON with different bytes', () => {
      const signed = webhook(successBody)
      const reformatted = JSON.stringify(successBody, null, 2)

      expect(() =>
        verifier.verifyWebhookEnvelope(reformatted, signed.headers)
      ).toThrow(new GatewayVerificationError('invalid-signature'))
    })

    it('rejects a correctly signed body that is not a JSON object', () => {
      const { raw, headers } = webhook({}, { raw: '[1]' })

      expect(() => verifier.verifyWebhookEnvelope(raw, headers)).toThrow(
        new GatewayVerificationError('invalid-payload')
      )
      const garbage = webhook({}, { raw: 'not json' })
      expect(() =>
        verifier.verifyWebhookEnvelope(garbage.raw, garbage.headers)
      ).toThrow(new GatewayVerificationError('invalid-payload'))
    })

    it('rejects a signed body without an event', () => {
      const { raw, headers } = webhook({ orderId: 'x' })

      expect(() => verifier.verifyWebhookEnvelope(raw, headers)).toThrow(
        new GatewayVerificationError('invalid-payload')
      )
    })
  })

  describe('extractTxRef', () => {
    const verifier = verifierWith(jest.fn())

    it('reads orderId from webhooks and moc_order_id from returns', () => {
      expect(verifier.extractTxRef({ orderId: 'A' }, 'notify')).toBe('A')
      expect(verifier.extractTxRef({ moc_order_id: 'B' }, 'return')).toBe('B')
      expect(verifier.extractTxRef({ orderId: 'A' }, 'return')).toBeNull()
      expect(verifier.extractTxRef(null, 'notify')).toBeNull()
    })
  })

  describe('verify notify', () => {
    it('reconciles a success webhook and returns the transaction code', async () => {
      const fetcher = jsonFetcher(reconcileReply())

      const verdict = await verifierWith(fetcher).verify(
        successBody,
        'notify',
        expected
      )

      expect(verdict).toEqual({
        txRef: 'MOCBANK-abc',
        amount: 5_000_000,
        succeeded: true,
        providerTransactionId: 'TX_5A3AEA',
      })
      const [url, init] = fetcher.mock.calls[0] as FetchCall
      expect(url).toBe(`${moc.baseUrl}/api/payments/PAY_ABC123`)
      expect(init.method).toBe('GET')
      expect(init.headers).toEqual({
        'X-Merchant-Id': moc.merchantId,
        'X-Merchant-Secret': moc.merchantSecret,
      })
    })

    it.each([
      ['orderId', { orderId: 'MOCBANK-other' }, 'unknown-reference'],
      ['amount', { amount: 5_000_001 }, 'amount-mismatch'],
      ['paymentId format', { paymentId: 'PAY_../x' }, 'invalid-payload'],
      ['missing paymentId', { paymentId: undefined }, 'invalid-payload'],
      ['event', { event: 'payment.refunded' }, 'invalid-payload'],
    ])(
      'rejects a mismatched %s without settling',
      async (_l, patch, reason) => {
        const fetcher = jsonFetcher(reconcileReply())

        const failure = await failureOf(
          verifierWith(fetcher).verify(
            { ...successBody, ...patch },
            'notify',
            expected
          )
        )

        expect(failure).toBe(reason)
        expect(fetcher).not.toHaveBeenCalled()
      }
    )

    it.each([
      ['orderId', { orderId: 'MOCBANK-other' }, 'unknown-reference'],
      ['amount', { amount: 4_000_000 }, 'amount-mismatch'],
      ['status', { status: 'PROCESSING' }, 'amount-mismatch'],
      ['status CANCELLED', { status: 'CANCELLED' }, 'amount-mismatch'],
    ])(
      'rejects reconciliation that disagrees on %s',
      async (_l, patch, reason) => {
        const fetcher = jsonFetcher(reconcileReply(patch))

        await expect(
          failureOf(
            verifierWith(fetcher).verify(successBody, 'notify', expected)
          )
        ).resolves.toBe(reason)
      }
    )

    it.each([
      ['a network failure', jest.fn().mockRejectedValue(new Error('down'))],
      ['an HTTP 500', httpFetcher(500, { success: false })],
      ['an HTTP 404', httpFetcher(404, { success: false })],
      ['a body without data', httpFetcher(200, { success: true })],
    ])(
      'throws a retryable non-verification error on %s',
      async (_l, fetcher) => {
        const failure = await failureOf(
          verifierWith(fetcher).verify(successBody, 'notify', expected)
        )

        expect(failure).toBeInstanceOf(Error)
        expect(failure).not.toBeInstanceOf(GatewayVerificationError)
      }
    )

    it.each(['payment.cancelled', 'payment.expired'])(
      'treats %s as unsucceeded without reconciling',
      async event => {
        const fetcher = jsonFetcher(reconcileReply())

        const verdict = await verifierWith(fetcher).verify(
          { ...successBody, event },
          'notify',
          expected
        )

        expect(verdict).toEqual({
          txRef: 'MOCBANK-abc',
          amount: 5_000_000,
          succeeded: false,
          providerTransactionId: null,
        })
        expect(fetcher).not.toHaveBeenCalled()
      }
    )

    it('rejects a non-object payload', async () => {
      await expect(
        failureOf(verifierWith(jest.fn()).verify(null, 'notify', expected))
      ).resolves.toBe('invalid-payload')
    })
  })

  describe('payee reconciliation', () => {
    const payee = '810000000002'

    it('settles when Mộc Bank confirms the landlord account', async () => {
      const fetcher = jsonFetcher(reconcileReply({ payeeAccountNumber: payee }))

      const verdict = await verifierWith(fetcher).verify(
        successBody,
        'notify',
        { ...expected, payeeAccountNumber: payee }
      )

      expect(verdict.succeeded).toBe(true)
    })

    it.each([
      ['another account', { payeeAccountNumber: '810000000099' }, payee],
      ['no account (money went to the platform)', {}, payee],
      [
        'an account for a platform payment',
        { payeeAccountNumber: payee },
        null,
      ],
    ])(
      'rejects reconciliation that reports %s',
      async (_l, reply, expectedPayee) => {
        const fetcher = jsonFetcher(reconcileReply(reply))

        const failure = await failureOf(
          verifierWith(fetcher).verify(successBody, 'notify', {
            ...expected,
            payeeAccountNumber: expectedPayee,
          })
        )

        expect(failure).toBe('payee-mismatch')
      }
    )

    it('also checks the payee on a signed browser return', async () => {
      const ts = String(Math.floor(Date.now() / 1000))
      const sig = sign(['PAY_ABC123', 'MOCBANK-abc', 'SUCCESS', ts].join('.'))
      const fetcher = jsonFetcher(
        reconcileReply({ payeeAccountNumber: '810000000099' })
      )

      const failure = await failureOf(
        verifierWith(fetcher).verify(
          {
            moc_payment_id: 'PAY_ABC123',
            moc_order_id: 'MOCBANK-abc',
            moc_status: 'SUCCESS',
            moc_ts: ts,
            moc_sig: sig,
          },
          'return',
          { ...expected, payeeAccountNumber: payee }
        )
      )

      expect(failure).toBe('payee-mismatch')
    })
  })

  describe('verify return', () => {
    function signedReturn(
      overrides: Record<string, string> = {},
      sigOverride?: string
    ): Record<string, string> {
      const fields = {
        moc_payment_id: 'PAY_ABC123',
        moc_order_id: 'MOCBANK-abc',
        moc_status: 'SUCCESS',
        moc_ts: String(Math.floor(Date.now() / 1000)),
        ...overrides,
      }
      const signed = [
        fields.moc_payment_id,
        fields.moc_order_id,
        fields.moc_status,
        fields.moc_ts,
      ].join('.')
      return { ...fields, moc_sig: sigOverride ?? sign(signed) }
    }

    it('reconciles a verified SUCCESS return', async () => {
      const fetcher = jsonFetcher(reconcileReply())

      await expect(
        verifierWith(fetcher).verify(signedReturn(), 'return', expected)
      ).resolves.toMatchObject({
        succeeded: true,
        providerTransactionId: 'TX_5A3AEA',
      })
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it.each(['CANCELLED', 'EXPIRED'])(
      'treats a signed %s return as unsucceeded without reconciling',
      async status => {
        const fetcher = jsonFetcher(reconcileReply())

        await expect(
          verifierWith(fetcher).verify(
            signedReturn({ moc_status: status }),
            'return',
            expected
          )
        ).resolves.toMatchObject({ succeeded: false, amount: 5_000_000 })
        expect(fetcher).not.toHaveBeenCalled()
      }
    )

    it.each([
      [
        'a wrong signature',
        signedReturn({}, 'f'.repeat(64)),
        'invalid-signature',
      ],
      [
        'a tampered status',
        { ...signedReturn({ moc_status: 'CANCELLED' }), moc_status: 'SUCCESS' },
        'invalid-signature',
      ],
      [
        'a timestamp older than 15 minutes',
        signedReturn({
          moc_ts: String(Math.floor(Date.now() / 1000) - 16 * 60),
        }),
        'invalid-signature',
      ],
      [
        'a non-numeric timestamp',
        signedReturn({ moc_ts: 'soon' }),
        'invalid-signature',
      ],
      [
        'a different order',
        signedReturn({ moc_order_id: 'MOCBANK-other' }),
        'unknown-reference',
      ],
      [
        'an unexpected status',
        signedReturn({ moc_status: 'PROCESSING' }),
        'invalid-payload',
      ],
      [
        'a malformed payment id',
        signedReturn({ moc_payment_id: 'PAY_1/../2' }),
        'invalid-payload',
      ],
    ])('rejects %s without reconciling', async (_l, query, reason) => {
      const fetcher = jsonFetcher(reconcileReply())

      await expect(
        failureOf(verifierWith(fetcher).verify(query, 'return', expected))
      ).resolves.toBe(reason)
      expect(fetcher).not.toHaveBeenCalled()
    })

    it.each([
      'moc_payment_id',
      'moc_order_id',
      'moc_status',
      'moc_ts',
      'moc_sig',
    ])('rejects a return missing %s', async field => {
      const query = Object.fromEntries(
        Object.entries(signedReturn()).filter(([name]) => name !== field)
      )

      await expect(
        failureOf(verifierWith(jest.fn()).verify(query, 'return', expected))
      ).resolves.toBe('invalid-payload')
    })

    it('rejects a SUCCESS return whose payment id is not PAY_ shaped even when signed', async () => {
      const fetcher = jsonFetcher(reconcileReply())

      await expect(
        failureOf(
          verifierWith(fetcher).verify(
            signedReturn({ moc_payment_id: 'abc' }),
            'return',
            expected
          )
        )
      ).resolves.toBe('invalid-payload')
      expect(fetcher).not.toHaveBeenCalled()
    })
  })

  it('logs reconciliation failures without secrets', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined)
    const fetcher = httpFetcher(401, {
      success: false,
      error: { code: 'MERCHANT_UNAUTHORIZED' },
    })

    await failureOf(
      verifierWith(fetcher).verify(successBody, 'notify', expected)
    )

    const logged = warn.mock.calls.map(call => String(call[0])).join('\n')
    expect(logged).toContain('http=401')
    expect(logged).toContain('MERCHANT_UNAUTHORIZED')
    expect(logged).not.toContain(moc.merchantSecret)
    warn.mockRestore()
  })
})
