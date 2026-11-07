import { ObjectId } from 'mongodb'
import { buildPaymentLedgerArgs } from './payment-ledger-args'

const HASH = 'a'.repeat(64)
const periodStart = new Date('2026-12-01T00:00:00.000Z')

function payment(
  overrides: Record<string, unknown> = {}
): Parameters<typeof buildPaymentLedgerArgs>[0] {
  return {
    _id: new ObjectId('507f1f77bcf86cd799439011'),
    contractId: 'contract-1',
    amount: 5_000_000,
    paymentHash: HASH,
    type: 'rent' as const,
    periodStart,
    ...overrides,
  }
}

describe('buildPaymentLedgerArgs', () => {
  it('sends 4 args to a chaincode below ABI 3', () => {
    expect(buildPaymentLedgerArgs(payment(), 2)).toEqual([
      '507f1f77bcf86cd799439011',
      'contract-1',
      '5000000',
      HASH,
    ])
  })

  it('adds the period start for a rent invoice on ABI 3', () => {
    expect(buildPaymentLedgerArgs(payment(), 3)).toEqual([
      '507f1f77bcf86cd799439011',
      'contract-1',
      '5000000',
      HASH,
      '2026-12-01T00:00:00.000Z',
    ])
  })

  it('treats an invoice without a type as rent', () => {
    expect(
      buildPaymentLedgerArgs(payment({ type: undefined }), 3)
    ).toHaveLength(5)
  })

  it.each(['penalty', 'deposit', 'deposit-topup', 'platform-fee'] as const)(
    'sends 5 args with an empty period start for a %s invoice on ABI 3 (Fabric enforces the arity)',
    type => {
      const args = buildPaymentLedgerArgs(payment({ type }), 3)
      expect(args).toHaveLength(5)
      expect(args[4]).toBe('')
    }
  )

  it('sends an empty period start for a rent invoice without one on ABI 3', () => {
    const args = buildPaymentLedgerArgs(payment({ periodStart: null }), 3)
    expect(args).toHaveLength(5)
    expect(args[4]).toBe('')
  })

  it.each(['penalty', 'rent'] as const)(
    'keeps exactly 4 args for a %s invoice below ABI 3',
    type => {
      expect(buildPaymentLedgerArgs(payment({ type }), 2)).toHaveLength(4)
    }
  )
})
