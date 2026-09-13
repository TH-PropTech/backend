import { BadRequestException } from '@nestjs/common'

import { validateKycImage } from './kyc-image.util'

function createFile(buffer: Buffer, mimetype: string): Express.Multer.File {
  return {
    fieldname: 'image',
    originalname: 'identity-image',
    encoding: '7bit',
    mimetype,
    size: buffer.length,
    buffer,
    destination: '',
    filename: '',
    path: '',
    stream: undefined as unknown as Express.Multer.File['stream'],
  }
}

describe('validateKycImage', () => {
  it('accepts JPEG bytes with a JPEG MIME type', () => {
    const file = createFile(Buffer.from([0xff, 0xd8, 0xff, 0xdb]), 'image/jpeg')

    expect(() => validateKycImage(file)).not.toThrow()
  })

  it('accepts PNG bytes with a PNG MIME type', () => {
    const file = createFile(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      'image/png'
    )

    expect(() => validateKycImage(file)).not.toThrow()
  })

  it('normalizes a mislabeled JPEG from its binary signature', () => {
    const file = createFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/png')

    validateKycImage(file)

    expect(file.mimetype).toBe('image/jpeg')
  })

  it('normalizes a mislabeled PNG from its binary signature', () => {
    const file = createFile(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      'image/jpeg'
    )

    validateKycImage(file)

    expect(file.mimetype).toBe('image/png')
  })

  it('accepts and normalizes WebP images', () => {
    const webpBuffer = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.alloc(4),
      Buffer.from('WEBP', 'ascii'),
    ])
    const file = createFile(webpBuffer, 'image/jpeg')

    validateKycImage(file)

    expect(file.mimetype).toBe('image/webp')
  })

  it('accepts and normalizes BMP images', () => {
    const bmpBuffer = Buffer.from([0x42, 0x4d, 0x00, 0x00])
    const file = createFile(bmpBuffer, 'image/jpeg')

    validateKycImage(file)

    expect(file.mimetype).toBe('image/bmp')
  })

  it('rejects an empty image', () => {
    const file = createFile(Buffer.alloc(0), 'image/jpeg')

    expect(() => validateKycImage(file)).toThrow(BadRequestException)
  })

  it('rejects bytes without a supported image signature', () => {
    const file = createFile(Buffer.from('not an image'), 'image/jpeg')

    expect(() => validateKycImage(file)).toThrow(BadRequestException)
  })

  it('rejects an image larger than five MiB', () => {
    const bytes = Buffer.alloc(5 * 1024 * 1024 + 1)
    bytes.set([0xff, 0xd8, 0xff])
    const file = createFile(bytes, 'image/jpeg')

    expect(() => validateKycImage(file)).toThrow(BadRequestException)
  })
})
