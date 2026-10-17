import { PaymentProviderRegistry } from './payment-provider.registry'
import { TEST_PAYMENTS, testConfigService } from './gateway-test.util'
import type { SelectablePaymentProvider } from '../../../config/configuration'

describe('PaymentProviderRegistry', () => {
  function createRegistry(
    enabledProviders: SelectablePaymentProvider[]
  ): PaymentProviderRegistry {
    const adapter = (name: string): object => ({
      name,
      getAccountLink: jest.fn().mockResolvedValue({
        provider: name,
        externalAccountRef: `${name}:tenant-1`,
        status: 'linked',
        simulation: name === 'mock-bank',
      }),
    })
    const verifier = (name: string): object => ({ name })
    return new PaymentProviderRegistry(
      testConfigService({ ...TEST_PAYMENTS, enabledProviders }) as never,
      adapter('mock-bank') as never,
      adapter('vnpay') as never,
      adapter('momo') as never,
      adapter('zalopay') as never,
      adapter('mocbank') as never,
      verifier('vnpay') as never,
      verifier('momo') as never,
      verifier('zalopay') as never,
      verifier('mocbank') as never
    )
  }

  it('returns the requested enabled adapter and defaults to the first enabled one', () => {
    const registry = createRegistry(['vnpay', 'momo'])

    expect(registry.get('momo').name).toBe('momo')
    expect(registry.get().name).toBe('vnpay')
    expect(registry.defaultProvider()).toBe('vnpay')
  })

  it.each(['zalopay', 'techcombank', 'sepay'] as const)(
    'fails closed for %s when it is not allow-listed',
    provider => {
      const registry = createRegistry(['mock-bank', 'vnpay'])

      expect(() => registry.get(provider)).toThrow(
        'PAYMENT_PROVIDER_NOT_ENABLED'
      )
    }
  )

  it('falls back to mock-bank when the allow-list is empty', () => {
    const registry = createRegistry([])

    expect(registry.enabledProviders()).toEqual(['mock-bank'])
    expect(registry.get().name).toBe('mock-bank')
  })

  it('lists enabled providers with labels and simulation flags only', () => {
    const registry = createRegistry(['mock-bank', 'vnpay', 'momo', 'zalopay'])
    const listed = registry.listProviders()

    expect(listed).toEqual([
      { provider: 'mock-bank', label: 'Mock Bank (sandbox)', simulation: true },
      { provider: 'vnpay', label: 'VNPAY', simulation: false },
      {
        provider: 'momo',
        label: 'MoMo',
        simulation: false,
        methods: [
          expect.objectContaining({ method: 'wallet', maxAmount: 50_000_000 }),
          expect.objectContaining({ method: 'atm', minAmount: 10_000 }),
          expect.objectContaining({ method: 'card', maxAmount: 10_000_000 }),
        ],
      },
      { provider: 'zalopay', label: 'ZaloPay', simulation: false },
    ])
    expect(JSON.stringify(listed)).not.toContain(TEST_PAYMENTS.vnpay.tmnCode)
  })

  it('lists Ví Mộc as an external gateway without credentials or URLs', () => {
    const registry = createRegistry(['mocbank', 'mock-bank'])
    const listed = registry.listProviders()

    expect(listed).toEqual([
      { provider: 'mocbank', label: 'Ví Mộc (sandbox)', simulation: false },
      { provider: 'mock-bank', label: 'Mock Bank (sandbox)', simulation: true },
    ])
    expect(registry.get('mocbank').name).toBe('mocbank')
    const json = JSON.stringify(listed)
    expect(json).not.toContain(TEST_PAYMENTS.mocbank.merchantSecret)
    expect(json).not.toContain(TEST_PAYMENTS.mocbank.merchantId)
    expect(json).not.toContain(TEST_PAYMENTS.mocbank.baseUrl)
    expect(json).not.toContain(TEST_PAYMENTS.mocbank.webhookUrl)
  })

  it('keeps verifiers available after a gateway is disabled (rollback)', () => {
    const registry = createRegistry(['mock-bank'])

    expect(registry.verifierFor('zalopay').name).toBe('zalopay')
    expect(registry.verifierFor('mocbank').name).toBe('mocbank')
  })

  it('returns provider account links instead of balances', async () => {
    const registry = createRegistry(['mock-bank'])

    await expect(registry.getAccountLink('tenant-1')).resolves.toMatchObject({
      externalAccountRef: 'mock-bank:tenant-1',
      simulation: true,
    })
  })
})
