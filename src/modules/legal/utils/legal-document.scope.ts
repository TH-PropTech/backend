import type { FindOptionsWhere, Repository } from 'typeorm'
import type { ObjectId } from 'mongodb'
import type { LegalDocument } from '../schemas/legal-document.schema'

type Where = Record<string, unknown>
type Order = Record<string, 'ASC' | 'DESC'>

export interface LegalDocumentFindOptions {
  where?: Where
  order?: Order
}

/**
 * Repository facade cho MỘT `kind` của `LegalDocument` (G-LEG, D6).
 *
 * Có chữ ký gần như repository cũ (`find`, `findOne`, `findOneBy`, `count`,
 * `create`, `save`, `update`, `delete`, `remove`), nhưng:
 * - mọi truy vấn tự thêm `kind` vào `where` (không rò sang loại khác);
 * - mọi bản ghi ghi ra tự gắn `kind` của facade.
 * Service nhờ đó giữ nguyên logic; chỉ đổi nơi lưu.
 */
export class LegalDocumentScope<T extends LegalDocument> {
  constructor(
    private readonly repository: Repository<LegalDocument>,
    readonly kind: T['kind']
  ) {}

  find(options: LegalDocumentFindOptions = {}): Promise<T[]> {
    return this.repository.find({
      where: this.scoped(options.where),
      ...(options.order ? { order: options.order } : {}),
    }) as Promise<T[]>
  }

  findOne(options: LegalDocumentFindOptions = {}): Promise<T | null> {
    return this.repository.findOne({
      where: this.scoped(options.where),
      ...(options.order ? { order: options.order } : {}),
    }) as Promise<T | null>
  }

  findOneBy(where: Where = {}): Promise<T | null> {
    return this.repository.findOneBy(this.scoped(where)) as Promise<T | null>
  }

  /**
   * Mongo: `count(query)` nhận filter THÔ (không phải `{ where }`), nên dùng `countBy`.
   * Truyền `{ where }` vào `count` sẽ lọc theo trường `where` và luôn trả 0.
   */
  count(options: { where?: Where } = {}): Promise<number> {
    return this.countBy(options.where)
  }

  /** Đếm theo filter thô (đúng ngữ nghĩa `countBy` của repository). */
  countBy(where: Where = {}): Promise<number> {
    return this.repository.countBy(this.scoped(where))
  }

  create(data: Partial<T> | Where = {}): T {
    return this.repository.create({
      ...data,
      kind: this.kind,
    } as unknown as LegalDocument) as unknown as T
  }

  save(entity: T): Promise<T>
  save(entities: T[]): Promise<T[]>
  save(entity: T | T[]): Promise<T | T[]> {
    if (Array.isArray(entity)) {
      for (const item of entity) item.kind = this.kind
      return this.repository.save(entity)
    }
    entity.kind = this.kind
    return this.repository.save(entity)
  }

  update(id: ObjectId, patch: Where): Promise<unknown> {
    return this.repository.update(this.scoped({ _id: id }), patch)
  }

  delete(id: ObjectId): Promise<unknown> {
    return this.repository.delete(this.scoped({ _id: id }))
  }

  remove(entity: T): Promise<T> {
    return this.repository.remove(entity) as Promise<T>
  }

  private scoped(where: Where = {}): FindOptionsWhere<LegalDocument> {
    return { ...where, kind: this.kind }
  }
}
