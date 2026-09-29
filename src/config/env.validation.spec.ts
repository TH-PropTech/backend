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
})
