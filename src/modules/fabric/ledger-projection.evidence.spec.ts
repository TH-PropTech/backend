import { ObjectId } from 'mongodb'
import { LedgerProjectionService } from './ledger-projection.service'
import type { LedgerOutbox } from './schemas/ledger-outbox.schema'

describe('LedgerProjectionService PROP-399 evidence families (task 5.5)', () => {
  const evidence = {
    manifestVersion: 1,
    manifestHash: 'a'.repeat(64),
    ledgerStatus: 'pending' as string,
    txHash: null as string | null,
    blockNumber: null as number | null,
    recordedAt: new Date('2030-01-01T00:00:00.000Z'),
  }

  function build(): {
    service: LedgerProjectionService
    governanceRepo: { findOne: jest.Mock; save: jest.Mock }
    settlementRepo: { findOne: jest.Mock; save: jest.Mock }
  } {
    const repo = (): { findOne: jest.Mock; save: jest.Mock } => ({
      findOne: jest.fn(),
      save: jest.fn((doc: unknown): Promise<unknown> => Promise.resolve(doc)),
    })
    const governanceRepo = repo()
    const settlementRepo = repo()
    const service = new LedgerProjectionService(
      repo() as never,
      repo() as never,
      repo() as never,
      undefined,
      governanceRepo as never,
      settlementRepo as never
    )
    return { service, governanceRepo, settlementRepo }
  }

  function event(aggregateType: string, id = new ObjectId()): LedgerOutbox {
    return {
      _id: new ObjectId(),
      aggregateType,
      aggregateId: id.toHexString(),
    } as LedgerOutbox
  }

  describe('governance-snapshot', () => {
    it('projects a Fabric commit with the authentic tx and block number', async () => {
      const { service, governanceRepo } = build()
      const snapshot = {
        ledgerStatus: 'pending',
        txHash: null,
        blockNumber: null,
      }
      governanceRepo.findOne.mockResolvedValue(snapshot)

      await service.projectResult(event('governance-snapshot'), {
        txHash: 'fabric-tx-1',
        blockNumber: 42,
        networkMode: 'fabric',
      })

      expect(snapshot).toEqual({
        ledgerStatus: 'confirmed-fabric',
        txHash: 'fabric-tx-1',
        blockNumber: 42,
      })
      expect(governanceRepo.save).toHaveBeenCalledWith(snapshot)
    })

    it('keeps a null block number when Fabric did not report one', async () => {
      const { service, governanceRepo } = build()
      const snapshot = {
        ledgerStatus: 'pending',
        txHash: null,
        blockNumber: null,
      }
      governanceRepo.findOne.mockResolvedValue(snapshot)
      await service.projectResult(event('governance-snapshot'), {
        txHash: 'fabric-tx-1',
        blockNumber: null,
        networkMode: 'fabric',
      })
      expect(snapshot.blockNumber).toBeNull()
    })

    it('never synthesizes a tx hash or block number in simulation', async () => {
      const { service, governanceRepo } = build()
      const snapshot = {
        ledgerStatus: 'pending',
        txHash: null,
        blockNumber: null,
      }
      governanceRepo.findOne.mockResolvedValue(snapshot)

      await service.projectResult(event('governance-snapshot'), {
        txHash: 'sim_deadbeef',
        blockNumber: 99,
        networkMode: 'simulation',
      })

      expect(snapshot).toEqual({
        ledgerStatus: 'confirmed-simulation',
        txHash: null,
        blockNumber: null,
      })
    })

    it('ignores a non-positive or non-integer block number', async () => {
      const { service, governanceRepo } = build()
      const snapshot = {
        ledgerStatus: 'pending',
        txHash: null,
        blockNumber: null,
      }
      governanceRepo.findOne.mockResolvedValue(snapshot)
      await service.projectResult(event('governance-snapshot'), {
        txHash: 'fabric-tx-1',
        blockNumber: 0,
        networkMode: 'fabric',
      })
      expect(snapshot.blockNumber).toBeNull()
    })

    it('projects a terminal failure to failed-terminal without touching tx data', async () => {
      const { service, governanceRepo } = build()
      const snapshot = {
        ledgerStatus: 'pending',
        txHash: null,
        blockNumber: null,
      }
      governanceRepo.findOne.mockResolvedValue(snapshot)
      await service.projectFailure(event('governance-snapshot'))
      expect(snapshot).toEqual({
        ledgerStatus: 'failed-terminal',
        txHash: null,
        blockNumber: null,
      })
    })

    it('does nothing when the snapshot no longer exists', async () => {
      const { service, governanceRepo } = build()
      governanceRepo.findOne.mockResolvedValue(null)
      await expect(
        service.projectResult(event('governance-snapshot'), {
          txHash: 'tx',
          networkMode: 'fabric',
        })
      ).resolves.toBeUndefined()
      expect(governanceRepo.save).not.toHaveBeenCalled()
    })
  })

  describe.each([
    ['move-in-settlement', 'settlementEvidence'],
    ['move-in-handover', 'handoverEvidence'],
  ] as const)('%s', (aggregateType, field) => {
    it(`projects confirmation into ${field} (Fabric: real tx/block)`, async () => {
      const { service, settlementRepo } = build()
      const settlement: Record<string, unknown> = {
        [field]: { ...evidence },
      }
      settlementRepo.findOne.mockResolvedValue(settlement)

      await service.projectResult(event(aggregateType), {
        txHash: 'fabric-tx-9',
        blockNumber: 17,
        networkMode: 'fabric',
      })

      expect(settlement[field]).toEqual({
        ...evidence,
        ledgerStatus: 'confirmed-fabric',
        txHash: 'fabric-tx-9',
        blockNumber: 17,
      })
      expect(settlementRepo.save).toHaveBeenCalledWith(settlement)
    })

    it('labels simulation honestly with no tx hash or block number', async () => {
      const { service, settlementRepo } = build()
      const settlement: Record<string, unknown> = { [field]: { ...evidence } }
      settlementRepo.findOne.mockResolvedValue(settlement)
      await service.projectResult(event(aggregateType), {
        txHash: 'sim_cafe',
        blockNumber: 5,
        networkMode: 'simulation',
      })
      expect(settlement[field]).toMatchObject({
        ledgerStatus: 'confirmed-simulation',
        txHash: null,
        blockNumber: null,
        manifestHash: evidence.manifestHash,
      })
    })

    it('projects a terminal failure and leaves other evidence untouched', async () => {
      const { service, settlementRepo } = build()
      const settlement: Record<string, unknown> = {
        [field]: { ...evidence },
        other: 'kept',
      }
      settlementRepo.findOne.mockResolvedValue(settlement)
      await service.projectFailure(event(aggregateType))
      expect(settlement[field]).toMatchObject({
        ledgerStatus: 'failed-terminal',
      })
      expect(settlement.other).toBe('kept')
    })

    it('does not fabricate evidence when the record has none', async () => {
      const { service, settlementRepo } = build()
      const settlement: Record<string, unknown> = {}
      settlementRepo.findOne.mockResolvedValue(settlement)
      await service.projectResult(event(aggregateType), {
        txHash: 'tx',
        networkMode: 'fabric',
      })
      expect(settlement[field]).toBeUndefined()
      expect(settlementRepo.save).not.toHaveBeenCalled()
    })
  })

  it('does not touch the other family when projecting a settlement or handover', async () => {
    const { service, settlementRepo } = build()
    const settlement: Record<string, unknown> = {
      settlementEvidence: { ...evidence },
      handoverEvidence: { ...evidence },
    }
    settlementRepo.findOne.mockResolvedValue(settlement)
    await service.projectResult(event('move-in-handover'), {
      txHash: 'tx',
      blockNumber: 3,
      networkMode: 'fabric',
    })
    expect(settlement.settlementEvidence).toMatchObject({
      ledgerStatus: 'pending',
    })
    expect(settlement.handoverEvidence).toMatchObject({
      ledgerStatus: 'confirmed-fabric',
    })
  })

  it('degrades to a no-op when the optional repositories are not wired', async () => {
    const repo = { findOne: jest.fn(), save: jest.fn() }
    const service = new LedgerProjectionService(
      repo as never,
      repo as never,
      repo as never
    )
    await expect(
      service.projectResult(event('governance-snapshot'), {
        txHash: 'tx',
        networkMode: 'fabric',
      })
    ).resolves.toBeUndefined()
    await expect(
      service.projectFailure(event('move-in-settlement'))
    ).resolves.toBeUndefined()
    expect(repo.findOne).not.toHaveBeenCalled()
  })
})
