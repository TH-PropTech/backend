import { validate } from 'class-validator'
import {
  CreateSmartCaSigningSessionDto,
  SmartCaSigningSessionDto,
} from './smartca-signing.dto'

describe('CreateSmartCaSigningSessionDto', () => {
  it('accepts a SmartCA v1 request without any credential field', async () => {
    const dto = Object.assign(new CreateSmartCaSigningSessionDto(), {
      idempotencyKey: 'request-1',
      certificateSerial: 'SERIAL-001',
    })

    await expect(validate(dto)).resolves.toEqual([])
  })

  it('accepts a request with no body at all (both fields optional)', async () => {
    const dto = new CreateSmartCaSigningSessionDto()

    await expect(validate(dto)).resolves.toEqual([])
  })

  it('does not declare smartCaPassword or smartCaOtp as request fields', () => {
    const dto = new CreateSmartCaSigningSessionDto()

    expect('smartCaPassword' in dto).toBe(false)
    expect('smartCaOtp' in dto).toBe(false)
  })
})

describe('SmartCaSigningSessionDto', () => {
  it('declares documentId as an API property for UI display of doc_id', () => {
    const metadata = Reflect.getMetadata(
      'swagger/apiModelProperties',
      SmartCaSigningSessionDto.prototype,
      'documentId'
    ) as unknown

    expect(metadata).toBeDefined()
  })
})
