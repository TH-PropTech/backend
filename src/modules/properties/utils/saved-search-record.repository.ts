import type {
  DeepPartial,
  FindManyOptions,
  FindOneOptions,
  FindOptionsWhere,
  Repository,
} from 'typeorm'
import type {
  SavedSearchRecord,
  SavedSearchRecordKind,
} from '../schemas/saved-search-record.schema'

/**
 * Lớp che (facade) có chữ ký như `Repository` cũ của từng entity G-SAV, nhưng mọi
 * truy vấn tự thêm `kind` vào `where` và mọi bản ghi tạo mới mang `kind` này.
 * `save` từ chối bản ghi có kind khác để một search không bị ghi thành alert (và ngược lại);
 * bản ghi chưa có kind được gán kind của facade.
 */
export class SavedSearchRecordRepository {
  constructor(
    private readonly repository: Repository<SavedSearchRecord>,
    readonly kind: SavedSearchRecordKind
  ) {}

  find(
    options: FindManyOptions<SavedSearchRecord> = {}
  ): Promise<SavedSearchRecord[]> {
    return this.repository.find(this.scope(options))
  }

  findOne(
    options: FindOneOptions<SavedSearchRecord>
  ): Promise<SavedSearchRecord | null> {
    return this.repository.findOne(this.scope(options))
  }

  create(data: DeepPartial<SavedSearchRecord>): SavedSearchRecord {
    return this.repository.create({ ...data, kind: this.kind })
  }

  save<T extends SavedSearchRecord | SavedSearchRecord[]>(
    value: T
  ): Promise<T> {
    const list: SavedSearchRecord[] = Array.isArray(value) ? value : [value]
    // Bản ghi thiếu kind (dữ liệu/tạo tay) được gán kind của facade; kind khác thì từ chối cả lô.
    for (const record of list) {
      if (record.kind !== undefined && record.kind !== this.kind) {
        throw new Error(
          `SavedSearchRecord kind mismatch: expected ${this.kind}, got ${String(record.kind)}`
        )
      }
    }
    for (const record of list) {
      record.kind = this.kind
    }
    return this.repository.save(value as SavedSearchRecord) as Promise<T>
  }

  remove(record: SavedSearchRecord): Promise<SavedSearchRecord> {
    return this.repository.remove(record)
  }

  private scope<O extends { where?: unknown }>(options: O): O {
    const where = (options.where ?? {}) as FindOptionsWhere<SavedSearchRecord>
    return { ...options, where: { ...where, kind: this.kind } }
  }
}
