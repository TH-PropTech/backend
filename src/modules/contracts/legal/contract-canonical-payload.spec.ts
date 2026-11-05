import { ObjectId } from 'mongodb'
import { Contract } from '../schemas/contract.schema'
import {
  buildCanonicalContractPayload,
  hashCanonicalContractPayload,
} from './contract-canonical-payload'

describe('buildCanonicalContractPayload', () => {
  const contract = Object.assign(new Contract(), {
    _id: new ObjectId(),
    contractCode: 'HD-1',
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
    propertyId: 'property-1',
    propertyTitle: 'Apartment',
    propertyAddress: null,
    propertyArea: null,
    propertyFurniture: null,
    startDate: new Date('2030-01-01T00:00:00.000Z'),
    endDate: new Date('2031-01-01T00:00:00.000Z'),
    monthlyRent: 10_000_000,
    deposit: 10_000_000,
    paymentDay: 1,
    latePenaltyRate: 0,
    terminationNoticeDays: 30,
    durationMonths: 12,
    hashSchemaVersion: 2,
  })

  it('keeps v2 payloads stable when no layout snapshot exists', () => {
    const payload = buildCanonicalContractPayload(contract)

    expect(payload.hashSchemaVersion).toBe(2)
    expect(payload.layout).toBeNull()
  })

  it('leaves the digest of a contract without custom clauses unchanged', () => {
    const legacy = hashCanonicalContractPayload(
      buildCanonicalContractPayload(contract)
    )
    for (const customClauses of [undefined, null, '']) {
      const same = Object.assign(new Contract(), contract, { customClauses })
      expect(
        hashCanonicalContractPayload(buildCanonicalContractPayload(same))
      ).toBe(legacy)
    }
    expect(
      buildCanonicalContractPayload(contract).commercial
    ).not.toHaveProperty('customClauses')
  })

  it('keeps the digest of a stored legacy contract identical to the pre-change value', () => {
    const legacy = Object.assign(new Contract(), contract, {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      contractCode: 'HD-LEGACY-1',
    })
    // Giá trị này được tính bằng mã trước khi thêm customClauses (HEAD) và bằng mã hiện tại: hai kết quả trùng nhau.
    expect(
      hashCanonicalContractPayload(buildCanonicalContractPayload(legacy))
    ).toBe('1b7bda7bd68ced1c036c6558ab4aa592f53570ab1c0d793c1404eef5c0d555f7')
  })

  it('changes the digest when the custom clauses change', () => {
    const withClauses = (customClauses: string): string =>
      hashCanonicalContractPayload(
        buildCanonicalContractPayload(
          Object.assign(new Contract(), contract, { customClauses })
        )
      )
    expect(withClauses('Không nuôi thú cưng.')).not.toBe(
      withClauses('Được nuôi thú cưng.')
    )
  })

  it('uses v3 and changes the digest when the layout snapshot changes', () => {
    const first = Object.assign(new Contract(), contract, {
      hashSchemaVersion: 3,
      layoutProfileRef: {
        profileKey: 'standard',
        version: 1,
        contentHash: 'a'.repeat(64),
        supplementaryClauses: [
          { id: 'enabled', title: 'Extra', content: 'A', enabled: true },
          { id: 'disabled', title: 'Hidden', content: 'B', enabled: false },
        ],
      },
    })
    const second = Object.assign(new Contract(), first, {
      layoutProfileRef: {
        ...first.layoutProfileRef,
        supplementaryClauses: [
          { id: 'enabled', title: 'Extra', content: 'Changed', enabled: true },
          { id: 'disabled', title: 'Hidden', content: 'B', enabled: false },
        ],
      },
    })

    const firstPayload = buildCanonicalContractPayload(first)
    const secondPayload = buildCanonicalContractPayload(second)
    expect(firstPayload.hashSchemaVersion).toBe(3)
    expect(firstPayload.layout?.supplementaryClauses).toEqual([
      { id: 'enabled', title: 'Extra', content: 'A', enabled: true },
    ])
    expect(
      hashCanonicalContractPayload(buildCanonicalContractPayload(first))
    ).not.toBe(hashCanonicalContractPayload(secondPayload))
  })

  it('uses the v2 builder when the locked contract explicitly declares schema v2', () => {
    const legacy = Object.assign(new Contract(), contract, {
      hashSchemaVersion: 2,
      layoutProfileRef: {
        profileKey: 'standard',
        version: 1,
        contentHash: 'a'.repeat(64),
        supplementaryClauses: [
          { id: 'enabled', title: 'Extra', content: 'A', enabled: true },
        ],
      },
    })

    const payload = buildCanonicalContractPayload(legacy)

    expect(payload.hashSchemaVersion).toBe(2)
    expect(payload.layout).toBeNull()
  })
})
