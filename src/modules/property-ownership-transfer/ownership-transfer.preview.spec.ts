import { buildOwnershipTransferPreview } from './ownership-transfer.preview'

describe('buildOwnershipTransferPreview', () => {
  it('groups affected records and preserves immutable linked records', () => {
    const result = buildOwnershipTransferPreview({
      targetLandlordId: 'target',
      knownUserIds: new Set(['owner-1', 'target']),
      apartments: [
        { id: 'apartment-2', landlordId: 'target', version: 'v2' },
        { id: 'apartment-1', landlordId: 'owner-1', version: 'v1' },
      ],
      bookings: [
        {
          id: 'booking-1',
          apartmentId: 'apartment-1',
          landlordId: 'owner-1',
          status: 'pending',
          version: 'b1',
        },
        {
          id: 'booking-closed',
          apartmentId: 'apartment-1',
          landlordId: 'owner-1',
          status: 'completed',
          version: 'b2',
        },
      ],
      applications: [
        {
          id: 'application-1',
          apartmentId: 'apartment-1',
          landlordId: 'owner-1',
          status: 'pending',
          version: 'a1',
        },
      ],
      contracts: [
        {
          id: 'contract-1',
          propertyId: 'apartment-1',
          landlordId: 'owner-1',
          version: 'c1',
        },
      ],
      depositAgreements: [
        {
          id: 'deposit-1',
          propertyId: 'apartment-1',
          landlordId: 'owner-1',
          version: 'd1',
        },
      ],
      payments: [
        {
          id: 'payment-1',
          contractId: 'contract-1',
          landlordId: 'owner-1',
          version: 'p1',
        },
      ],
      disputes: [
        {
          id: 'dispute-1',
          contractId: 'contract-1',
          landlordId: 'owner-1',
          version: 'x1',
        },
      ],
    })

    expect(result.affectedCounts).toEqual({
      apartments: 1,
      openBookings: 1,
      openApplications: 1,
      contracts: 1,
      depositAgreements: 1,
      payments: 1,
      disputes: 1,
    })
    expect(result.immutableCounts).toEqual({
      contracts: 1,
      depositAgreements: 1,
      payments: 1,
      disputes: 1,
    })
    expect(result.sourceOwners).toEqual([
      { userId: 'owner-1', apartmentCount: 1 },
    ])
    expect(result.conflicts).toEqual([])
    expect(result.manifest.records).toHaveLength(7)
  })

  it('reports missing owners and orphan open workflows as conflicts', () => {
    const result = buildOwnershipTransferPreview({
      targetLandlordId: 'target',
      knownUserIds: new Set(['target']),
      apartments: [{ id: 'apartment-1', landlordId: '', version: 'v1' }],
      bookings: [
        {
          id: 'booking-1',
          apartmentId: 'missing-apartment',
          landlordId: 'owner-1',
          status: 'pending',
          version: 'b1',
        },
      ],
      applications: [],
      contracts: [],
      depositAgreements: [],
      payments: [],
      disputes: [],
    })

    expect(result.conflicts.map(conflict => conflict.code)).toEqual([
      'MISSING_SOURCE_OWNER',
      'ORPHAN_OPEN_BOOKING',
    ])
  })

  it('is read-only and repeatable for the same source snapshot', () => {
    const input = {
      targetLandlordId: 'target',
      knownUserIds: new Set(['owner', 'target']),
      apartments: [{ id: 'apartment-1', landlordId: 'owner', version: 'v1' }],
      bookings: [],
      applications: [],
      contracts: [],
      depositAgreements: [],
      payments: [],
      disputes: [],
    }
    const snapshot = JSON.stringify(input)

    const first = buildOwnershipTransferPreview(input)
    const second = buildOwnershipTransferPreview(input)

    expect(first.previewHash).toBe(second.previewHash)
    expect(first.manifest).toEqual(second.manifest)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('reports unresolved open workflow owners without changing the manifest shape', () => {
    const result = buildOwnershipTransferPreview({
      targetLandlordId: 'target',
      knownUserIds: new Set(['owner', 'target']),
      apartments: [{ id: 'apartment-1', landlordId: 'owner', version: 'v1' }],
      bookings: [
        {
          id: 'booking-1',
          apartmentId: 'apartment-1',
          landlordId: 'missing-owner',
          status: 'pending',
          version: 'b1',
        },
      ],
      applications: [],
      contracts: [],
      depositAgreements: [],
      payments: [],
      disputes: [],
    })

    expect(result.conflicts).toEqual([
      expect.objectContaining({ code: 'UNKNOWN_BOOKING_OWNER' }),
    ])
    expect(result.manifest.records).toHaveLength(2)
  })
})
