import type { FindManyOptions, Repository } from 'typeorm'
import type {
  ContractTemplate,
  ContractTemplateEntityKind,
} from '../schemas/contract-template.schema'

type Where = Record<string, unknown>

/**
 * Template cũ chưa có `kind` (trước migration 025) vẫn được hiểu là template,
 * nên bộ lọc kind='template' phải bắt cả bản ghi thiếu trường.
 */
const TEMPLATE_KIND_FILTER = { $in: ['template', null] }

/**
 * Repository facade (G-LAY, D6): giữ chữ ký như repo cũ của `ContractTemplate`
 * và `ContractLayoutProfile`, nhưng tự cộng điều kiện `kind` vào mọi truy vấn và
 * khi tạo mới, nên service không phải nhớ lọc `kind`. `kind` của caller không thể
 * ghi đè bằng `where`; bản ghi thuộc kind khác bị từ chối khi `save`/`remove`.
 */
export class ContractTemplateKindRepository {
  constructor(
    private readonly repository: Repository<ContractTemplate>,
    private readonly kind: ContractTemplateEntityKind
  ) {}

  private get kindFilter(): unknown {
    return this.kind === 'template' ? TEMPLATE_KIND_FILTER : this.kind
  }

  private assertKind(entity: ContractTemplate): void {
    if (entity.kind !== undefined && !this.matchesKind(entity.kind)) {
      throw new Error(
        `contract template kind mismatch: expected ${this.kind}, got ${String(entity.kind)}`
      )
    }
  }

  private matchesKind(kind: unknown): boolean {
    return kind === this.kind || (this.kind === 'template' && kind == null)
  }

  find(
    options: {
      where?: Where
      order?: Record<string, 'ASC' | 'DESC'>
    } = {}
  ): Promise<ContractTemplate[]> {
    return this.repository.find({
      ...options,
      where: { ...options.where, kind: this.kindFilter },
    } as FindManyOptions<ContractTemplate>)
  }

  findOne(options: {
    where?: Where
    order?: Record<string, 'ASC' | 'DESC'>
  }): Promise<ContractTemplate | null> {
    return this.repository.findOne({
      ...options,
      where: { ...options.where, kind: this.kindFilter },
    } as FindManyOptions<ContractTemplate>)
  }

  create(data: Partial<ContractTemplate>): ContractTemplate {
    return this.repository.create({ ...data, kind: this.kind })
  }

  async save(entity: ContractTemplate): Promise<ContractTemplate> {
    this.assertKind(entity)
    entity.kind = this.kind
    return this.repository.save(entity)
  }

  async remove(entity: ContractTemplate): Promise<ContractTemplate> {
    this.assertKind(entity)
    return this.repository.remove(entity)
  }
}
