import { getMetadataArgsStorage } from 'typeorm'
import { Payout } from './payout.schema'

describe('Payout persistence schema', () => {
  it('uses unique payment and sparse unique transfer-reference indexes', () => {
    const indexes = getMetadataArgsStorage().indices.filter(
      index => index.target === Payout
    )

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          columns: ['paymentId'],
          unique: true,
        }),
        expect.objectContaining({
          columns: ['txRef'],
          unique: true,
          sparse: true,
        }),
        expect.objectContaining({ columns: ['landlordId', 'createdAt'] }),
      ])
    )
  })
})
