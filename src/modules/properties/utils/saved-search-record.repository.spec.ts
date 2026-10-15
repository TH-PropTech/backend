import type { Repository } from 'typeorm'
import type { SavedSearchRecord } from '../schemas/saved-search-record.schema'
import { SavedSearchRecordRepository } from './saved-search-record.repository'

/** Fake repo ghi nhận đúng tham số thô facade truyền xuống (find nhận { where, ... }). */
function makeFakeRepo(): {
  find: jest.Mock
  findOne: jest.Mock
  create: jest.Mock
  save: jest.Mock
  remove: jest.Mock
} {
  return {
    find: jest.fn((): Promise<SavedSearchRecord[]> => Promise.resolve([])),
    findOne: jest.fn(
      (): Promise<SavedSearchRecord | null> => Promise.resolve(null)
    ),
    create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
    save: jest.fn((value: unknown): Promise<unknown> => Promise.resolve(value)),
    remove: jest.fn(
      (record: SavedSearchRecord): Promise<SavedSearchRecord> =>
        Promise.resolve(record)
    ),
  }
}

function build(kind: 'search' | 'alert'): {
  facade: SavedSearchRecordRepository
  repo: ReturnType<typeof makeFakeRepo>
} {
  const repo = makeFakeRepo()
  const facade = new SavedSearchRecordRepository(
    repo as unknown as Repository<SavedSearchRecord>,
    kind
  )
  return { facade, repo }
}

describe('SavedSearchRecordRepository', () => {
  describe('kind = search', () => {
    it('find truyền where thô đã gắn kind, giữ điều kiện của caller', async () => {
      const { facade, repo } = build('search')

      await facade.find({ where: { userId: 'u1', alertEnabled: true } })

      expect(repo.find).toHaveBeenCalledWith({
        where: { userId: 'u1', alertEnabled: true, kind: 'search' },
      })
    })

    it('find không truyền options vẫn gắn where = { kind }', async () => {
      const { facade, repo } = build('search')

      await facade.find()

      expect(repo.find).toHaveBeenCalledWith({ where: { kind: 'search' } })
    })

    it('kind của caller trong where bị ghi đè bởi kind của facade', async () => {
      const { facade, repo } = build('search')

      await facade.find({ where: { kind: 'alert', userId: 'u1' } })

      expect(repo.find).toHaveBeenCalledWith({
        where: { kind: 'search', userId: 'u1' },
      })
    })

    it('findOne truyền where thô đã gắn kind và giữ các options khác', async () => {
      const { facade, repo } = build('search')

      await facade.findOne({ where: { _id: 'abc' }, select: ['_id'] } as never)

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { _id: 'abc', kind: 'search' },
        select: ['_id'],
      })
    })

    it('create gắn kind của facade', () => {
      const { facade } = build('search')

      expect(facade.create({ userId: 'u1' })).toEqual({
        userId: 'u1',
        kind: 'search',
      })
    })

    it('save nhận bản ghi đúng kind và chuyển thẳng cho repo', async () => {
      const { facade, repo } = build('search')
      const record = {
        _id: 'r1',
        kind: 'search',
      } as unknown as SavedSearchRecord

      await expect(facade.save(record)).resolves.toBe(record)
      expect(repo.save).toHaveBeenCalledWith(record)
    })

    it('save từ chối bản ghi kind = alert và không gọi repo', () => {
      const { facade, repo } = build('search')
      const record = {
        _id: 'r1',
        kind: 'alert',
      } as unknown as SavedSearchRecord

      expect(() => facade.save(record)).toThrow(
        'SavedSearchRecord kind mismatch: expected search, got alert'
      )
      expect(repo.save).not.toHaveBeenCalled()
    })

    it('save mảng: một phần tử sai kind làm cả lô bị từ chối', () => {
      const { facade, repo } = build('search')
      const list = [
        { _id: 'r1', kind: 'search' },
        { _id: 'r2', kind: 'alert' },
      ] as unknown as SavedSearchRecord[]

      expect(() => facade.save(list)).toThrow('kind mismatch')
      expect(repo.save).not.toHaveBeenCalled()
    })

    it('save nhận bản ghi thiếu kind và tự gán kind của facade', async () => {
      const { facade, repo } = build('search')
      const record = { _id: 'r1' } as unknown as SavedSearchRecord

      await facade.save(record)

      expect(record.kind).toBe('search')
      expect(repo.save).toHaveBeenCalledWith({ _id: 'r1', kind: 'search' })
    })

    it('save mảng: tự gán kind cho phần tử thiếu kind, từ chối nếu có phần tử kind khác', async () => {
      const { facade, repo } = build('alert')
      const missing = { _id: 'r1' } as unknown as SavedSearchRecord
      const list = [missing] as SavedSearchRecord[]

      await facade.save(list)
      expect(missing.kind).toBe('alert')
      expect(repo.save).toHaveBeenCalledTimes(1)

      const mixed = [
        { _id: 'r2' } as unknown as SavedSearchRecord,
        { _id: 'r3', kind: 'search' } as unknown as SavedSearchRecord,
      ]
      expect(() => facade.save(mixed)).toThrow('expected alert, got search')
      expect(repo.save).toHaveBeenCalledTimes(1)
      expect(mixed[0]?.kind).toBeUndefined()
    })

    it('remove chuyển thẳng cho repo', async () => {
      const { facade, repo } = build('search')
      const record = {
        _id: 'r1',
        kind: 'search',
      } as unknown as SavedSearchRecord

      await facade.remove(record)

      expect(repo.remove).toHaveBeenCalledWith(record)
    })
  })

  describe('kind = alert', () => {
    it('find chỉ lọc kind = alert, không lẫn search', async () => {
      const { facade, repo } = build('alert')

      await facade.find({ where: { savedSearchId: 's1' } })

      expect(repo.find).toHaveBeenCalledWith({
        where: { savedSearchId: 's1', kind: 'alert' },
      })
    })

    it('create gắn kind = alert', () => {
      const { facade } = build('alert')

      expect(facade.create({ savedSearchId: 's1' })).toEqual({
        savedSearchId: 's1',
        kind: 'alert',
      })
    })

    it('save từ chối bản ghi kind = search', () => {
      const { facade } = build('alert')
      const record = {
        _id: 'r1',
        kind: 'search',
      } as unknown as SavedSearchRecord

      expect(() => facade.save(record)).toThrow('expected alert, got search')
    })
  })
})
