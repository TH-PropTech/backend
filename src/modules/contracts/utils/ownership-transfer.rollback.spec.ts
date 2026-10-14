import { checkOwnershipTransferRollback } from './ownership-transfer.rollback'

describe('checkOwnershipTransferRollback', () => {
  it('allows rollback when operational records still match the transfer result', () => {
    expect(
      checkOwnershipTransferRollback([
        {
          entityType: 'apartment',
          entityId: 'apartment-1',
          targetLandlordId: 'successor',
          currentLandlordId: 'successor',
          expectedAfterVersion: 'after-1',
          currentVersion: 'after-1',
        },
      ])
    ).toEqual({ safe: true, conflicts: [] })
  })

  it('blocks rollback after an owner or version mutation', () => {
    const result = checkOwnershipTransferRollback([
      {
        entityType: 'booking',
        entityId: 'booking-1',
        targetLandlordId: 'successor',
        currentLandlordId: 'another-owner',
        expectedAfterVersion: 'after-1',
        currentVersion: 'after-2',
      },
    ])

    expect(result.safe).toBe(false)
    expect(result.conflicts).toEqual([
      'booking/booking-1:version-changed',
      'booking/booking-1:owner-changed',
    ])
  })

  it('never treats immutable legal or financial records as rollback writes', () => {
    expect(
      checkOwnershipTransferRollback([
        {
          entityType: 'contract',
          entityId: 'contract-1',
          targetLandlordId: 'successor',
          currentLandlordId: 'original-owner',
          expectedAfterVersion: 'after-1',
          currentVersion: 'after-2',
        },
      ])
    ).toEqual({ safe: true, conflicts: [] })
  })
})
