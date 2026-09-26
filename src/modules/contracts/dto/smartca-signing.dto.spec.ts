import { validate } from 'class-validator'
import { CreateSmartCaSigningSessionDto } from './smartca-signing.dto'

describe('CreateSmartCaSigningSessionDto', () => {
  it('accepts the complete SmartCA v2 request', async () => {
    const dto = Object.assign(new CreateSmartCaSigningSessionDto(), {
      idempotencyKey: 'request-1',
      certificateSerial: 'SERIAL-001',
      smartCaPassword: 'password-redacted',
      smartCaOtp: '000000',
    })

    await expect(validate(dto)).resolves.toEqual([])
  })

  it.each([
    { smartCaPassword: '', smartCaOtp: '000000' },
    { smartCaPassword: 'password-redacted', smartCaOtp: '' },
    { smartCaPassword: 'x'.repeat(257), smartCaOtp: '000000' },
    { smartCaPassword: 'password-redacted', smartCaOtp: '0'.repeat(33) },
  ])('rejects empty or oversized credentials', async input => {
    const dto = Object.assign(new CreateSmartCaSigningSessionDto(), input)

    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })

  it('marks password and OTP write-only in generated OpenAPI metadata', () => {
    const passwordMetadata = Reflect.getMetadata(
      'swagger/apiModelProperties',
      CreateSmartCaSigningSessionDto.prototype,
      'smartCaPassword'
    ) as unknown
    const otpMetadata = Reflect.getMetadata(
      'swagger/apiModelProperties',
      CreateSmartCaSigningSessionDto.prototype,
      'smartCaOtp'
    ) as unknown

    expect(passwordMetadata).toEqual(
      expect.objectContaining({ writeOnly: true })
    )
    expect(otpMetadata).toEqual(expect.objectContaining({ writeOnly: true }))
  })
})
