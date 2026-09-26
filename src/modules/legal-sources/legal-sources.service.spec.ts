import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import type { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { LegalSourcesService } from './legal-sources.service'
import type { LegalSource } from './schemas/legal-source.schema'
import type { PlatformRegulation } from './schemas/platform-regulation.schema'
import {
  buildSeedLegalSources,
  buildSeedPlatformRegulations,
  SEED_CONTRACT_PANEL_KEYS,
} from './legal-sources.seed-data'
import type { CreateLegalSourceDto } from './dto/legal-source.dto'

type MockRepo<T extends object> = jest.Mocked<
  Pick<
    Repository<T>,
    'find' | 'findOne' | 'count' | 'save' | 'create' | 'update' | 'delete'
  >
>

function mockRepo<T extends object>(): MockRepo<T> {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    // Như Mongo: gán _id khi insert bản ghi mới
    save: jest.fn((entity: { _id?: ObjectId }) =>
      Promise.resolve({ _id: new ObjectId(), ...entity })
    ),
    create: jest.fn((entity: unknown) => entity),
    update: jest.fn(),
    delete: jest.fn(),
  } as unknown as MockRepo<T>
}

const CONTENT = {
  kind: 'procedure' as const,
  code: 'TTHC 1.004194',
  title: 'Đăng ký tạm trú',
  subtitle: '',
  agency: 'Công an xã',
  duration: '3 ngày',
  fee: 'Miễn phí',
  externalUrl: 'https://dichvucong.gov.vn/thu-tuc-hanh-chinh/x',
  icon: 'residence' as const,
  description: 'Mô tả',
  dossierItems: [],
  steps: [],
  legalGrounds: [],
  notes: [],
}

function source(overrides: Partial<LegalSource> = {}): LegalSource {
  return {
    ...CONTENT,
    _id: new ObjectId(),
    key: '1.004194',
    showInContractPanel: true,
    order: 1,
    isActive: true,
    updatedBy: 'admin-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function createDto(
  overrides: Partial<CreateLegalSourceDto> = {}
): CreateLegalSourceDto {
  return { ...CONTENT, key: 'residence-law-2020', ...overrides }
}

describe('LegalSourcesService', () => {
  let sources: MockRepo<LegalSource>
  let regulations: MockRepo<PlatformRegulation>
  let service: LegalSourcesService

  beforeEach(() => {
    sources = mockRepo<LegalSource>()
    regulations = mockRepo<PlatformRegulation>()
    service = new LegalSourcesService(
      sources as unknown as Repository<LegalSource>,
      regulations as unknown as Repository<PlatformRegulation>
    )
  })

  describe('seed data', () => {
    const seededSources = buildSeedLegalSources()
    const seededRegulations = buildSeedPlatformRegulations()

    it('contains 6 procedures and 10 legal texts with unique keys', () => {
      expect(seededSources.filter(s => s.kind === 'procedure')).toHaveLength(6)
      expect(seededSources.filter(s => s.kind === 'legal_text')).toHaveLength(
        10
      )
      expect(new Set(seededSources.map(s => s.key)).size).toBe(
        seededSources.length
      )
    })

    it('uses https for every external and legal-ground URL', () => {
      const urls = seededSources.flatMap(s => [
        s.externalUrl,
        ...s.legalGrounds.flatMap(g => (g.url ? [g.url] : [])),
      ])
      expect(urls.length).toBeGreaterThanOrEqual(seededSources.length)
      urls.forEach(url => expect(url).toMatch(/^https:\/\//))
    })

    it('shows exactly the former DVC_LINKS keys in the contract panel', () => {
      expect(
        seededSources.filter(s => s.showInContractPanel).map(s => s.key)
      ).toEqual([...SEED_CONTRACT_PANEL_KEYS])
    })

    it('links regulations only to seeded source keys', () => {
      const keys = new Set(seededSources.map(s => s.key))
      expect(seededRegulations.length).toBeGreaterThan(0)
      seededRegulations.forEach(r => {
        if (r.linkedSourceKey) expect(keys.has(r.linkedSourceKey)).toBe(true)
      })
    })
  })

  describe('seedIfEmpty', () => {
    it('seeds both collections when empty', async () => {
      sources.count.mockResolvedValue(0)
      regulations.count.mockResolvedValue(0)

      await service.seedIfEmpty()

      expect(sources.save).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ key: '1.004194' })])
      )
      expect(regulations.save).toHaveBeenCalled()
    })

    it('does not overwrite collections that already have data', async () => {
      sources.count.mockResolvedValue(3)
      regulations.count.mockResolvedValue(1)

      await service.seedIfEmpty()

      expect(sources.save).not.toHaveBeenCalled()
      expect(regulations.save).not.toHaveBeenCalled()
    })
  })

  describe('public reads', () => {
    it('filters active contract-panel sources sorted by order', async () => {
      sources.find.mockResolvedValue([source()])

      const result = await service.findPublic('contract')

      expect(sources.find).toHaveBeenCalledWith({
        where: { isActive: true, showInContractPanel: true },
        order: { order: 'ASC' },
      })
      expect(result[0]?.key).toBe('1.004194')
      expect(result[0]).not.toHaveProperty('updatedBy')
    })

    it('returns every active source without panel filter', async () => {
      sources.find.mockResolvedValue([])

      await service.findPublic()

      expect(sources.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { order: 'ASC' },
      })
    })

    it('throws 404 for missing or inactive source', async () => {
      sources.findOne.mockResolvedValue(null)

      await expect(service.findPublicByKey('tax-law-2019')).rejects.toThrow(
        NotFoundException
      )
      expect(sources.findOne).toHaveBeenCalledWith({
        where: { key: 'tax-law-2019', isActive: true },
      })
    })
  })

  describe('create', () => {
    it('creates source at the end of the order with actor', async () => {
      sources.count.mockResolvedValueOnce(0).mockResolvedValueOnce(16)

      const result = await service.create(createDto(), 'admin-1')

      expect(sources.save).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'residence-law-2020',
          order: 17,
          updatedBy: 'admin-1',
          isActive: true,
        })
      )
      expect(result.key).toBe('residence-law-2020')
    })

    it('rejects duplicate key with 409', async () => {
      sources.count.mockResolvedValue(1)

      await expect(
        service.create(createDto({ key: '1.004194' }), 'admin-1')
      ).rejects.toThrow(ConflictException)
      expect(sources.save).not.toHaveBeenCalled()
    })

    it('rejects reserved key "admin"', async () => {
      await expect(
        service.create(createDto({ key: 'admin' }), 'admin-1')
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('update', () => {
    it('merges fields, keeps key and records actor', async () => {
      const existing = source()
      sources.findOne.mockResolvedValue(existing)

      const result = await service.update(
        '1.004194',
        { showInContractPanel: false },
        'admin-2'
      )

      expect(result).toMatchObject({
        key: '1.004194',
        showInContractPanel: false,
        updatedBy: 'admin-2',
      })
      expect(existing.showInContractPanel).toBe(true)
    })

    it('throws 404 for unknown key', async () => {
      sources.findOne.mockResolvedValue(null)

      await expect(service.update('nope', {}, 'admin-1')).rejects.toThrow(
        NotFoundException
      )
    })
  })

  describe('remove', () => {
    it('blocks deletion when regulations reference the source', async () => {
      sources.findOne.mockResolvedValue(source())
      regulations.find.mockResolvedValue([
        { code: 'REG-RES-01' } as PlatformRegulation,
      ])

      const error = await service.remove('1.004194').catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ConflictException)
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'LEGAL_SOURCE_IN_USE',
        regulationCodes: ['REG-RES-01'],
      })
      expect(sources.delete).not.toHaveBeenCalled()
    })

    it('deletes an unreferenced source', async () => {
      const existing = source()
      sources.findOne.mockResolvedValue(existing)
      regulations.find.mockResolvedValue([])

      await service.remove('1.004194')

      expect(sources.delete).toHaveBeenCalledWith(existing._id)
    })
  })

  describe('reorder', () => {
    const a = source({ key: 'a1', order: 1 })
    const b = source({ key: 'b2', order: 2 })

    it('assigns order by list position', async () => {
      sources.find.mockResolvedValue([a, b])

      await service.reorder(['b2', 'a1'], 'admin-1')

      expect(sources.update).toHaveBeenCalledWith(b._id, {
        order: 1,
        updatedBy: 'admin-1',
      })
      expect(sources.update).toHaveBeenCalledWith(a._id, {
        order: 2,
        updatedBy: 'admin-1',
      })
    })

    it.each([
      ['missing key', ['a1']],
      ['unknown key', ['a1', 'zz']],
      ['duplicate key', ['a1', 'a1']],
      ['extra key', ['a1', 'b2', 'c3']],
    ])('rejects %s with 400', async (_label, keys) => {
      sources.find.mockResolvedValue([a, b])

      await expect(service.reorder(keys, 'admin-1')).rejects.toThrow(
        BadRequestException
      )
      expect(sources.update).not.toHaveBeenCalled()
    })
  })
})
