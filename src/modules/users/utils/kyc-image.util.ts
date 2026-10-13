import { BadRequestException } from '@nestjs/common'

export const KYC_IMAGE_MAX_BYTES = 5 * 1024 * 1024

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff])
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])
const RIFF_SIGNATURE = Buffer.from([0x52, 0x49, 0x46, 0x46])
const WEBP_SIGNATURE = Buffer.from([0x57, 0x45, 0x42, 0x50])
const BMP_SIGNATURE = Buffer.from([0x42, 0x4d])

export function validateKycImage(file: Express.Multer.File): void {
  if (file.buffer.length === 0) {
    throw new BadRequestException('Ảnh KYC không được để trống')
  }
  if (file.buffer.length > KYC_IMAGE_MAX_BYTES) {
    throw new BadRequestException('Ảnh KYC không được vượt quá 5 MiB')
  }
  const detectedMimeType = detectImageMimeType(file.buffer)
  if (!detectedMimeType) {
    throw new BadRequestException('Ảnh KYC phải là JPEG, PNG hoặc WEBP hợp lệ')
  }
  file.mimetype = detectedMimeType
}

function detectImageMimeType(
  buffer: Buffer
): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/bmp' | null {
  if (buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) {
    return 'image/jpeg'
  }
  if (buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return 'image/png'
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).equals(RIFF_SIGNATURE) &&
    buffer.subarray(8, 12).equals(WEBP_SIGNATURE)
  ) {
    return 'image/webp'
  }
  if (buffer.subarray(0, BMP_SIGNATURE.length).equals(BMP_SIGNATURE)) {
    return 'image/bmp'
  }
  return null
}
