import 'reflect-metadata'
import { BadRequestException, ValidationPipe } from '@nestjs/common'
import {
  AmendmentActionDto,
  CreateContractAmendmentDto,
  UpdateContractAmendmentDto,
} from './contract-amendment.dto'

// Cùng cấu hình với pipe toàn cục trong utils/setup-app.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
})
const parse = (metatype: new () => object, body: unknown): Promise<unknown> =>
  pipe.transform(body, { type: 'body', metatype })

const VALID = {
  changes: [{ field: 'monthlyRent', after: 17_000_000 }],
  effectiveFrom: '2030-01-01T00:00:00.000Z',
}

describe('contract amendment DTOs (global ValidationPipe)', () => {
  it('accepts a valid create body and keeps the nested changes', async () => {
    const result = (await parse(
      CreateContractAmendmentDto,
      VALID
    )) as CreateContractAmendmentDto

    expect(result).toBeInstanceOf(CreateContractAmendmentDto)
    expect(result.changes).toEqual([
      { field: 'monthlyRent', after: 17_000_000 },
    ])
  })

  it('accepts a customClauses change with a text value', async () => {
    await expect(
      parse(CreateContractAmendmentDto, {
        ...VALID,
        changes: [{ field: 'customClauses', after: 'Không nuôi thú cưng.' }],
      })
    ).resolves.toBeInstanceOf(CreateContractAmendmentDto)
  })

  it('accepts several changes and an idempotency key', async () => {
    await expect(
      parse(CreateContractAmendmentDto, {
        ...VALID,
        idempotencyKey: 'key-1',
        changes: [
          { field: 'monthlyRent', after: 18_000_000 },
          { field: 'paymentDay', after: 10 },
        ],
      })
    ).resolves.toBeInstanceOf(CreateContractAmendmentDto)
  })

  it.each([
    ['missing changes', { effectiveFrom: VALID.effectiveFrom }],
    ['empty changes', { ...VALID, changes: [] }],
    ['changes is not an array', { ...VALID, changes: 'monthlyRent' }],
    ['change without field', { ...VALID, changes: [{ after: 1 }] }],
    ['change with blank field', { ...VALID, changes: [{ field: '' }] }],
    [
      'change with unknown property',
      { ...VALID, changes: [{ field: 'monthlyRent', after: 1, extra: true }] },
    ],
    ['unknown top-level property', { ...VALID, status: 'effective' }],
    ['invalid effectiveFrom', { ...VALID, effectiveFrom: '01/01/2030' }],
  ])('rejects %s with 400', async (_name, body) => {
    await expect(
      parse(CreateContractAmendmentDto, body)
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('requires expectedRevision on update', async () => {
    await expect(
      parse(UpdateContractAmendmentDto, { ...VALID, expectedRevision: 2 })
    ).resolves.toBeInstanceOf(UpdateContractAmendmentDto)
    await expect(
      parse(UpdateContractAmendmentDto, VALID)
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('AmendmentActionDto from multipart form fields', () => {
  it('converts a string expectedRevision to a number', async () => {
    const result = (await parse(AmendmentActionDto, {
      expectedRevision: '1',
    })) as AmendmentActionDto

    expect(result.expectedRevision).toBe(1)
  })

  it('rejects a non-numeric expectedRevision', async () => {
    await expect(
      parse(AmendmentActionDto, { expectedRevision: 'abc' })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('still rejects a negative revision', async () => {
    await expect(
      parse(AmendmentActionDto, { expectedRevision: '-1' })
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
