import { ObjectId } from 'mongodb'

/**
 * Repository giả lập trong bộ nhớ cho test: hỗ trợ tập con toán tử Mongo mà các
 * query PROP-399 (audit center, reconciliation) dùng: so sánh bằng, $ne/$gt/$gte/$lt/$lte/$in/
 * $exists, $and/$or và đường dẫn có dấu chấm. Chỉ dùng trong test.
 */
type Row = Record<string, unknown>

function comparable(value: unknown): number | string | null {
  if (value instanceof Date) return value.getTime()
  if (value instanceof ObjectId) return value.toHexString()
  if (typeof value === 'number' || typeof value === 'string') return value
  return null
}

function getPath(row: Row, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === 'object'
          ? (current as Row)[key]
          : undefined,
      row
    )
}

function equals(left: unknown, right: unknown): boolean {
  if (left instanceof ObjectId && right instanceof ObjectId) {
    return left.equals(right)
  }
  const a = comparable(left)
  const b = comparable(right)
  if (a !== null && b !== null) return a === b
  return (left ?? null) === (right ?? null)
}

function matchesCondition(actual: unknown, condition: unknown): boolean {
  const isOperatorObject =
    condition !== null &&
    typeof condition === 'object' &&
    !(condition instanceof Date) &&
    !(condition instanceof ObjectId) &&
    Object.keys(condition).some(key => key.startsWith('$'))
  if (!isOperatorObject) return equals(actual, condition)

  return Object.entries(condition as Row).every(([operator, expected]) => {
    switch (operator) {
      case '$ne':
        return !equals(actual, expected)
      case '$in':
        return (expected as unknown[]).some(item => equals(actual, item))
      case '$regex': {
        const flags = (condition as Row)['$options']
        return (
          typeof actual === 'string' &&
          new RegExp(
            String(expected),
            typeof flags === 'string' ? flags : ''
          ).test(actual)
        )
      }
      case '$options':
        return true
      case '$exists':
        return (actual !== undefined) === Boolean(expected)
      case '$gt':
      case '$gte':
      case '$lt':
      case '$lte': {
        const a = comparable(actual)
        const b = comparable(expected)
        if (a === null || b === null) return false
        if (operator === '$gt') return a > b
        if (operator === '$gte') return a >= b
        if (operator === '$lt') return a < b
        return a <= b
      }
      default:
        throw new Error(`unsupported operator ${operator}`)
    }
  })
}

export function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, condition]) => {
    if (key === '$and') {
      return (condition as Row[]).every(clause => matchesWhere(row, clause))
    }
    if (key === '$or') {
      return (condition as Row[]).some(clause => matchesWhere(row, clause))
    }
    return matchesCondition(getPath(row, key), condition)
  })
}

type FindOptions = {
  where?: Row
  order?: Record<string, 'ASC' | 'DESC'>
  skip?: number
  take?: number
}

export function memoryRepository<T extends Row>(
  rows: T[]
): {
  rows: T[]
  find: jest.Mock
  findOne: jest.Mock
  findAndCount: jest.Mock
  count: jest.Mock
  create: jest.Mock
  save: jest.Mock
  update: jest.Mock
} {
  const select = (options: FindOptions = {}): T[] => {
    let result = rows.filter(row => matchesWhere(row, options.where))
    const [orderKey, direction] = Object.entries(options.order ?? {})[0] ?? []
    if (orderKey) {
      result = [...result].sort((a, b) => {
        const left = comparable(getPath(a, orderKey)) ?? 0
        const right = comparable(getPath(b, orderKey)) ?? 0
        const order = left < right ? -1 : left > right ? 1 : 0
        return direction === 'DESC' ? -order : order
      })
    }
    const skip = options.skip ?? 0
    return options.take === undefined
      ? result.slice(skip)
      : result.slice(skip, skip + options.take)
  }

  return {
    rows,
    find: jest.fn((options?: FindOptions) => Promise.resolve(select(options))),
    findOne: jest.fn((options?: FindOptions) =>
      Promise.resolve(select(options)[0] ?? null)
    ),
    findAndCount: jest.fn((options?: FindOptions) => {
      const total = rows.filter(row => matchesWhere(row, options?.where)).length
      return Promise.resolve([select(options), total] as [T[], number])
    }),
    // Như MongoRepository.count: nhận thẳng bộ lọc, không bọc trong { where }.
    count: jest.fn((query?: FindOptions['where']) =>
      Promise.resolve(rows.filter(row => matchesWhere(row, query)).length)
    ),
    create: jest.fn((value: Partial<T>): T => ({ ...value }) as T),
    save: jest.fn((value: T): Promise<T> => {
      if (!(value as Row)._id) (value as Row)._id = new ObjectId()
      if (!rows.includes(value)) rows.push(value)
      return Promise.resolve(value)
    }),
    update: jest.fn(
      (criteria: Row, patch: Row): Promise<{ affected: number }> => {
        const target = rows.find(row => matchesWhere(row, criteria))
        if (target) Object.assign(target, patch)
        return Promise.resolve({ affected: target ? 1 : 0 })
      }
    ),
  }
}
