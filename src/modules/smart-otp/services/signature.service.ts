import { Injectable, Logger } from '@nestjs/common'
import * as crypto from 'crypto'

@Injectable()
export class SignatureService {
  private readonly logger = new Logger(SignatureService.name)

  /**
   * Xác thực chữ ký số được gửi lên từ thiết bị mobile
   * @param publicKeyPem Khóa công khai của thiết bị ở định dạng PEM
   * @param data Dữ liệu gốc cần ký (ví dụ: challenge string)
   * @param signatureBase64 Chữ ký số mã hóa ở định dạng Base64
   */
  verifySignature(
    publicKeyPem: string,
    data: string,
    signatureBase64: string
  ): boolean {
    try {
      const verify = crypto.createVerify('SHA256')
      verify.update(data)
      verify.end()

      // Chuyển signature từ base64 sang Buffer để xác thực
      const signatureBuffer = Buffer.from(signatureBase64, 'base64')
      return verify.verify(publicKeyPem, signatureBuffer)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      this.logger.error(`Lỗi trong quá trình xác thực chữ ký: ${errMsg}`)
      return false
    }
  }
}
