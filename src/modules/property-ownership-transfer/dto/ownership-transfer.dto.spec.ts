import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import {
  ApplyOwnershipTransferDto,
  isValidOwnershipTransferIdempotencyKey,
  OWNERSHIP_TRANSFER_IDEMPOTENCY_KEY_MAX_LENGTH,
  PreviewOwnershipTransferDto,
} from './ownership-transfer.dto'

describe('ownership-transfer DTOs', () => {
  it('accepts and normalizes a bounded target email', async () => {
    const dto = plainToInstance(PreviewOwnershipTransferDto, {
      targetEmail: '  OWNER@Example.COM ',
    })

    const errors = await validate(dto)

    expect(errors).toHaveLength(0)
    expect(dto.targetEmail).toBe('owner@example.com')
  })

  it('rejects malformed target email and preview hash', async () => {
    const dto = plainToInstance(PreviewOwnershipTransferDto, {
      targetEmail: 'not-an-email',
    })
    const applyDto = plainToInstance(ApplyOwnershipTransferDto, {
      previewHash: 'not-a-sha256-hash',
    })

    expect(await validate(dto)).not.toHaveLength(0)
    expect(await validate(applyDto)).not.toHaveLength(0)
  })

  it('rejects an empty or oversized idempotency key', () => {
    expect(isValidOwnershipTransferIdempotencyKey('')).toBe(false)
    expect(
      isValidOwnershipTransferIdempotencyKey(
        'k'.repeat(OWNERSHIP_TRANSFER_IDEMPOTENCY_KEY_MAX_LENGTH + 1)
      )
    ).toBe(false)
    expect(isValidOwnershipTransferIdempotencyKey('request-1')).toBe(true)
  })

  it('rejects an oversized target email before account lookup', async () => {
    const dto = plainToInstance(PreviewOwnershipTransferDto, {
      targetEmail: `${'a'.repeat(250)}@example.com`,
    })

    expect(await validate(dto)).not.toHaveLength(0)
  })
})
