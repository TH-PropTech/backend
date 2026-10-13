import { BadRequestException } from '@nestjs/common'
import {
  APARTMENT_IMAGE_MAX_BYTES,
  APARTMENT_IMAGE_MAX_COUNT,
  apartmentImageFilter,
} from './apartment-upload.options'

function runFilter(mimetype: string): {
  error: Error | null
  accepted: boolean | undefined
} {
  let result: { error: Error | null; accepted: boolean | undefined } = {
    error: null,
    accepted: undefined,
  }
  apartmentImageFilter(
    {} as never,
    { mimetype } as Express.Multer.File,
    (error, accepted) => {
      result = { error, accepted }
    }
  )
  return result
}

describe('apartment upload options', () => {
  it('matches the design limits: 10 images of 5MB', () => {
    expect(APARTMENT_IMAGE_MAX_COUNT).toBe(10)
    expect(APARTMENT_IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024)
  })

  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', mimetype => {
    expect(runFilter(mimetype)).toEqual({ error: null, accepted: true })
  })

  it.each(['image/gif', 'image/svg+xml', 'application/pdf', 'text/html', ''])(
    'rejects "%s"',
    mimetype => {
      const { error, accepted } = runFilter(mimetype)

      expect(error).toBeInstanceOf(BadRequestException)
      expect(accepted).toBe(false)
    }
  )
})
