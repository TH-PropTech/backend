import { ObjectId } from 'mongodb'

type Where = Record<string, unknown>

const matches = (row: object, where: Where | undefined): boolean =>
  !where ||
  Object.entries(where).every(
    ([key, value]) => (row as Record<string, unknown>)[key] === value
  )

/** Repo TypeORM giả trong bộ nhớ, đủ cho find/findOne/create/save dùng ở các service trả nhà. */
export function createMemoryRepo<T extends { _id?: ObjectId }>(
  rows: T[] = []
): {
  rows: T[]
  findOne: jest.Mock
  find: jest.Mock
  create: jest.Mock
  save: jest.Mock
} {
  return {
    rows,
    findOne: jest.fn(({ where }: { where?: Where }) =>
      Promise.resolve(rows.find(row => matches(row, where)) ?? null)
    ),
    find: jest.fn((options?: { where?: Where }) =>
      Promise.resolve(rows.filter(row => matches(row, options?.where)))
    ),
    create: jest.fn((value: Partial<T>) => ({ ...value }) as T),
    save: jest.fn((row: T) => {
      if (!row._id) row._id = new ObjectId()
      if (!rows.includes(row)) rows.push(row)
      return Promise.resolve(row)
    }),
  }
}

export function createSupportMock(canAnchor = true): {
  notify: jest.Mock
  recordEvent: jest.Mock
  enqueueLedger: jest.Mock
  canAnchor: boolean
} {
  return {
    notify: jest.fn().mockResolvedValue(undefined),
    recordEvent: jest.fn().mockResolvedValue(undefined),
    enqueueLedger: jest.fn().mockResolvedValue(undefined),
    canAnchor,
  }
}
