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

  it('requires a complete VNPay configuration when VNPay is selected', () => {
    const rejected = envValidationSchema.validate({
      ...baseEnvironment,
      EKYC_SERVICE_URL: 'https://ekyc.example.com',
      PAYMENT_PROVIDER: 'vnpay',
    })
    expect(rejected.error?.message).toContain('VNPAY_GATEWAY_URL')

    const accepted = envValidationSchema.validate({
      ...baseEnvironment,
      EKYC_SERVICE_URL: 'https://ekyc.example.com',
      PAYMENT_PROVIDER: 'vnpay',
      VNPAY_GATEWAY_URL:
        'http://localhost:8888/order/create_payment_for_transaction',
      VNPAY_RETURN_URL: 'http://localhost:3001/api/v1/bank/vnpay/return',
      VNPAY_HASH_SECRET: 'a'.repeat(32),
      VNPAY_CLIENT_RETURN_URL: 'http://localhost:3000',
    })
    expect(accepted.error).toBeUndefined()
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
