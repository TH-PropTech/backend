import { BadRequestException } from '@nestjs/common'
import type { Request } from 'express'

export const APARTMENT_IMAGE_MAX_COUNT = 10
export const APARTMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024

const ALLOWED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

export function apartmentImageFilter(
  _req: Request,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void
): void {
  if (ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
    callback(null, true)
    return
  }
  callback(
    new BadRequestException('Chỉ cho phép tải lên file ảnh (jpeg, png, webp)!'),
    false
  )
}
