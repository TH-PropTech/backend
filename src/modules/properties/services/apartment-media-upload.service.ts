import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'

import { StorageService } from '../../../common/storage/storage.service'

const APARTMENT_IMAGE_FOLDER = 'apartments'
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

@Injectable()
export class ApartmentMediaUploadService {
  private readonly logger = new Logger(ApartmentMediaUploadService.name)

  constructor(private readonly storage: StorageService) {}

  async uploadImages(files: Express.Multer.File[]): Promise<string[]> {
    if (files.length === 0) return []
    if (!this.storage.isConfigured) {
      this.logger.error('S3 is not configured (AWS_REGION/AWS_S3_BUCKET)')
      throw new ServiceUnavailableException(
        'Dịch vụ lưu trữ ảnh chưa được cấu hình'
      )
    }
    return Promise.all(files.map(file => this.uploadOne(file)))
  }

  private async uploadOne(file: Express.Multer.File): Promise<string> {
    const extension = EXTENSION_BY_MIME[file.mimetype] ?? 'jpg'
    const key = `${APARTMENT_IMAGE_FOLDER}/${randomUUID()}.${extension}`
    try {
      await this.storage.putObject({
        key,
        body: file.buffer,
        contentType: file.mimetype,
      })
    } catch (error) {
      this.logger.error(`S3 upload failed for ${file.originalname}`, error)
      throw new ServiceUnavailableException('Tải ảnh lên thất bại, thử lại sau')
    }
    return this.storage.publicUrl(key)
  }
}
