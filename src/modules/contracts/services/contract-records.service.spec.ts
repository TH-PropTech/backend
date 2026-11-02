import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { memoryRepository } from '../../fabric/utils/fabric-memory-repository.fixtures'
import type { Contract } from '../schemas/contract.schema'
import type { ContractDocument } from '../schemas/contract-document.schema'
import { ContractRecordsService } from './contract-records.service'

type Row = Record<string, unknown>

function contractRow(overrides: Row = {}): Row {
  return {
    _id: new ObjectId(),
    contractCode: 'HD-001',
    propertyId: 'prop-1',
    propertyTitle: 'Căn hộ Sunrise A1',
    propertyAddress: '12 Nguyễn Huệ, Quận 1',
    landlordId: 'landlord-1',
    landlordName: 'Trần Văn Chủ',
    landlordCccd: '079000000001',
    tenantId: 'tenant-1',
    tenantName: 'Nguyễn Thị Thuê',
    tenantCccd: '079000000002',
    tenantAddress: 'Địa chỉ cá nhân bí mật',
    tenantPhone: '0900000000',
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    endDate: new Date('2026-12-31T00:00:00.000Z'),
    status: 'active',
    createdAt: new Date('2026-03-10T08:00:00.000Z'),
    ...overrides,
  }
}

function documentRow(contract: Row, overrides: Row = {}): Row {
  return {
    _id: new ObjectId(),
    kind: 'canonical',
    contractId: (contract._id as ObjectId).toHexString(),
    revision: 1,
    artifactHash: 'a'.repeat(64),
    ...overrides,
  }
}

function build(
  contracts: Row[],
  documents: Row[] = []
): {
  service: ContractRecordsService
  contractRepo: ReturnType<typeof memoryRepository>
  documentRepo: ReturnType<typeof memoryRepository>
} {
  const contractRepo = memoryRepository(contracts)
  const documentRepo = memoryRepository(documents)
  const service = new ContractRecordsService(
    contractRepo as unknown as Repository<Contract>,
    documentRepo as unknown as Repository<ContractDocument>
  )
  return { service, contractRepo, documentRepo }
}

describe('ContractRecordsService', () => {
  describe('filters', () => {
    const sunrise = contractRow({
      contractCode: 'HD-001',
      createdAt: new Date('2026-03-10T08:00:00.000Z'),
    })
    const riverside = contractRow({
      contractCode: 'HD-002',
      propertyTitle: 'Căn hộ Riverside B2',
      propertyAddress: '99 Lê Lợi, Quận 3',
      tenantName: 'Phạm Văn Khách',
      landlordName: 'Lê Thị Chủ',
      status: 'draft',
      createdAt: new Date('2026-05-20T08:00:00.000Z'),
    })
    const dotted = contractRow({
      contractCode: 'HD-003',
      propertyTitle: 'Nhà A.B',
      propertyAddress: '5 Hai Bà Trưng, Quận 1',
      createdAt: new Date('2026-06-01T08:00:00.000Z'),
    })
    const codes = (items: { contractCode: string }[]): string[] =>
      items.map(item => item.contractCode)

    it('returns every contract, newest first, with the total', async () => {
      const { service } = build([sunrise, riverside, dotted])
      const page = await service.listRecords({})
      expect(codes(page.items)).toEqual(['HD-003', 'HD-002', 'HD-001'])
      expect(page).toMatchObject({ total: 3, page: 1, pageSize: 20 })
    })

    it('filters by property title or address, case-insensitively', async () => {
      const { service } = build([sunrise, riverside, dotted])
      expect(
        codes((await service.listRecords({ property: 'riverside' })).items)
      ).toEqual(['HD-002'])
      expect(
        codes((await service.listRecords({ property: 'nguyễn huệ' })).items)
      ).toEqual(['HD-001'])
    })

    it('treats regex characters in the filter as plain text', async () => {
      const { service } = build([sunrise, dotted])
      expect(
        codes((await service.listRecords({ property: 'A.B' })).items)
      ).toEqual(['HD-003'])
      expect((await service.listRecords({ property: '.*' })).items).toEqual([])
    })

    it('filters by tenant, landlord and status', async () => {
      const { service } = build([sunrise, riverside])
      expect(
        codes((await service.listRecords({ tenant: 'khách' })).items)
      ).toEqual(['HD-002'])
      expect(
        codes((await service.listRecords({ landlord: 'văn chủ' })).items)
      ).toEqual(['HD-001'])
      expect(
        codes((await service.listRecords({ status: 'draft' })).items)
      ).toEqual(['HD-002'])
    })

    it('filters by an inclusive date range, a date-only "to" covering that whole day', async () => {
      const { service } = build([sunrise, riverside, dotted])
      expect(
        codes(
          (await service.listRecords({ from: '2026-05-01', to: '2026-05-20' }))
            .items
        )
      ).toEqual(['HD-002'])
      expect(
        codes((await service.listRecords({ from: '2026-05-21' })).items)
      ).toEqual(['HD-003'])
    })

    it('combines filters with AND', async () => {
      const { service } = build([sunrise, riverside, dotted])
      const page = await service.listRecords({
        property: 'căn hộ',
        status: 'active',
      })
      expect(codes(page.items)).toEqual(['HD-001'])
      expect(page.total).toBe(1)
    })

    it('returns an empty page with total 0 when nothing matches', async () => {
      const { service, documentRepo } = build([sunrise])
      const page = await service.listRecords({ tenant: 'không có ai' })
      expect(page).toMatchObject({ items: [], total: 0 })
      expect(documentRepo.find).not.toHaveBeenCalled()
    })
  })

  describe('pagination', () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      contractRow({
        contractCode: `HD-${index}`,
        createdAt: new Date(2026, 0, index + 1),
      })
    )

    it('walks pages without repeating or skipping records', async () => {
      const { service } = build(rows)
      const seen: string[] = []
      for (const pageNumber of [1, 2, 3]) {
        const page = await service.listRecords({
          page: pageNumber,
          pageSize: 2,
        })
        expect(page.total).toBe(5)
        seen.push(...page.items.map(item => item.contractCode))
      }
      expect(seen).toEqual(['HD-4', 'HD-3', 'HD-2', 'HD-1', 'HD-0'])
    })

    it('caps the page size at the server maximum', async () => {
      const { service, contractRepo } = build(rows)
      const page = await service.listRecords({ pageSize: 1000 })
      expect(page.pageSize).toBe(100)
      expect(contractRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100, skip: 0 })
      )
    })

    it('sorts by createdAt descending with _id as the stable tie-breaker', async () => {
      const { service, contractRepo } = build(rows)
      await service.listRecords({})
      expect(contractRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'DESC', _id: 'DESC' } })
      )
    })
  })

  describe('document summary', () => {
    it('reports the highest canonical revision and whether a signed copy exists', async () => {
      const signed = contractRow({ contractCode: 'HD-SIGNED' })
      const draft = contractRow({
        contractCode: 'HD-DRAFT',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      })
      const { service } = build(
        [signed, draft],
        [
          documentRow(signed, { revision: 1 }),
          documentRow(signed, { revision: 3 }),
          documentRow(signed, { kind: 'signed', revision: 1 }),
        ]
      )
      const page = await service.listRecords({})
      const byCode = Object.fromEntries(
        page.items.map(item => [item.contractCode, item])
      )
      expect(byCode['HD-SIGNED']).toMatchObject({
        latestRevision: 3,
        hasSigned: true,
      })
      expect(byCode['HD-DRAFT']).toMatchObject({
        latestRevision: null,
        hasSigned: false,
      })
    })

    it('does not report a signed-only contract as having a PDF revision', async () => {
      const only = contractRow()
      const { service } = build(
        [only],
        [documentRow(only, { kind: 'signed', revision: 2 })]
      )
      const [item] = (await service.listRecords({})).items
      expect(item).toMatchObject({ latestRevision: null, hasSigned: true })
    })

    it('uses a single batched document query regardless of the number of rows', async () => {
      const many = Array.from({ length: 12 }, (_, index) =>
        contractRow({
          contractCode: `HD-${index}`,
          createdAt: new Date(2026, 0, index + 1),
        })
      )
      const { service, documentRepo } = build(many)
      await service.listRecords({ pageSize: 12 })
      expect(documentRepo.find).toHaveBeenCalledTimes(1)
    })
  })

  describe('projection', () => {
    it('returns only the allowed fields and no sensitive personal data', async () => {
      const { service } = build([contractRow()])
      const [item] = (await service.listRecords({})).items
      expect(Object.keys(item as object).sort()).toEqual(
        [
          'contractCode',
          'createdAt',
          'endDate',
          'hasSigned',
          'id',
          'landlordId',
          'landlordName',
          'latestRevision',
          'propertyId',
          'propertyTitle',
          'startDate',
          'status',
          'tenantId',
          'tenantName',
        ].sort()
      )
      const serialized = JSON.stringify(item)
      expect(serialized).not.toContain('079000000001')
      expect(serialized).not.toContain('079000000002')
      expect(serialized).not.toContain('Địa chỉ cá nhân bí mật')
      expect(serialized).not.toContain('0900000000')
    })

    it('keeps null party names so the UI can show a placeholder', async () => {
      const { service } = build([
        contractRow({ tenantName: null, landlordName: null }),
      ])
      const [item] = (await service.listRecords({})).items
      expect(item).toMatchObject({ tenantName: null, landlordName: null })
    })
  })
})
