import { ObjectId } from 'mongodb'

/**
 * Repository giả lập trong bộ nhớ cho test G-LEG (`legal_documents`): tập con
 * toán tử dùng bởi `LegalDocumentScope` (so sánh bằng, `$in`, sắp xếp một trường).
 * Cố ý KHÔNG tự thêm `kind`: test kiểm `where` có `kind` do facade gắn vào.
 * Chỉ dùng trong test.
 */
export type LegalDocumentRow = Record<string, unknown> & { _id: ObjectId }

type Where = Record<string, unknown>

function equal(left: unknown, right: unknown): boolean {
  if (left instanceof ObjectId && right instanceof ObjectId) {
    return left.equals(right)
  }
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime()
  }
  return left === right
}

function matches(row: LegalDocumentRow, where: Where | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([field, condition]) => {
    if (condition === undefined) return true
    if (
      condition !== null &&
      typeof condition === 'object' &&
      !(condition instanceof ObjectId) &&
      '$in' in condition
    ) {
      // Mongo: `null` trong $in cũng khớp trường vắng mặt.
      return (condition as { $in: unknown[] }).$in.some(item =>
        item === null ? row[field] == null : equal(row[field], item)
      )
    }
    return equal(row[field], condition)
  })
}

function clone(row: LegalDocumentRow): LegalDocumentRow {
  return { ...row }
}

export class LegalDocumentMemoryRepository {
  rows: LegalDocumentRow[] = []

  seed(rows: Array<Record<string, unknown>>): this {
    for (const row of rows) {
      this.rows.push({ _id: new ObjectId(), ...row })
    }
    return this
  }

  find(
    options: { where?: Where; order?: Record<string, 'ASC' | 'DESC'> } = {}
  ): Promise<LegalDocumentRow[]> {
    const found = this.rows
      .filter(row => matches(row, options.where))
      .map(clone)
    const [field, direction] = Object.entries(options.order ?? {})[0] ?? []
    if (field) {
      const sign = direction === 'DESC' ? -1 : 1
      found.sort((a, b) => sign * compare(a[field], b[field]))
    }
    return Promise.resolve(found)
  }

  findOne(
    options: { where?: Where; order?: Record<string, 'ASC' | 'DESC'> } = {}
  ): Promise<LegalDocumentRow | null> {
    return this.find(options).then(rows => rows[0] ?? null)
  }

  countBy(where: Where): Promise<number> {
    return Promise.resolve(this.rows.filter(row => matches(row, where)).length)
  }

  findOneBy(where: Where): Promise<LegalDocumentRow | null> {
    return this.findOne({ where })
  }

  /** Mongo: `count(query)` nhận filter thô; `count({ where })` là lỗi đã biết, dùng `countBy`. */
  count(): Promise<number> {
    return Promise.reject(
      new Error('LegalDocumentMemoryRepository.count: dùng countBy(where)')
    )
  }

  create(data: Where): LegalDocumentRow {
    return { ...data } as LegalDocumentRow
  }

  save(entity: Where): Promise<LegalDocumentRow>
  save(entities: Where[]): Promise<LegalDocumentRow[]>
  save(
    entity: Where | Where[]
  ): Promise<LegalDocumentRow | LegalDocumentRow[]> {
    if (Array.isArray(entity)) {
      return Promise.resolve(entity.map(item => this.saveOne(item)))
    }
    return Promise.resolve(this.saveOne(entity))
  }

  update(criteria: Where | ObjectId, patch: Where): Promise<void> {
    for (const row of this.rows) {
      if (matchesCriteria(row, criteria)) Object.assign(row, patch)
    }
    return Promise.resolve()
  }

  /** Tập con của Mongo `updateOne`: `$set`/`$unset`, trả `matchedCount`. */
  updateOne(
    criteria: Where,
    update: { $set?: Where; $unset?: Where }
  ): Promise<{ matchedCount: number }> {
    const row = this.rows.find(item => matches(item, criteria))
    if (!row) return Promise.resolve({ matchedCount: 0 })
    Object.assign(row, update.$set ?? {})
    for (const field of Object.keys(update.$unset ?? {})) delete row[field]
    return Promise.resolve({ matchedCount: 1 })
  }

  delete(criteria: Where | ObjectId): Promise<void> {
    this.rows = this.rows.filter(row => !matchesCriteria(row, criteria))
    return Promise.resolve()
  }

  remove(entity: Where): Promise<LegalDocumentRow> {
    this.rows = this.rows.filter(row => !equal(row._id, entity['_id']))
    return Promise.resolve(entity as LegalDocumentRow)
  }

  private saveOne(entity: Where): LegalDocumentRow {
    const _id = (entity['_id'] as ObjectId | undefined) ?? new ObjectId()
    const saved = {
      ...entity,
      _id,
      createdAt: entity['createdAt'] ?? new Date(),
      updatedAt: new Date(),
    } as LegalDocumentRow
    const index = this.rows.findIndex(row => equal(row._id, _id))
    if (index >= 0) this.rows[index] = saved
    else this.rows.push(saved)
    return clone(saved)
  }
}

function matchesCriteria(
  row: LegalDocumentRow,
  criteria: Where | ObjectId
): boolean {
  if (criteria instanceof ObjectId) return equal(row._id, criteria)
  return matches(row, criteria)
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === undefined || a === null) return 1
  if (b === undefined || b === null) return -1
  return (a as number | string) < (b as number | string) ? -1 : 1
}
