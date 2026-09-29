import { PaymentProviderRegistry } from './payment-provider.registry'

describe('PaymentProviderRegistry', () => {
  function createContext(provider = 'mock-bank'): {
    registry: PaymentProviderRegistry
    adapter: { createPaymentIntent: jest.Mock; getAccountLink: jest.Mock }
  } {
    const configService = {
      get: jest.fn().mockReturnValue(provider),
    }
    const adapter = {
      createPaymentIntent: jest.fn().mockResolvedValue({
        provider: 'mock-bank',
        txRef: 'MOCK-1',
        redirectUrl: 'mockbank://pay?txRef=MOCK-1',
        expiresAt: new Date(),
      }),
      getAccountLink: jest.fn().mockResolvedValue({
        provider: 'mock-bank',
        externalAccountRef: 'mock-account:tenant-1',
        status: 'linked',
        simulation: true,
      }),
    }
    return {
      registry: new PaymentProviderRegistry(
        configService as never,
        adapter as never,
        adapter as never
      ),
      adapter,
    }
  }

  it('delegates payment intent creation to the configured mock adapter', async () => {
    const context = createContext()

    await expect(
      context.registry.createPaymentIntent({
        amount: 1_000,
        description: 'Rent',
        customerRef: 'tenant-1',
        txRef: 'MOCK-1',
      })
    ).resolves.toMatchObject({ provider: 'mock-bank', txRef: 'MOCK-1' })
    expect(context.adapter.createPaymentIntent).toHaveBeenCalled()
  })

  it('returns provider account links instead of balances', async () => {
    const context = createContext()

    await expect(
      context.registry.getAccountLink('tenant-1')
    ).resolves.toMatchObject({
      externalAccountRef: 'mock-account:tenant-1',
      simulation: true,
    })
  })

  it('fails closed for a provider without an approved adapter', async () => {
    const context = createContext('momo')

    await expect(
      context.registry.createPaymentIntent({
        amount: 1_000,
        description: 'Rent',
        customerRef: 'tenant-1',
        txRef: 'MOMO-1',
      })
    ).rejects.toThrow('BANK_PROVIDER_ADAPTER_NOT_CONFIGURED')
  })
})
