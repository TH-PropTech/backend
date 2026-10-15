import type { FindOptionsWhere, MongoRepository, Repository } from 'typeorm'
import type {
  ActivityLog,
  ActivityLogKind,
} from '../schemas/activity-log.schema'

type Where = Record<string, unknown>

/** Trường do DB sinh khi ghi; được gán ngược vào object của caller sau save. */
const GENERATED_FIELDS = ['_id', 'createdAt', 'updatedAt'] as const

export interface KindScopedFindOptions {
  where?: Where
  order?: Record<string, 'ASC' | 'DESC'>
  take?: number
  skip?: number
}

/**
 * Repository facade (D6): giữ chữ ký như repo cũ của từng loại log nhưng
 * tự cộng điều kiện `kind` vào mọi truy vấn, tự gán `kind` khi ghi, và trả
 * về hình JSON cũ (qua `toLegacy`) nên service không phải nhớ lọc `kind`.
 * `kind` của caller không thể ghi đè.
 */
export class KindScopedActivityLogRepository<T extends object> {
  constructor(
    private readonly repository: Repository<ActivityLog>,
    private readonly kind: ActivityLogKind,
    private readonly toLegacy: (row: ActivityLog) => T
  ) {}

  async find(options: KindScopedFindOptions = {}): Promise<T[]> {
    const rows = await this.repository.find({
      ...options,
      where: this.scope(options.where),
    })
    return rows.map(row => this.toLegacy(row))
  }

  async findOne(options: { where?: Where } = {}): Promise<T | null> {
    const row = await this.repository.findOne({
      ...options,
      where: this.scope(options.where),
    })
    return row ? this.toLegacy(row) : null
  }

  /**
   * Mongo: `count(query)` nhận filter THÔ (không phải `{ where }`), nên dùng `countBy`.
   * Truyền `{ where }` vào `count` sẽ lọc theo trường `where` và luôn trả 0.
   */
  count(options: { where?: Where } = {}): Promise<number> {
    return this.repository.countBy(this.scope(options.where))
  }

  /** Object hình cũ, chưa ghi; `save` mới gán `kind`. */
  create(data: Partial<T>): T {
    return { ...data } as T
  }

  /**
   * Ghi (insert hoặc cập nhật theo `_id`) với `kind` của facade; chỉ ghi trường có giá trị.
   * Sau khi ghi, gán ngược `_id`/`createdAt`/`updatedAt` vào `entity` của caller (không thêm `kind`),
   * để lần save sau trên cùng object là UPDATE theo `_id` chứ không INSERT bản trùng.
   */
  async save(entity: T): Promise<T> {
    const saved = await this.repository.save(this.stamp(entity))
    this.adoptGenerated(saved, entity)
    return this.toLegacy(saved)
  }

  /** Ghi nhiều bản ghi trong một lượt (dùng cho seed theo lô); gán ngược trường sinh như `save`. */
  async saveAll(entities: Partial<T>[]): Promise<T[]> {
    const saved = await this.repository.save(
      entities.map(entity => this.stamp(entity))
    )
    saved.forEach((row, index) => {
      const entity = entities[index]
      if (entity) this.adoptGenerated(row, entity)
    })
    return saved.map(row => this.toLegacy(row))
  }

  async update(where: Where, data: Partial<T>): Promise<void> {
    // Cùng kiểu partial như repo cũ (đã kiểm ở caller); TypeORM nhận QueryDeepPartialEntity.
    await this.repository.update(this.scope(where), data)
  }

  /**
   * Cập nhật nguyên tử bằng toán tử Mongo (`$push`, `$set`, ...) trong phạm vi `kind`.
   * Điều kiện (kể cả trần số phần tử) nằm trong `where`. Trả số document khớp (0 = không khớp).
   * Không đọc-sửa-ghi cả document nên không đè các trường/mảng nhúng do lệnh khác ghi.
   */
  async updateAtomic(
    where: Where,
    update: Record<string, unknown>
  ): Promise<number> {
    const result = await (
      this.repository as unknown as MongoRepository<ActivityLog>
    ).updateOne(this.scope(where), update)
    return (result as unknown as { matchedCount: number }).matchedCount
  }

  /** Chép `_id`/`createdAt`/`updatedAt` do DB sinh từ `saved` vào `target` (object của caller). */
  private adoptGenerated(saved: ActivityLog, target: object): void {
    const from = saved as unknown as Record<string, unknown>
    const to = target as Record<string, unknown>
    for (const field of GENERATED_FIELDS) {
      if (from[field] !== undefined) to[field] = from[field]
    }
  }

  /** Hình ghi của TypeORM: kiểm `kind` (nếu có), gán `kind` của facade, bỏ trường `undefined`. */
  private stamp(entity: Partial<T>): ActivityLog {
    this.assertKind(entity)
    return Object.fromEntries(
      Object.entries({ ...entity, kind: this.kind }).filter(
        ([, value]) => value !== undefined
      )
    ) as unknown as ActivityLog
  }

  /** Ném lỗi khi entity mang `kind` khác của facade (không ghi đè im lặng), như các facade khác. */
  private assertKind(entity: Partial<T>): void {
    const current = (entity as { kind?: string | null }).kind
    if (current !== undefined && current !== this.kind) {
      throw new Error(
        `activity log kind mismatch: expected ${this.kind}, got ${String(current)}`
      )
    }
  }

  private scope(where?: Where): FindOptionsWhere<ActivityLog> {
    return { ...where, kind: this.kind }
  }
}
