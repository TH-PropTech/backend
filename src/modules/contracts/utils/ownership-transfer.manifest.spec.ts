import {
  createOwnershipTransferManifest,
  normalizeOwnershipTransferEmail,
} from './ownership-transfer.manifest'

describe('ownership-transfer manifest helpers', () => {
  it('normalizes target email before account lookup', () => {
    expect(normalizeOwnershipTransferEmail('  OWNER@Example.COM ')).toBe(
      'owner@example.com'
    )
  })

  it('creates the same sorted manifest and hash for the same records', () => {
    const input = {
      targetLandlordId: 'target-1',
      records: [
        {
          entityType: 'booking' as const,
          entityId: 'booking-2',
          fromLandlordId: 'owner-2',
          version: '2026-01-02T00:00:00.000Z',
        },
        {
          entityType: 'apartment' as const,
          entityId: 'apartment-1',
          fromLandlordId: 'owner-1',
          version: '2026-01-01T00:00:00.000Z',
        },
      ],
    }

    const first = createOwnershipTransferManifest(input)
    const second = createOwnershipTransferManifest({
      ...input,
      records: [...input.records].reverse(),
    })

    expect(first).toEqual(second)
    expect(first.manifest.records.map(record => record.entityId)).toEqual([
      'apartment-1',
      'booking-2',
    ])
    expect(first.previewHash).toMatch(/^sha256:[a-f0-9]{64}$/)
  })
})
