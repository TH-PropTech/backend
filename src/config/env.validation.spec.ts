import { envValidationSchema } from './env.validation'

describe('envValidationSchema eKYC configuration', () => {
  const baseEnvironment = {
    DATABASE_URL: 'mongodb://localhost:27017/th_proptech_test',
  }

  it('accepts an HTTPS eKYC service URL', () => {
    const result = envValidationSchema.validate({
      ...baseEnvironment,
      EKYC_SERVICE_URL: 'https://ekyc.example.com',
    })

    expect(result.error).toBeUndefined()
  })

  it('rejects a missing eKYC service URL', () => {
    const result = envValidationSchema.validate(baseEnvironment)

    expect(result.error?.message).toContain('EKYC_SERVICE_URL')
  })

  it('rejects a non-HTTP eKYC service URL', () => {
    const result = envValidationSchema.validate({
      ...baseEnvironment,
      EKYC_SERVICE_URL: 'file:///tmp/ekyc',
    })

    expect(result.error?.message).toContain('EKYC_SERVICE_URL')
  })

  it('requires a 256-bit media encryption key in production', () => {
    const result = envValidationSchema.validate({
      ...baseEnvironment,
      NODE_ENV: 'production',
      EKYC_SERVICE_URL: 'https://ekyc.example.com',
    })

    expect(result.error?.message).toContain('KYC_MEDIA_ENCRYPTION_KEY')
  })

  it('accepts the mock provider and rejects unknown payment providers', () => {
    const accepted = envValidationSchema.validate({
      ...baseEnvironment,
      EKYC_SERVICE_URL: 'https://ekyc.example.com',
      PAYMENT_PROVIDER: 'mock-bank',
    })
    expect(accepted.error).toBeUndefined()

    const rejected = envValidationSchema.validate({
      ...baseEnvironment,
      EKYC_SERVICE_URL: 'https://ekyc.example.com',
      PAYMENT_PROVIDER: 'unknown-bank',
    })
    expect(rejected.error?.message).toContain('PAYMENT_PROVIDER')
  })

  const gatewayEnvironment = {
    VNPAY_TMN_CODE: 'TESTTMN1',
    VNPAY_HASH_SECRET: 'vnpay-test-secret',
    MOMO_PARTNER_CODE: 'MOMOTEST',
    MOMO_ACCESS_KEY: 'momo-access',
    MOMO_SECRET_KEY: 'momo-secret',
    ZALOPAY_APP_ID: '2553',
    ZALOPAY_KEY1: 'zalo-key1',
    ZALOPAY_KEY2: 'zalo-key2',
  }

  it('defaults to mock-bank only when no gateway is enabled', () => {
    const result = envValidationSchema.validate({
      ...baseEnvironment,
      EKYC_SERVICE_URL: 'https://ekyc.example.com',
    })
    expect(result.error).toBeUndefined()
  })

  it.each([
    ['vnpay', 'VNPAY_HASH_SECRET'],
    ['momo', 'MOMO_SECRET_KEY'],
    ['zalopay', 'ZALOPAY_KEY2'],
  ])(
    'rejects enabled %s without %s and never echoes secrets',
    (provider, missingKey) => {
      const result = envValidationSchema.validate({
        ...baseEnvironment,
        ...gatewayEnvironment,
        EKYC_SERVICE_URL: 'https://ekyc.example.com',
        PAYMENT_PROVIDERS_ENABLED: provider,
        [missingKey]: '',
      })
      expect(result.error?.message).toContain(missingKey)
      for (const secret of Object.values(gatewayEnvironment)) {
        expect(result.error?.message).not.toContain(secret)
      }
    }
  )

  it('applies the legacy PAYMENT_PROVIDER when the allow-list is unset', () => {
    const result = envValidationSchema.validate({
      ...baseEnvironment,
      EKYC_SERVICE_URL: 'https://ekyc.example.com',
      PAYMENT_PROVIDER: 'vnpay',
    })
    expect(result.error?.message).toContain('VNPAY_TMN_CODE')
  })

  it('accepts all three gateways when fully configured', () => {
    const result = envValidationSchema.validate({
      ...baseEnvironment,
      ...gatewayEnvironment,
      EKYC_SERVICE_URL: 'https://ekyc.example.com',
      PAYMENT_PROVIDERS_ENABLED: 'mock-bank, vnpay,momo,zalopay',
    })
    expect(result.error).toBeUndefined()
  })

  it('rejects unknown names in the allow-list', () => {
    const result = envValidationSchema.validate({
      ...baseEnvironment,
      EKYC_SERVICE_URL: 'https://ekyc.example.com',
      PAYMENT_PROVIDERS_ENABLED: 'vnpay,paypal',
    })
    expect(result.error?.message).toContain('PAYMENT_PROVIDERS_ENABLED')
  })

  it('requires https notify URLs for MoMo and ZaloPay in production', () => {
    const result = envValidationSchema.validate({
      ...baseEnvironment,
      ...gatewayEnvironment,
      NODE_ENV: 'production',
      EKYC_SERVICE_URL: 'https://ekyc.example.com',
      KYC_MEDIA_ENCRYPTION_KEY: 'a'.repeat(64),
      PAYMENT_PROVIDERS_ENABLED: 'momo',
      MOMO_IPN_URL: 'http://api.example.com/api/v1/bank/momo/ipn',
    })
    expect(result.error?.message).toContain('MOMO_IPN_URL')
  })

  it('accepts valid Fabric and rental operations settings', () => {
    const result = envValidationSchema.validate({
      ...baseEnvironment,
      EKYC_SERVICE_URL: 'https://ekyc.example.com',
      FABRIC_EXPLORER_TX_URL_TEMPLATE: 'https://explorer.example/tx/{txId}',
      FABRIC_OUTBOX_POLL_INTERVAL_MS: 1000,
      RENTAL_SCHEDULER_ENABLED: true,
      DEPOSIT_AGREEMENT_TTL_HOURS: 48,
      RENTAL_STUCK_LEDGER_FAILED_TERMINAL_MINUTES: 30,
    })

    expect(result.error).toBeUndefined()
    const value = result.value as {
      FABRIC_OUTBOX_POLL_INTERVAL_MS: number
      DEPOSIT_AGREEMENT_TTL_HOURS: number
    }
    expect(value.FABRIC_OUTBOX_POLL_INTERVAL_MS).toBe(1000)
    expect(value.DEPOSIT_AGREEMENT_TTL_HOURS).toBe(48)
  })

  it('rejects malformed Explorer templates and non-positive operational thresholds', () => {
    const result = envValidationSchema.validate({
      ...baseEnvironment,
      EKYC_SERVICE_URL: 'https://ekyc.example.com',
      FABRIC_EXPLORER_TX_URL_TEMPLATE: 'https://explorer.example/tx',
      FABRIC_OUTBOX_POLL_INTERVAL_MS: 50,
      DEPOSIT_AGREEMENT_TTL_HOURS: 0,
      RENTAL_STUCK_HANDOVER_OVERDUE_HOURS: 0,
    })

    expect(result.error).toBeDefined()
    expect(result.error?.message).toMatch(
      /FABRIC_EXPLORER_TX_URL_TEMPLATE|FABRIC_OUTBOX_POLL_INTERVAL_MS|DEPOSIT_AGREEMENT_TTL_HOURS/
    )
  })
})
