import { getMetadataArgsStorage } from 'typeorm'
import { Payout, payoutSettlementOf } from './payout.schema'

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

describe('payoutSettlementOf', () => {
  it('prefers the stored settlement', () => {
    expect(
      payoutSettlementOf({ settlement: 'external', directReceipt: false })
    ).toBe('external')
  })

  it('derives legacy documents from directReceipt and relayRef', () => {
    expect(payoutSettlementOf({ directReceipt: true })).toBe('direct')
    expect(payoutSettlementOf({ directReceipt: false, relayRef: 'TX' })).toBe(
      'relay'
    )
    expect(payoutSettlementOf({ directReceipt: false })).toBe('relay')
  })
})
