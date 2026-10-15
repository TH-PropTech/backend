import type { Repository } from 'typeorm'
import type { Otp, OtpKind } from '../schemas/otp.schema'

type Where = Record<string, unknown>

/**
 * Repository facade (D6) cho bảng OTP hợp nhất: giữ chữ ký như repo cũ của
 * từng loại (EmailOtp / TransactionOtp) nhưng tự cộng điều kiện `kind` vào mọi
 * truy vấn và khi tạo mới, nên service không phải nhớ lọc `kind`. `kind` của
 * caller không thể ghi đè. Logic service không đổi; chỉ đổi nơi lưu.
 */
export class KindScopedOtpRepository<T extends Otp = Otp> {
  constructor(
    private readonly repository: Repository<Otp>,
    private readonly kind: OtpKind
  ) {}

  find(
    options: { where?: Where; order?: Record<string, 'ASC' | 'DESC'> } = {}
  ): Promise<T[]> {
    return this.repository.find({
      ...options,
      where: { ...options.where, kind: this.kind },
    }) as Promise<T[]>
  }

  findOne(options: { where?: Where } = {}): Promise<T | null> {
    return this.repository.findOne({
      ...options,
      where: { ...options.where, kind: this.kind },
    }) as Promise<T | null>
  }

  create(data: Partial<T>): T {
    const row: Partial<Otp> = { ...(data as Partial<Otp>), kind: this.kind }
    return this.repository.create(row) as T
  }

  async save(entity: T): Promise<T> {
    if (entity.kind !== undefined && entity.kind !== this.kind) {
      throw new Error(
        `otp kind mismatch: expected ${this.kind}, got ${entity.kind}`
      )
    }
    entity.kind = this.kind
    return await this.repository.save(entity)
  }
}
