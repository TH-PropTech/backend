import { ObjectId } from 'mongodb'

type Doc = Record<string, unknown>

/**
 * Fake `activity_logs` trong bộ nhớ cho spec: thực thi insert/update theo `_id`,
 * `updateOne` với `$push`/`$set`, điều kiện `{ $exists }` và đường dẫn có dấu chấm
 * (ví dụ `messages.499`). Các lệnh chạy đồng bộ trong một lần gọi nên mỗi
 * `updateOne` là nguyên tử; `findOne` trả bản sao (snapshot) như DB thật.
 */
export class ActivityLogMemoryRepository {
  readonly docs: Doc[] = []

  /** Chèn trực tiếp (không qua save) để chuẩn bị dữ liệu cho test. */
  seed(doc: Doc): Doc {
    const stored = { _id: new ObjectId(), createdAt: new Date(), ...doc }
    this.docs.push(stored)
    return stored
  }

  save(input: Doc): Promise<Doc> {
    const existing = input._id
      ? this.docs.find(doc => sameValue(doc._id, input._id))
      : undefined
    if (existing) {
      Object.assign(existing, clone(input), { updatedAt: new Date() })
      return Promise.resolve(clone(existing))
    }
    const stored = {
      _id: new ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...clone(input),
    }
    this.docs.push(stored)
    return Promise.resolve(clone(stored))
  }

  find(options: { where?: Doc } = {}): Promise<Doc[]> {
    return Promise.resolve(
      this.docs.filter(doc => matches(doc, options.where ?? {})).map(clone)
    )
  }

  findOne(options: { where?: Doc } = {}): Promise<Doc | null> {
    const doc = this.docs.find(row => matches(row, options.where ?? {}))
    return Promise.resolve(doc ? clone(doc) : null)
  }

  countBy(filter: Doc): Promise<number> {
    return Promise.resolve(this.docs.filter(doc => matches(doc, filter)).length)
  }

  update(filter: Doc, data: Doc): Promise<void> {
    for (const doc of this.docs.filter(row => matches(row, filter))) {
      Object.assign(doc, clone(data), { updatedAt: new Date() })
    }
    return Promise.resolve()
  }

  updateOne(
    filter: Doc,
    update: Record<string, Record<string, unknown>>
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    const doc = this.docs.find(row => matches(row, filter))
    if (!doc) return Promise.resolve({ matchedCount: 0, modifiedCount: 0 })

    for (const [operator, fields] of Object.entries(update)) {
      for (const [path, value] of Object.entries(fields)) {
        if (operator === '$push') {
          const current = getPath(doc, path)
          const list = Array.isArray(current) ? current : []
          list.push(clone(value))
          setPath(doc, path, list)
        } else if (operator === '$set') {
          setPath(doc, path, clone(value))
        } else {
          throw new Error(`Fake không hỗ trợ toán tử ${operator}`)
        }
      }
    }
    doc.updatedAt = new Date()
    return Promise.resolve({ matchedCount: 1, modifiedCount: 1 })
  }
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([path, expected]) => {
    const actual = getPath(doc, path)
    if (isExistsOperator(expected)) {
      return (actual !== undefined) === expected.$exists
    }
    return sameValue(actual, expected)
  })
}

function isExistsOperator(value: unknown): value is { $exists: boolean } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof ObjectId) &&
    '$exists' in value
  )
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) {
    return a.toHexString() === b.toHexString()
  }
  return a === b
}

function getPath(doc: Doc, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (cur, key) =>
        cur === null || cur === undefined
          ? undefined
          : (cur as Record<string, unknown>)[key],
      doc
    )
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const keys = path.split('.')
  const last = keys.pop() as string
  let cur = doc
  for (const key of keys) {
    if (cur[key] === undefined || cur[key] === null) cur[key] = {}
    cur = cur[key] as Doc
  }
  cur[last] = value
}

/** Sao chép sâu kiểu JSON nhưng giữ nguyên ObjectId/Date (để snapshot không dùng chung tham chiếu). */
function clone<T>(value: T): T {
  if (Array.isArray(value))
    return (value as unknown[]).map(item => clone(item)) as T
  if (value instanceof Date || value instanceof ObjectId) return value
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clone(item)])
    ) as T
  }
  return value
}
