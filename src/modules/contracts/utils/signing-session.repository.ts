import type { Repository } from 'typeorm'
import type {
  SmartCaSigningSession,
  SmartCaSigningSessionKind,
} from '../schemas/smartca-signing-session.schema'

type Where = Record<string, unknown>

/**
 * Repository facade (D6) cho `smartca_signing_sessions` hợp nhất: giữ chữ ký như
 * repo cũ của từng loại (phiên SmartCA hoặc grant) nhưng tự cộng điều kiện `kind`
 * vào mọi truy vấn và khi tạo mới, nên service không phải nhớ lọc `kind`. `kind`
 * của caller không thể ghi đè. Logic service không đổi; chỉ đổi nơi lưu.
 */
export class KindScopedSmartCaSigningRepository<
  T extends object = SmartCaSigningSession,
> {
  constructor(
    private readonly repository: Repository<SmartCaSigningSession>,
    private readonly kind: SmartCaSigningSessionKind
  ) {}

  find(
    options: { where?: Where; order?: Record<string, 'ASC' | 'DESC'> } = {}
  ): Promise<T[]> {
    return this.repository.find({
      ...options,
      where: { ...options.where, kind: this.kind },
    }) as unknown as Promise<T[]>
  }

  findOne(options: { where?: Where } = {}): Promise<T | null> {
    return this.repository.findOne({
      ...options,
      where: { ...options.where, kind: this.kind },
    }) as unknown as Promise<T | null>
  }

  create(data: Partial<T>): T {
    const row = { ...(data as object), kind: this.kind }
    return this.repository.create(
      row as Partial<SmartCaSigningSession>
    ) as unknown as T
  }

  async save(entity: T): Promise<T> {
    this.assertKind(entity)
    return (await this.repository.save(
      entity as unknown as SmartCaSigningSession
    )) as unknown as T
  }

  async remove(entity: T): Promise<T> {
    this.assertKind(entity)
    return (await this.repository.remove(
      entity as unknown as SmartCaSigningSession
    )) as unknown as T
  }

  private assertKind(entity: T): void {
    const current = (entity as { kind?: SmartCaSigningSessionKind }).kind
    if (current !== undefined && current !== this.kind) {
      throw new Error(
        `smartca signing kind mismatch: expected ${this.kind}, got ${current}`
      )
    }
    ;(entity as { kind?: SmartCaSigningSessionKind }).kind = this.kind
  }
}
