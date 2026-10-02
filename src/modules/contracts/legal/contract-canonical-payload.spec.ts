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
