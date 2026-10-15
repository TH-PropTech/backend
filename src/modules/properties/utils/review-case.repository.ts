import type { Repository } from 'typeorm'
import type { ReviewCase, ReviewCaseKind } from '../schemas/review-case.schema'

type Where = Record<string, unknown>

/**
 * Repository facade (D6): giữ chữ ký như repo cũ của từng hàng đợi nhưng
 * tự cộng điều kiện `kind` vào mọi truy vấn và khi tạo mới, nên service không
 * phải nhớ lọc `kind`. `kind` của caller không thể ghi đè.
 */
export class KindScopedReviewCaseRepository {
  constructor(
    private readonly repository: Repository<ReviewCase>,
    private readonly kind: ReviewCaseKind
  ) {}

  find(
    options: { where?: Where; order?: Record<string, 'ASC' | 'DESC'> } = {}
  ): Promise<ReviewCase[]> {
    return this.repository.find({
      ...options,
      where: { ...options.where, kind: this.kind },
    })
  }

  findOne(options: { where?: Where }): Promise<ReviewCase | null> {
    return this.repository.findOne({
      ...options,
      where: { ...options.where, kind: this.kind },
    })
  }

  create(data: Partial<ReviewCase>): ReviewCase {
    return this.repository.create({ ...data, kind: this.kind })
  }

  async save(entity: ReviewCase): Promise<ReviewCase> {
    if (entity.kind !== undefined && entity.kind !== this.kind) {
      throw new Error(
        `review case kind mismatch: expected ${this.kind}, got ${entity.kind}`
      )
    }
    entity.kind = this.kind
    return this.repository.save(entity)
  }
}
