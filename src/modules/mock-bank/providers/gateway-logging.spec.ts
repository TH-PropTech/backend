import { Logger } from '@nestjs/common'
import { MomoAdapter } from './momo.adapter'
import { MomoCallbackVerifier } from './momo-callback.verifier'
import { ZalopayAdapter } from './zalopay.adapter'
import { ZalopayCallbackVerifier } from './zalopay-callback.verifier'
import {
  jsonFetcher,
  TEST_SECRETS,
  testConfigService,
} from './gateway-test.util'

/** Spec "Gateway secrets never leave server configuration". */
describe('gateway log hygiene', () => {
  const logged: string[] = []

  beforeEach(() => {
    logged.length = 0
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          logged.push(args.map(String).join(' '))
        })
    }
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('never logs keys or signatures on gateway failure paths', async () => {
    const config = testConfigService() as never
    const input = {
      amount: 1,
      description: 'x',
      customerRef: 'tenant-1',
      txRef: '261003_x',
      expiresAt: new Date(Date.now() + 60_000),
    }
    await new MomoAdapter(config, jsonFetcher({ resultCode: 99 }))
      .createPaymentIntent(input)
      .catch(() => undefined)
    await new ZalopayAdapter(config, jsonFetcher({ return_code: 2 }))
      .createPaymentIntent(input)
      .catch(() => undefined)
    const verifiers = [
      new MomoCallbackVerifier(config),
      new ZalopayCallbackVerifier(config),
    ]
    const errors: string[] = []
    for (const verifier of verifiers) {
      try {
        verifier.verify(
          {
            orderId: 'a',
            resultCode: 0,
            signature: 'bad',
            data: '{}',
            mac: 'bad',
          },
          'notify',
          { txRef: 'a', amount: 1 }
        )
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }

    expect(logged.length).toBeGreaterThan(0)
    const output = [...logged, ...errors].join('\n')
    for (const secret of TEST_SECRETS) {
      expect(output).not.toContain(secret)
    }
    expect(output).not.toMatch(/[a-f0-9]{64}/)
  })
})
