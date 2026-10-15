import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import type { Repository } from 'typeorm'
import type { LegalDocument } from '../schemas/legal-document.schema'
import { toSourceDocumentFields } from '../schemas/legal-document.mapper'
import { LegalSourcesService } from './legal-sources.service'
import {
  buildSeedLegalSources,
  buildSeedPlatformRegulations,
  SEED_CONTRACT_PANEL_KEYS,
} from '../utils/legal-sources.seed-data'
import type { CreateLegalSourceDto } from '../dto/legal-source.dto'
import {
  LegalDocumentMemoryRepository,
  type LegalDocumentRow,
} from '../utils/legal-document-memory-repository.fixtures'

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

/** Dòng `legal_documents` kind='source' (kind cũ của nguồn nằm ở docKind). */
function sourceRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...toSourceDocumentFields(CONTENT),
    kind: 'source',
    key: '1.004194',
    showInContractPanel: true,
    order: 1,
    isActive: true,
    updatedBy: 'admin-1',
    ...overrides,
  }
}

/** Dòng `legal_documents` kind='regulation'. */
function regulationRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    kind: 'regulation',
    code: 'REG-RES-01',
    title: 'Quy định',
    summary: 'Tóm tắt',
    category: 'residence',
    severity: 'mandatory',
    scope: ['all'],
    linkedSourceKey: '1.004194',
    checklistItems: [],
    order: 1,
    isActive: true,
    isDefault: true,
    ...overrides,
  }
}

function createDto(
  overrides: Partial<CreateLegalSourceDto> = {}
): CreateLegalSourceDto {
  return { ...CONTENT, key: 'residence-law-2020', ...overrides }
}

describe('LegalSourcesService', () => {
  let store: LegalDocumentMemoryRepository
  let service: LegalSourcesService

  const rowsOf = (kind: string): LegalDocumentRow[] =>
    store.rows.filter(r => r['kind'] === kind)

  beforeEach(() => {
    store = new LegalDocumentMemoryRepository()
    service = new LegalSourcesService(
      store as unknown as Repository<LegalDocument>
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
    it('seeds both kinds when empty, tagging each row with its kind', async () => {
      await service.seedIfEmpty()

      expect(rowsOf('source')).toHaveLength(buildSeedLegalSources().length)
      expect(rowsOf('regulation')).toHaveLength(
        buildSeedPlatformRegulations().length
      )
      expect(rowsOf('source')).toContainEqual(
        expect.objectContaining({ key: '1.004194' })
      )
      // loại nguồn seed (kind cũ) đi vào docKind, không đè discriminator
      expect(rowsOf('source').every(r => r['docKind'] !== undefined)).toBe(true)
    })

    it('does not overwrite collections that already have data', async () => {
      store.seed([
        sourceRow(),
        sourceRow({ key: 'b' }),
        sourceRow({ key: 'c' }),
      ])
      store.seed([regulationRow()])

      await service.seedIfEmpty()

      expect(rowsOf('source')).toHaveLength(3)
      expect(rowsOf('regulation')).toHaveLength(1)
    })

    it('counts only its own kind: foreign rows do not block seeding (kind isolation)', async () => {
      store.seed([
        { kind: 'terms', key: 'rental-service-terms', version: 1 },
        { kind: 'knowledge', title: 'Luật Nhà ở' },
        regulationRow(),
      ])

      await service.seedIfEmpty()

      expect(rowsOf('source')).toHaveLength(buildSeedLegalSources().length)
      expect(rowsOf('regulation')).toHaveLength(1)
    })
  })

  describe('public reads', () => {
    it('filters active contract-panel sources sorted by order', async () => {
      store.seed([
        sourceRow({ key: '1.004194', order: 2 }),
        sourceRow({ key: 'b', order: 1, showInContractPanel: false }),
        sourceRow({ key: 'c', order: 3, isActive: false }),
      ])

      const result = await service.findPublic('contract')

      expect(result.map(r => r.key)).toEqual(['1.004194'])
      expect(result[0]?.kind).toBe('procedure')
      expect(result[0]).not.toHaveProperty('updatedBy')
    })

    it('returns every active source without panel filter, sorted by order', async () => {
      store.seed([
        sourceRow({ key: 'late', order: 2 }),
        sourceRow({ key: 'early', order: 1, showInContractPanel: false }),
        sourceRow({ key: 'off', order: 3, isActive: false }),
      ])

      const result = await service.findPublic()

      expect(result.map(r => r.key)).toEqual(['early', 'late'])
    })

    it('throws 404 for missing or inactive source', async () => {
      store.seed([sourceRow({ key: 'off', isActive: false })])

      await expect(service.findPublicByKey('tax-law-2019')).rejects.toThrow(
        NotFoundException
      )
      await expect(service.findPublicByKey('off')).rejects.toThrow(
        NotFoundException
      )
    })

    it('does not treat a terms or regulation row with the same key as a source', async () => {
      store.seed([
        { kind: 'terms', key: '1.004194', version: 1, status: 'published' },
      ])

      await expect(service.findPublicByKey('1.004194')).rejects.toThrow(
        NotFoundException
      )
    })
  })

  describe('create', () => {
    it('creates source at the end of the order with actor', async () => {
      store.seed(
        Array.from({ length: 16 }, (_, index) =>
          sourceRow({ key: `seed-${index}`, order: index + 1 })
        )
      )

      const result = await service.create(createDto(), 'admin-1')

      expect(rowsOf('source')).toHaveLength(17)
      expect(
        rowsOf('source').find(r => r['key'] === 'residence-law-2020')
      ).toMatchObject({
        kind: 'source',
        docKind: 'procedure',
        order: 17,
        updatedBy: 'admin-1',
        isActive: true,
      })
      expect(result.key).toBe('residence-law-2020')
      expect(result.kind).toBe('procedure')
    })

    it('rejects duplicate key with 409', async () => {
      store.seed([sourceRow()])

      await expect(
        service.create(createDto({ key: '1.004194' }), 'admin-1')
      ).rejects.toThrow(ConflictException)
      expect(rowsOf('source')).toHaveLength(1)
    })

    it('rejects reserved key "admin"', async () => {
      await expect(
        service.create(createDto({ key: 'admin' }), 'admin-1')
      ).rejects.toThrow(BadRequestException)
    })

    it('a terms row with the same key does not block a new source (kind isolation)', async () => {
      store.seed([{ kind: 'terms', key: 'residence-law-2020', version: 1 }])

      await expect(
        service.create(createDto(), 'admin-1')
      ).resolves.toMatchObject({ key: 'residence-law-2020' })
    })
  })

  describe('update', () => {
    it('merges fields, keeps key and records actor', async () => {
      store.seed([sourceRow()])

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
      expect(rowsOf('source')[0]).toMatchObject({
        key: '1.004194',
        showInContractPanel: false,
        updatedBy: 'admin-2',
      })
    })

    it('maps a changed source kind to docKind and keeps the row discriminator', async () => {
      store.seed([sourceRow()])

      const result = await service.update(
        '1.004194',
        { kind: 'legal_text' },
        'admin-2'
      )

      expect(result.kind).toBe('legal_text')
      expect(rowsOf('source')[0]).toMatchObject({
        kind: 'source',
        docKind: 'legal_text',
      })
    })

    it('throws 404 for unknown key', async () => {
      await expect(service.update('nope', {}, 'admin-1')).rejects.toThrow(
        NotFoundException
      )
    })
  })

  describe('remove', () => {
    it('blocks deletion when regulations reference the source', async () => {
      store.seed([sourceRow(), regulationRow({ code: 'REG-RES-01' })])

      const error = await service.remove('1.004194').catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ConflictException)
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'LEGAL_SOURCE_IN_USE',
        regulationCodes: ['REG-RES-01'],
      })
      expect(rowsOf('source')).toHaveLength(1)
    })

    it('deletes an unreferenced source', async () => {
      store.seed([sourceRow()])

      await service.remove('1.004194')

      expect(rowsOf('source')).toHaveLength(0)
    })
  })

  describe('reorder', () => {
    const seedAB = (): void => {
      store.seed([
        sourceRow({ key: 'a1', order: 1 }),
        sourceRow({ key: 'b2', order: 2 }),
      ])
    }
    const orderOf = (key: string): unknown =>
      rowsOf('source').find(r => r['key'] === key)?.['order']

    it('assigns order by list position', async () => {
      seedAB()

      await service.reorder(['b2', 'a1'], 'admin-1')

      expect(orderOf('b2')).toBe(1)
      expect(orderOf('a1')).toBe(2)
      expect(rowsOf('source').every(r => r['updatedBy'] === 'admin-1')).toBe(
        true
      )
    })

    it('ignores regulation rows when checking the permutation (kind isolation)', async () => {
      seedAB()
      store.seed([regulationRow({ code: 'REG-X' })])

      await expect(
        service.reorder(['b2', 'a1'], 'admin-1')
      ).resolves.toHaveLength(2)
    })

    it.each([
      ['missing key', ['a1']],
      ['unknown key', ['a1', 'zz']],
      ['duplicate key', ['a1', 'a1']],
      ['extra key', ['a1', 'b2', 'c3']],
    ])('rejects %s with 400', async (_label, keys) => {
      seedAB()

      await expect(service.reorder(keys, 'admin-1')).rejects.toThrow(
        BadRequestException
      )
      expect(orderOf('a1')).toBe(1)
      expect(orderOf('b2')).toBe(2)
    })
  })
})
