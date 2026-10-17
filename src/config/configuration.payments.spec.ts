import { configuration, parseEnabledProviders } from './configuration'

describe('payment provider configuration', () => {
  it('keeps the allow-list order, including mocbank', () => {
    expect(parseEnabledProviders('mocbank,mock-bank', undefined)).toEqual([
      'mocbank',
      'mock-bank',
    ])
  })

  it('drops unknown names and duplicates', () => {
    expect(parseEnabledProviders('mocbank, paypal,mocbank', undefined)).toEqual(
      ['mocbank']
    )
  })

  it('falls back to mock-bank when nothing valid is listed', () => {
    expect(parseEnabledProviders('paypal', undefined)).toEqual(['mock-bank'])
  })

  describe('rentalFlow.payments.mocbank', () => {
    const keys = [
      'MOCBANK_BASE_URL',
      'MOCBANK_MERCHANT_ID',
      'MOCBANK_MERCHANT_SECRET',
      'MOCBANK_RETURN_URL',
      'MOCBANK_WEBHOOK_URL',
    ]
    const saved = new Map(keys.map(key => [key, process.env[key]]))

    afterEach(() => {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    })

    it('defaults to the sandbox base URL and local return URL', () => {
      for (const key of keys) delete process.env[key]

      expect(configuration().rentalFlow.payments.mocbank).toEqual({
        baseUrl: 'https://bank-sanboxv1.vercel.app',
        merchantId: '',
        merchantSecret: '',
        returnUrl: 'http://localhost:3001/api/v1/bank/mocbank/return',
        webhookUrl: '',
      })
    })

    it('reads and trims the MOCBANK_* variables', () => {
      process.env.MOCBANK_MERCHANT_ID = ' MB_1 '
      process.env.MOCBANK_MERCHANT_SECRET = ' s3cret '
      process.env.MOCBANK_WEBHOOK_URL = ' https://t.example/webhook '

      expect(configuration().rentalFlow.payments.mocbank).toMatchObject({
        merchantId: 'MB_1',
        merchantSecret: 's3cret',
        webhookUrl: 'https://t.example/webhook',
      })
    })
  })
})
