import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import type { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { PlatformRegulationsService } from './platform-regulations.service'
import type { LegalDocument } from '../../legal/schemas/legal-document.schema'
import type { CreatePlatformRegulationDto } from '../../legal/dto/platform-regulation.dto'
import {
  LegalDocumentMemoryRepository,
  type LegalDocumentRow,
} from '../../legal/utils/legal-document-memory-repository.fixtures'

const DTO: CreatePlatformRegulationDto = {
  code: 'REG-NEW-01',
  title: 'Quy định mới',
  summary: 'Tóm tắt',
  category: 'residence',
  severity: 'mandatory',
  scope: ['all'],
  linkedSourceKey: '1.004194',
  checklistItems: [{ id: 'c1', label: 'Việc cần làm' }],
}

/** Dòng `legal_documents` kind='regulation'. */
function regulationRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    kind: 'regulation',
    ...DTO,
    code: 'REG-RES-01',
    linkedSourceKey: '1.004194',
    order: 1,
    isActive: true,
    isDefault: true,
    ...overrides,
  }
}

/** Dòng `legal_documents` kind='source' (có `code` riêng, không unique). */
function sourceRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    kind: 'source',
    docKind: 'procedure',
    key: '1.004194',
    code: 'TTHC 1.004194',
    title: 'Đăng ký tạm trú',
    order: 1,
    isActive: true,
    showInContractPanel: true,
    ...overrides,
  }
}

describe('PlatformRegulationsService', () => {
  let store: LegalDocumentMemoryRepository
  let service: PlatformRegulationsService

  const regulationRows = (): LegalDocumentRow[] =>
    store.rows.filter(row => row['kind'] === 'regulation')

  beforeEach(() => {
    store = new LegalDocumentMemoryRepository()
    service = new PlatformRegulationsService(
      store as unknown as Repository<LegalDocument>
    )
  })

  describe('create', () => {
    it('creates regulation linked to an existing source', async () => {
      store.seed([
        ...Array.from({ length: 5 }, (_, index) =>
          regulationRow({ code: `REG-OLD-${index}`, order: index + 1 })
        ),
        sourceRow(),
      ])

      const result = await service.create(DTO, 'admin-1')

      expect(result).toMatchObject({
        code: 'REG-NEW-01',
        linkedSourceKey: '1.004194',
        order: 6,
        isDefault: false,
        updatedBy: 'admin-1',
      })
      expect(regulationRows()).toHaveLength(6)
      expect(
        regulationRows().find(row => row['code'] === 'REG-NEW-01')
      ).toMatchObject({ kind: 'regulation', order: 6 })
    })

    it('allows regulation without linked source', async () => {
      const result = await service.create(
        { ...DTO, linkedSourceKey: null },
        'admin-1'
      )

      expect(result.linkedSourceKey).toBeNull()
      expect(regulationRows()).toHaveLength(1)
    })

    it('rejects unknown linked source with LINKED_SOURCE_NOT_FOUND', async () => {
      const error = await service
        .create({ ...DTO, linkedSourceKey: 'ghost' }, 'admin-1')
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(BadRequestException)
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'LINKED_SOURCE_NOT_FOUND',
      })
      expect(regulationRows()).toHaveLength(0)
    })

    it('rejects duplicate code with 409', async () => {
      store.seed([regulationRow({ code: 'REG-NEW-01' })])

      await expect(service.create(DTO, 'admin-1')).rejects.toThrow(
        ConflictException
      )
      expect(regulationRows()).toHaveLength(1)
    })

    it('a source row with the same code does not block a regulation (kind isolation)', async () => {
      // nguồn liên kết (key 1.004194) có code trùng mã quy định mới
      store.seed([sourceRow({ code: 'REG-NEW-01' })])

      await expect(service.create(DTO, 'admin-1')).resolves.toMatchObject({
        code: 'REG-NEW-01',
      })
    })
  })

  describe('update', () => {
    it('updates fields without touching the original entity', async () => {
      store.seed([regulationRow()])
      const existing = regulationRows()[0]!

      const result = await service.update(
        String(existing['_id']),
        { isActive: false },
        'admin-2'
      )

      expect(result).toMatchObject({ isActive: false, updatedBy: 'admin-2' })
      expect(regulationRows()[0]).toMatchObject({
        isActive: false,
        kind: 'regulation',
      })
    })

    it('checks code uniqueness only when code changes', async () => {
      store.seed([regulationRow(), regulationRow({ code: 'REG-TAX-02' })])
      const existing = regulationRows()[0]!
      const id = String(existing['_id'])

      await expect(
        service.update(id, { code: 'REG-TAX-02' }, 'a')
      ).rejects.toThrow(ConflictException)
      await expect(
        service.update(id, { code: 'REG-RES-01' }, 'a')
      ).resolves.toBeDefined()
    })

    it('throws 404 for invalid or unknown id', async () => {
      await expect(service.update('not-an-id', {}, 'a')).rejects.toThrow(
        NotFoundException
      )
      await expect(
        service.update(new ObjectId().toString(), {}, 'a')
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('remove', () => {
    it('deletes by object id and leaves other kinds alone', async () => {
      store.seed([regulationRow(), sourceRow()])
      const existing = regulationRows()[0]!

      await service.remove(String(existing['_id']))

      expect(regulationRows()).toHaveLength(0)
      expect(store.rows.filter(row => row['kind'] === 'source')).toHaveLength(1)
    })
  })

  describe('reorder', () => {
    it('assigns order by list position and rejects non-permutations', async () => {
      store.seed([
        regulationRow({ code: 'REG-RES-01', order: 1 }),
        regulationRow({ code: 'REG-TAX-02', order: 2 }),
      ])
      const [a, b] = regulationRows()
      const ids = [String(a!['_id']), String(b!['_id'])]

      await service.reorder([ids[1]!, ids[0]!], 'admin-1')
      expect(
        regulationRows().find(r => r['code'] === 'REG-TAX-02')
      ).toMatchObject({ order: 1, updatedBy: 'admin-1' })

      await expect(service.reorder([ids[0]!], 'admin-1')).rejects.toThrow(
        BadRequestException
      )
    })

    it('ignores source rows when checking the permutation (kind isolation)', async () => {
      store.seed([regulationRow(), sourceRow()])
      const [only] = regulationRows()

      await expect(
        service.reorder([String(only!['_id'])], 'admin-1')
      ).resolves.toHaveLength(1)
    })
  })
})
