import { ObjectId } from 'mongodb'
import { FabricGovernanceService } from './fabric-governance.service'

describe('FabricGovernanceService.ensureLedgerEvidenceQueued (PROP-399 D7 repair)', () => {
  const HASH = 'a'.repeat(64)

  function build(snapshot: Record<string, unknown> | null): {
    service: FabricGovernanceService
    outbox: { enqueue: jest.Mock }
    created: { _id: ObjectId }
  } {
    const created = { _id: new ObjectId() }
    const outbox = { enqueue: jest.fn().mockResolvedValue(created) }
    const service = new FabricGovernanceService(
      { findOne: jest.fn().mockResolvedValue(snapshot) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      outbox as never,
      {} as never,
      {} as never
    )
    return { service, outbox, created }
  }

  function snapshot(
    extra: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      _id: new ObjectId(),
      status: 'published',
      snapshotCode: 'GOV-000001',
      version: 1,
      manifestHash: HASH,
      manifestSchemaVersion: 1,
      ...extra,
    }
  }

  it('re-enqueues the privacy-safe governance item and returns the outbox row', async () => {
    const row = snapshot()
    const { service, outbox, created } = build(row)
    const id = (row._id as ObjectId).toHexString()

    await expect(service.ensureLedgerEvidenceQueued(id)).resolves.toBe(created)

    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateType: 'governance-snapshot',
        aggregateId: id,
        eventType: 'governance.published',
        action: 'publishGovernanceSnapshot',
        args: [id, '1', HASH, '1'],
      })
    )
  })

  it('returns null (stale precondition) for a missing snapshot, a malformed id or an unpublished snapshot', async () => {
    for (const row of [null, snapshot({ status: 'draft' })]) {
      const { service, outbox } = build(row)
      await expect(
        service.ensureLedgerEvidenceQueued(new ObjectId().toHexString())
      ).resolves.toBeNull()
      expect(outbox.enqueue).not.toHaveBeenCalled()
    }
    const { service, outbox } = build(snapshot())
    await expect(service.ensureLedgerEvidenceQueued('nope')).resolves.toBeNull()
    expect(outbox.enqueue).not.toHaveBeenCalled()
  })
})
