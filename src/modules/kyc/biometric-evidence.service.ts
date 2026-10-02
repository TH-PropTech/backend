import {
  Injectable,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { createHash, randomBytes } from 'crypto'
import { BiometricEvidence } from './schemas/biometric-evidence.schema'

export interface IssueBiometricEvidenceInput {
  userId: string
  role: 'tenant' | 'landlord'
  contractId: string
  contentLockedHash: string
}

@Injectable()
export class BiometricEvidenceService {
  private readonly defaultTtlMs = 5 * 60 * 1000 // 5 phút

  constructor(
    @InjectRepository(BiometricEvidence)
    private readonly evidenceRepository: Repository<BiometricEvidence>
  ) {}

  /**
   * Cấp bằng chứng sinh trắc học sau khi face match + liveness thành công
   */
  async issueEvidence(
    input: IssueBiometricEvidenceInput,
    ttlMs: number = this.defaultTtlMs
  ): Promise<{ evidenceId: string; expiresAt: Date }> {
    if (!input.userId || !input.contractId || !input.contentLockedHash) {
      throw new BadRequestException('INVALID_BIOMETRIC_EVIDENCE_INPUT')
    }

    const token = `bio_${randomBytes(32).toString('hex')}`
    const tokenHash = this.hashToken(token)
    const expiresAt = new Date(Date.now() + ttlMs)

    const record = this.evidenceRepository.create({
      tokenHash,
      userId: input.userId,
      role: input.role,
      contractId: input.contractId,
      contentLockedHash: input.contentLockedHash,
      status: 'verified',
      expiresAt,
      consumedAt: null,
    })

    await this.evidenceRepository.save(record)

    return {
      evidenceId: token,
      expiresAt,
    }
  }

  /**
   * Xác thực và tiêu thụ bằng chứng sinh trắc học một lần duy nhất
   */
  async consumeEvidence(
    evidenceId: string,
    expected: {
      userId: string
      role: 'tenant' | 'landlord'
      contractId: string
      contentLockedHash: string
    }
  ): Promise<{ valid: boolean; message?: string }> {
    if (!evidenceId) {
      throw new UnprocessableEntityException('BIOMETRIC_EVIDENCE_REQUIRED')
    }

    const tokenHash = this.hashToken(evidenceId)
    const record = await this.evidenceRepository.findOne({
      where: { tokenHash },
    })

    if (!record) {
      return {
        valid: false,
        message: 'Bằng chứng sinh trắc học không tồn tại hoặc không hợp lệ',
      }
    }

    if (record.status === 'consumed') {
      return {
        valid: false,
        message: 'Bằng chứng sinh trắc học đã được sử dụng trước đó (Replay)',
      }
    }

    if (record.status !== 'verified') {
      return {
        valid: false,
        message: 'Bằng chứng sinh trắc học không còn hiệu lực',
      }
    }

    if (new Date() > record.expiresAt) {
      record.status = 'expired'
      await this.evidenceRepository.save(record)
      return {
        valid: false,
        message: 'Bằng chứng sinh trắc học đã hết hạn (quá 5 phút)',
      }
    }

    if (record.userId !== expected.userId) {
      return {
        valid: false,
        message: 'Bằng chứng sinh trắc học không thuộc về tài khoản này',
      }
    }

    if (record.role !== expected.role) {
      return {
        valid: false,
        message: 'Vai trò người ký không khớp với bằng chứng sinh trắc học',
      }
    }

    if (record.contractId !== expected.contractId) {
      return {
        valid: false,
        message: 'Hợp đồng không khớp với bằng chứng sinh trắc học',
      }
    }

    if (record.contentLockedHash !== expected.contentLockedHash) {
      return {
        valid: false,
        message: 'Nội dung hợp đồng đã thay đổi sau khi xác thực sinh trắc học',
      }
    }

    // Tiêu thụ thành công
    record.status = 'consumed'
    record.consumedAt = new Date()
    await this.evidenceRepository.save(record)

    return { valid: true }
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }
}
