import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { v2 as cloudinary } from 'cloudinary'

const APARTMENT_IMAGE_FOLDER = 'apartments'

@Injectable()
export class ApartmentMediaUploadService {
  private readonly logger = new Logger(ApartmentMediaUploadService.name)

  constructor(private readonly configService: ConfigService) {}

  async uploadImages(files: Express.Multer.File[]): Promise<string[]> {
    if (files.length === 0) return []
    this.configureCloudinary()
    return Promise.all(files.map(file => this.uploadOne(file)))
  }

  private configureCloudinary(): void {
    const cloudName = this.configService.get<string>('cloudinary.cloudName')
    const apiKey = this.configService.get<string>('cloudinary.apiKey')
    const apiSecret = this.configService.get<string>('cloudinary.apiSecret')
    if (!cloudName || !apiKey || !apiSecret) {
      this.logger.error(
        'Cloudinary is not configured (CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET)'
      )
      throw new ServiceUnavailableException(
        'Dịch vụ lưu trữ ảnh chưa được cấu hình'
      )
    }
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    })
  }

  private uploadOne(file: Express.Multer.File): Promise<string> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: APARTMENT_IMAGE_FOLDER, resource_type: 'image' },
        (error, result) => {
          if (error || !result) {
            this.logger.error(
              `Cloudinary upload failed for ${file.originalname}`,
              error
            )
            reject(
              new ServiceUnavailableException(
                'Tải ảnh lên thất bại, thử lại sau'
              )
            )
            return
          }
          resolve(result.secure_url)
        }
      )
      stream.end(file.buffer)
    })
  }
}
