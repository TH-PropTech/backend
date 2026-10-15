import { ObjectId } from 'mongodb'

type Row = Record<string, unknown> & { _id?: ObjectId }
type Where = Record<string, unknown>

function sameValue(stored: unknown, expected: unknown): boolean {
  if (expected instanceof ObjectId) {
    return stored instanceof ObjectId && stored.equals(expected)
  }
  return stored === expected
}

/**
 * Repository giả lập trong bộ nhớ cho spec OTP: lọc `where` theo từng khóa như
 * Mongo (so khớp bằng, không toán tử), lưu bản sao để mô phỏng việc
 * `save` ghi lại toàn bộ document. Dùng chung cho spec facade và service OTP.
 */
export class InMemoryOtpRepository {
  rows: Row[] = []

  seed(row: object): Row {
    const copy = { ...row } as Row
    this.rows.push(copy)
    return copy
  }

  /** Bản ghi đầu tiên; ném lỗi nếu rỗng (tránh `undefined` khi kiểm tra). */
  first(): Row {
    const row = this.rows[0]
    if (!row) throw new Error('no rows in store')
    return row
  }

  private matches(row: Row, where: Where = {}): boolean {
    return Object.entries(where).every(([key, value]) =>
      sameValue(row[key], value)
    )
  }

  find(options: { where?: Where } = {}): Promise<Row[]> {
    return Promise.resolve(
      this.rows
        .filter(row => this.matches(row, options.where))
        .map(row => ({ ...row }))
    )
  }

  findOne(options: { where?: Where } = {}): Promise<Row | null> {
    const found = this.rows.find(row => this.matches(row, options.where))
    return Promise.resolve(found ? { ...found } : null)
  }

  create(data: Row): Row {
    return { ...data }
  }

  save(entity: Row): Promise<Row> {
    if (!entity._id) {
      entity._id = new ObjectId()
    }
    const copy = { ...entity }
    const index = this.rows.findIndex(row => sameValue(row._id, entity._id))
    if (index >= 0) {
      this.rows[index] = copy
    } else {
      this.rows.push(copy)
    }
    return Promise.resolve({ ...entity })
  }
}
