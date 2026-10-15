import type { Repository } from 'typeorm'
import type { ContractTemplate } from '../schemas/contract-template.schema'
import { ContractTemplateKindRepository } from './contract-template-kind.repository'

type Row = Record<string, unknown> & { _id: string }

/**
 * Fake tối thiểu có thực thi `where` (không phải mock trả mọi thứ): hỗ trợ so bằng và
 * `$in` (có null để khớp trường thiếu, như Mongo). Dữ liệu trộn template có/thiếu `kind`
 * và layout để kiểm tra facade thật sự lọc.
 */
function fakeRows(initial: Row[]): {
  find: jest.Mock
  findOne: jest.Mock
  create: jest.Mock
  save: jest.Mock
  remove: jest.Mock
  all: () => Row[]
} {
  let rows = [...initial]
  const matches = (row: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, expected]) => {
      const actual = row[key] ?? null
      if (
        expected !== null &&
        typeof expected === 'object' &&
        '$in' in expected
      ) {
        return (expected as { $in: unknown[] }).$in.includes(actual)
      }
      return actual === (expected ?? null)
    })
  return {
    find: jest.fn(
      (options: { where?: Record<string, unknown> } = {}): Promise<Row[]> =>
        Promise.resolve(rows.filter(row => matches(row, options.where ?? {})))
    ),
    findOne: jest.fn(
      (
        options: { where?: Record<string, unknown> } = {}
      ): Promise<Row | null> =>
        Promise.resolve(
          rows.find(row => matches(row, options.where ?? {})) ?? null
        )
    ),
    create: jest.fn(
      (data: Record<string, unknown>): Record<string, unknown> => ({
        ...data,
      })
    ),
    save: jest.fn((entity: Row): Promise<Row> => {
      rows = [...rows.filter(r => r._id !== entity._id), entity]
      return Promise.resolve(entity)
    }),
    remove: jest.fn((entity: Row): Promise<Row> => {
      rows = rows.filter(r => r._id !== entity._id)
      return Promise.resolve(entity)
    }),
    all: (): Row[] => rows,
  }
}

type FakeRows = ReturnType<typeof fakeRows>

function asRepository(repo: FakeRows): Repository<ContractTemplate> {
  return repo as unknown as Repository<ContractTemplate>
}

function asTemplate(data: Record<string, unknown>): ContractTemplate {
  return data as unknown as ContractTemplate
}

const FIXTURE: Row[] = [
  // Template mới có kind rõ ràng.
  {
    _id: 't-new',
    kind: 'template',
    templateKey: 'lease-a',
    version: 2,
    status: 'published',
  },
  // Template cũ thiếu kind (trước migration 025): vẫn phải được coi là template.
  {
    _id: 't-legacy',
    templateKey: 'lease-a',
    version: 1,
    status: 'published',
  },
  // Layout cùng collection, cùng templateKey.
  {
    _id: 'l-1',
    kind: 'layout',
    templateKey: 'lease-a',
    profileKey: 'profile-1',
    version: 1,
    status: 'published',
  },
]

describe('ContractTemplateKindRepository', () => {
  describe('template facade', () => {
    it('find returns template rows including legacy rows without kind, never layouts', async () => {
      const repo = fakeRows(FIXTURE)
      const templates = new ContractTemplateKindRepository(
        asRepository(repo),
        'template'
      )

      const found = await templates.find({ where: { templateKey: 'lease-a' } })

      expect(found.map(r => r._id).sort()).toEqual(['t-legacy', 't-new'])
    })

    it('find ignores a caller-supplied kind in where and keeps the template filter', async () => {
      const repo = fakeRows(FIXTURE)
      const templates = new ContractTemplateKindRepository(
        asRepository(repo),
        'template'
      )

      const found = await templates.find({
        where: { templateKey: 'lease-a', kind: 'layout' },
      })

      expect(found.map(r => r._id).sort()).toEqual(['t-legacy', 't-new'])
      expect(repo.find).toHaveBeenCalledWith({
        where: { templateKey: 'lease-a', kind: { $in: ['template', null] } },
      })
    })

    it('findOne finds a legacy template without kind and does not return a layout', async () => {
      const repo = fakeRows(FIXTURE)
      const templates = new ContractTemplateKindRepository(
        asRepository(repo),
        'template'
      )

      await expect(
        templates.findOne({ where: { _id: 't-legacy' } })
      ).resolves.toMatchObject({ _id: 't-legacy' })
      await expect(
        templates.findOne({ where: { _id: 'l-1' } })
      ).resolves.toBeNull()
    })

    it('create stamps kind=template', () => {
      const templates = new ContractTemplateKindRepository(
        asRepository(fakeRows([])),
        'template'
      )

      const created = templates.create({ templateKey: 'lease-b', version: 1 })

      expect(created).toMatchObject({
        templateKey: 'lease-b',
        kind: 'template',
      })
    })

    it('save stamps kind on an entity without kind (legacy shape) and persists it', async () => {
      const repo = fakeRows(FIXTURE)
      const templates = new ContractTemplateKindRepository(
        asRepository(repo),
        'template'
      )
      const legacy = asTemplate({
        _id: 't-legacy',
        templateKey: 'lease-a',
        version: 1,
      })

      const saved = await templates.save(legacy)

      expect(saved.kind).toBe('template')
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 't-legacy', kind: 'template' })
      )
    })

    it('save refuses a layout entity and writes nothing', async () => {
      const repo = fakeRows(FIXTURE)
      const templates = new ContractTemplateKindRepository(
        asRepository(repo),
        'template'
      )

      await expect(
        templates.save(asTemplate({ _id: 'l-1', kind: 'layout' }))
      ).rejects.toThrow(
        'contract template kind mismatch: expected template, got layout'
      )
      expect(repo.save).not.toHaveBeenCalled()
    })

    it('remove refuses a layout entity and deletes only matching template rows', async () => {
      const repo = fakeRows(FIXTURE)
      const templates = new ContractTemplateKindRepository(
        asRepository(repo),
        'template'
      )

      await expect(
        templates.remove(asTemplate({ _id: 'l-1', kind: 'layout' }))
      ).rejects.toThrow('kind mismatch')
      expect(repo.remove).not.toHaveBeenCalled()
      expect(repo.all().map(r => r._id)).toContain('l-1')

      await templates.remove(
        asTemplate({ _id: 't-legacy', templateKey: 'lease-a' })
      )
      expect(repo.remove).toHaveBeenCalledTimes(1)
      expect(repo.all().map(r => r._id)).not.toContain('t-legacy')
    })
  })

  describe('layout facade', () => {
    it('find returns only layout rows; template rows (with or without kind) are hidden', async () => {
      const repo = fakeRows(FIXTURE)
      const layouts = new ContractTemplateKindRepository(
        asRepository(repo),
        'layout'
      )

      const found = await layouts.find({ where: { templateKey: 'lease-a' } })

      expect(found.map(r => r._id)).toEqual(['l-1'])
      expect(repo.find).toHaveBeenCalledWith({
        where: { templateKey: 'lease-a', kind: 'layout' },
      })
    })

    it('save refuses a template entity (kind=template) for the layout facade', async () => {
      const repo = fakeRows(FIXTURE)
      const layouts = new ContractTemplateKindRepository(
        asRepository(repo),
        'layout'
      )

      await expect(
        layouts.save(asTemplate({ _id: 't-new', kind: 'template' }))
      ).rejects.toThrow('expected layout, got template')
      expect(repo.save).not.toHaveBeenCalled()
    })

    it('save accepts an entity without kind and stamps kind=layout', async () => {
      const repo = fakeRows(FIXTURE)
      const layouts = new ContractTemplateKindRepository(
        asRepository(repo),
        'layout'
      )

      const saved = await layouts.save(
        asTemplate({ _id: 'l-2', profileKey: 'profile-2' })
      )

      expect(saved.kind).toBe('layout')
      expect(repo.all().find(r => r._id === 'l-2')).toMatchObject({
        kind: 'layout',
      })
    })
  })
})
