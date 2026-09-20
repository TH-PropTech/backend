import { parseTransferLandlordArgs } from './transfer-landlord.args'

describe('parseTransferLandlordArgs', () => {
  it('defaults to a preview for the requested target account', () => {
    expect(parseTransferLandlordArgs([])).toMatchObject({
      apply: false,
      targetEmail: 'tongthachlaptrinh@gmail.com',
    })
  })

  it('accepts explicit preview options', () => {
    expect(
      parseTransferLandlordArgs([
        '--target',
        'owner@example.com',
        '--initiated-by=admin-1',
      ])
    ).toMatchObject({
      targetEmail: 'owner@example.com',
      initiatedBy: 'admin-1',
      apply: false,
    })
  })

  it('requires all apply safeguards', () => {
    expect(() =>
      parseTransferLandlordArgs(['--apply', '--transfer-id', 'transfer-1'])
    ).toThrow(
      '--apply requires --transfer-id, --preview-hash, and --idempotency-key'
    )
  })

  it('accepts a complete apply command', () => {
    expect(
      parseTransferLandlordArgs([
        '--apply',
        '--transfer-id',
        'transfer-1',
        '--preview-hash',
        'sha256:hash',
        '--idempotency-key',
        'manual-transfer-1',
      ])
    ).toMatchObject({
      apply: true,
      transferId: 'transfer-1',
      previewHash: 'sha256:hash',
      idempotencyKey: 'manual-transfer-1',
    })
  })
})
