import { Injectable } from '@nestjs/common'
import * as crypto from 'crypto'

@Injectable()
export class TotpService {
  /**
   * Giải mã chuỗi Base32 thành Buffer
   */
  private decodeBase32(base32: string): Buffer {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    const clean = base32.replace(/=+$/, '').toUpperCase()
    let bits = ''
    for (let i = 0; i < clean.length; i++) {
      const char = clean.charAt(i)
      const val = alphabet.indexOf(char)
      if (val === -1) {
        throw new Error('Ký tự Base32 không hợp lệ')
      }
      bits += val.toString(2).padStart(5, '0')
    }
    const bytes: number[] = []
    for (let i = 0; i < bits.length; i += 8) {
      const chunk = bits.substring(i, i + 8)
      if (chunk.length === 8) {
        bytes.push(parseInt(chunk, 2))
      }
    }
    return Buffer.from(bytes)
  }

  /**
   * Tạo chuỗi secret Base32 ngẫu nhiên
   */
  generateSecret(length = 16): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    const bytes = crypto.randomBytes(length)
    let secret = ''
    for (let i = 0; i < bytes.length; i++) {
      const byteVal = bytes[i]
      if (byteVal !== undefined) {
        secret += alphabet.charAt(byteVal % 32)
      }
    }
    return secret
  }

  /**
   * Tính toán mã OTP tại một mốc thời gian cụ thể (counter)
   */
  generateToken(secret: string, timeStep = 30): string {
    const key = this.decodeBase32(secret)
    // Chia thời gian hiện tại cho timeStep (30s) để lấy giá trị counter
    const counter = Math.floor(Date.now() / 1000 / timeStep)
    const buffer = Buffer.alloc(8)
    buffer.writeBigInt64BE(BigInt(counter), 0)

    // Tạo HMAC-SHA1
    const hmac = crypto.createHmac('sha1', key)
    hmac.update(buffer)
    const hmacResult = hmac.digest()

    // Lấy offset (4 bit cuối của byte cuối cùng)
    const lastByte = hmacResult.readUInt8(hmacResult.length - 1)
    const offset = lastByte & 0xf

    // Lấy 4 byte liên tiếp bắt đầu từ offset
    const b0 = hmacResult.readUInt8(offset) & 0x7f
    const b1 = hmacResult.readUInt8(offset + 1)
    const b2 = hmacResult.readUInt8(offset + 2)
    const b3 = hmacResult.readUInt8(offset + 3)
    const codeBinary = (b0 << 24) | (b1 << 16) | (b2 << 8) | b3

    // Lấy 6 chữ số cuối
    const otp = codeBinary % 1000000
    return otp.toString().padStart(6, '0')
  }

  /**
   * Xác thực mã OTP trong một khoảng sai lệch thời gian (window) cho phép
   */
  verifyToken(
    secret: string,
    token: string,
    window = 1,
    timeStep = 30
  ): boolean {
    const key = this.decodeBase32(secret)
    const counter = Math.floor(Date.now() / 1000 / timeStep)

    for (let i = -window; i <= window; i++) {
      const currentCounter = counter + i
      const buffer = Buffer.alloc(8)
      buffer.writeBigInt64BE(BigInt(currentCounter), 0)

      const hmac = crypto.createHmac('sha1', key)
      hmac.update(buffer)
      const hmacResult = hmac.digest()

      const lastByte = hmacResult.readUInt8(hmacResult.length - 1)
      const offset = lastByte & 0xf
      const b0 = hmacResult.readUInt8(offset) & 0x7f
      const b1 = hmacResult.readUInt8(offset + 1)
      const b2 = hmacResult.readUInt8(offset + 2)
      const b3 = hmacResult.readUInt8(offset + 3)
      const codeBinary = (b0 << 24) | (b1 << 16) | (b2 << 8) | b3

      const otp = codeBinary % 1000000
      if (otp.toString().padStart(6, '0') === token) {
        return true
      }
    }
    return false
  }
}
