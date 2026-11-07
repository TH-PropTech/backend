import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Contract } from '../../contracts/schemas/contract.schema'
import type { MoveInSettlement } from '../schemas/move-in-settlement.schema'
import type { MoveOutHandover } from '../schemas/move-out-handover.schema'
import { DAY_MS } from '../utils/move-out.util'
import { MoveOutHandoversService } from './move-out-handovers.service'
import { createMemoryRepo, createSupportMock } from './move-out.fixtures'

const NOW = new Date('2030-03-01T00:00:00.000Z')
const CONTRACT_ID = new ObjectId()
const CID = CONTRACT_ID.toHexString()
const PHOTOS = {
  electricity: ['https://cdn.example.com/dien.jpg'],
  water: ['https://cdn.example.com/nuoc.png'],
}
const INPUT = {
  handedBackAt: '2030-03-01T09:00:00.000Z',
  electricity: 220,
  water: 80,
  keyCount: 2,
  meterPhotos: PHOTOS,
  inventoryItems: [
    {
      name: ' Sofa ',
      quantity: 1,
      condition: 'damaged' as const,
      note: 'Rách',
    },
    { name: 'Tủ lạnh', quantity: 1, condition: 'good' as const },
  ],
  notes: 'Trả đủ',
}

type Ctx = {
  service: MoveOutHandoversService
  repo: ReturnType<typeof createMemoryRepo<MoveOutHandover>>
  support: ReturnType<typeof createSupportMock>
}

function setup(
  options: {
    contract?: Partial<Contract> | null
    baseline?: boolean
    baselineMeter?: { electricity: number; water: number }
    anchor?: boolean
    existing?: MoveOutHandover[]
  } = {}
): Ctx {
  const contract =
    options.contract === null
      ? null
      : ({
          _id: CONTRACT_ID,
          contractCode: 'HD-1',
          tenantId: 'tenant',
          landlordId: 'landlord',
          status: 'active',
          deposit: 10_000_000,
          packageSnapshot: { moveOutPolicy: { responseDays: 5 } },
          ...options.contract,
        } as unknown as Contract)
  const contractRepo = {
    findOne: jest.fn().mockResolvedValue(contract),
  }
  const settlementRepo = createMemoryRepo<MoveInSettlement>(
    options.baseline === false
      ? []
      : ([
          {
            contractId: CID,
            handover: {
              completedAt: NOW,
              ...(options.baselineMeter
                ? { meterReadings: options.baselineMeter }
                : {}),
              inventoryItems: [
                { name: 'sofa', quantity: 1, condition: 'good', note: 'Mới' },
              ],
            },
          },
        ] as unknown as MoveInSettlement[])
  )
  const repo = createMemoryRepo<MoveOutHandover>(options.existing ?? [])
  const support = createSupportMock(options.anchor ?? true)
  const service = new MoveOutHandoversService(
    repo as never,
    contractRepo as never,
    settlementRepo as never,
    support as never
  )
  return { service, repo, support }
}

describe('MoveOutHandoversService', () => {
  describe('record', () => {
    it('stores revision 1 with baseline condition, snapshot responseDays and notifies the tenant', async () => {
      const { service, support } = setup()

      const result = await service.record(CID, 'landlord', INPUT, NOW)

      expect(result).toMatchObject({
        revision: 1,
        status: 'recorded',
        responseDays: 5,
        keyCount: 2,
        meterReadings: { electricity: 220, water: 80 },
      })
      expect(result.responseDueAt).toEqual(new Date(NOW.getTime() + 5 * DAY_MS))
      expect(result.handoverHash).toMatch(/^[a-f0-9]{64}$/)
      expect(result.landlordConfirmation?.hash).toBe(result.handoverHash)
      expect(result.tenantConfirmation).toBeNull()
      expect(result.inventoryItems[0]).toMatchObject({
        conditionAtMoveIn: 'good',
        noteAtMoveIn: 'Mới',
        condition: 'damaged',
      })
      expect(result.inventoryItems[1]).toMatchObject({
        conditionAtMoveIn: null,
        note: null,
      })
      expect(support.notify).toHaveBeenCalledWith(
        ['tenant'],
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ contractId: CID })
      )
    })

    it('stores meter photos and covers them in the handover hash', async () => {
      const other = { ...PHOTOS, water: ['https://cdn.example.com/nuoc-2.png'] }
      const first = await setup().service.record(CID, 'landlord', INPUT, NOW)
      const changed = await setup().service.record(
        CID,
        'landlord',
        { ...INPUT, meterPhotos: other },
        NOW
      )
      expect(first.meterPhotos).toEqual(PHOTOS)
      expect(changed.meterPhotos).toEqual(other)
      expect(changed.handoverHash).not.toBe(first.handoverHash)
      const again = await setup().service.record(CID, 'landlord', INPUT, NOW)
      expect(again.handoverHash).toBe(first.handoverHash)
    })

    it('warns when meters are below the move-in readings until acknowledged', async () => {
      const lower = { ...INPUT, electricity: 100, water: 80 }
      const options = { baselineMeter: { electricity: 150, water: 70 } }
      await expect(
        setup(options).service.record(CID, 'landlord', lower, NOW)
      ).rejects.toMatchObject({
        response: { code: 'METER_READING_REGRESSION' },
      })
      const saved = await setup(options).service.record(
        CID,
        'landlord',
        { ...lower, acknowledgeMeterRegression: true },
        NOW
      )
      expect(saved.meterReadings.electricity).toBe(100)
    })

    it('accepts empty inventory and zero meter readings (boundary)', async () => {
      const { service } = setup()
      const result = await service.record(
        CID,
        'landlord',
        {
          handedBackAt: INPUT.handedBackAt,
          keyCount: 2,
          electricity: 0,
          water: 0,
          meterPhotos: PHOTOS,
        },
        NOW
      )
      expect(result.inventoryItems).toEqual([])
      expect(result.notes).toBeNull()
      expect(result.meterReadings).toEqual({ electricity: 0, water: 0 })
    })

    it('falls back to 3 days when the package snapshot has no moveOutPolicy', async () => {
      const { service } = setup({ contract: { packageSnapshot: null } })
      const result = await service.record(CID, 'landlord', INPUT, NOW)
      expect(result.responseDays).toBe(3)
    })

    it.each([
      ['a tenant', 'tenant'],
      ['an outsider', 'stranger'],
    ])('rejects %s with 403 and stores nothing', async (_l, actor) => {
      const { service, repo } = setup()
      await expect(
        service.record(CID, actor, INPUT, NOW)
      ).rejects.toBeInstanceOf(ForbiddenException)
      expect(repo.save).not.toHaveBeenCalled()
    })

    it('returns 404 for an unknown or malformed contract', async () => {
      await expect(
        setup({ contract: null }).service.record(CID, 'landlord', INPUT)
      ).rejects.toBeInstanceOf(NotFoundException)
      await expect(
        setup().service.record('not-an-id', 'landlord', INPUT)
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('returns 409 when the contract is not active or terminated', async () => {
      const { service } = setup({ contract: { status: 'draft' } })
      await expect(
        service.record(CID, 'landlord', INPUT)
      ).rejects.toBeInstanceOf(ConflictException)
      const noStatus = setup({ contract: { status: 'draft' } })
      await expect(
        noStatus.service.record(CID, 'landlord', INPUT)
      ).rejects.toBeInstanceOf(ConflictException)
    })

    it('allows a terminated contract', async () => {
      const { service } = setup({ contract: { status: 'terminated' } })
      await expect(
        service.record(CID, 'landlord', INPUT, NOW)
      ).resolves.toMatchObject({ status: 'recorded' })
    })

    it('returns 409 when the move-in handover is not completed', async () => {
      const { service } = setup({ baseline: false })
      await expect(
        service.record(CID, 'landlord', INPUT)
      ).rejects.toMatchObject({ message: 'MOVE_IN_HANDOVER_NOT_COMPLETED' })
    })

    it('returns 409 when a concurrent request wins the unique index', async () => {
      const { service, repo } = setup()
      jest.spyOn(repo, 'save').mockRejectedValueOnce({ code: 11000 })
      await expect(
        service.record(CID, 'landlord', INPUT)
      ).rejects.toMatchObject({ message: 'MOVE_OUT_HANDOVER_EXISTS' })
    })

    it('rethrows other save errors untouched', async () => {
      const { service, repo } = setup()
      const failure = new Error('disk full')
      jest.spyOn(repo, 'save').mockRejectedValueOnce(failure)
      await expect(service.record(CID, 'landlord', INPUT)).rejects.toBe(failure)
    })

    it('returns 409 when a handover already exists', async () => {
      const { service } = setup({
        existing: [{ contractId: CID } as MoveOutHandover],
      })
      await expect(
        service.record(CID, 'landlord', INPUT)
      ).rejects.toMatchObject({ message: 'MOVE_OUT_HANDOVER_EXISTS' })
    })
  })

  describe('revise', () => {
    it('creates revision 2, keeps history, resets confirmation and deadline', async () => {
      const { service } = setup()
      const first = await service.record(CID, 'landlord', INPUT, NOW)
      const firstHash = first.handoverHash
      const later = new Date(NOW.getTime() + DAY_MS)

      const revised = await service.revise(
        CID,
        'landlord',
        { ...INPUT, keyCount: 3 },
        later
      )

      expect(revised.revision).toBe(2)
      expect(revised.handoverHash).not.toBe(firstHash)
      expect(revised.revisionHistory).toHaveLength(1)
      expect(revised.revisionHistory[0]).toMatchObject({
        revision: 1,
        handoverHash: firstHash,
      })
      expect(revised.tenantConfirmation).toBeNull()
      expect(revised.responseDueAt).toEqual(
        new Date(later.getTime() + 5 * DAY_MS)
      )
    })

    it('rejects a non-landlord, a missing record, a completed or disputed record', async () => {
      const { service } = setup()
      await expect(
        service.revise(CID, 'landlord', INPUT)
      ).rejects.toBeInstanceOf(NotFoundException)
      const rec = await service.record(CID, 'landlord', INPUT, NOW)
      await expect(service.revise(CID, 'tenant', INPUT)).rejects.toBeInstanceOf(
        ForbiddenException
      )
      await service.dispute(CID, 'tenant', 'sai', NOW)
      await expect(
        service.revise(CID, 'landlord', INPUT)
      ).rejects.toMatchObject({ message: 'MOVE_OUT_HANDOVER_DISPUTED' })
      rec.status = 'completed'
      await expect(
        service.revise(CID, 'landlord', INPUT)
      ).rejects.toMatchObject({
        message: 'MOVE_OUT_HANDOVER_COMPLETED_IMMUTABLE',
      })
    })
  })

  describe('confirm', () => {
    it('completes with both-confirmed, anchors evidence and notifies both parties', async () => {
      const { service, support } = setup()
      const rec = await service.record(CID, 'landlord', INPUT, NOW)

      const done = await service.confirm(CID, 'tenant', rec.handoverHash, NOW)

      expect(done).toMatchObject({
        status: 'completed',
        completionReason: 'both-confirmed',
      })
      expect(done.evidence?.ledgerStatus).toBe('pending')
      expect(support.enqueueLedger).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateType: 'move-out-handover',
          action: 'recordHandover',
          contractId: CID,
        })
      )
      expect(support.notify).toHaveBeenLastCalledWith(
        ['tenant', 'landlord'],
        expect.any(String),
        expect.any(String),
        expect.any(Object)
      )
    })

    it('skips ledger anchoring when no outbox is available', async () => {
      const { service, support } = setup({ anchor: false })
      const rec = await service.record(CID, 'landlord', INPUT, NOW)
      const done = await service.confirm(CID, 'tenant', rec.handoverHash, NOW)
      expect(done.status).toBe('completed')
      expect(done.evidence).toBeNull()
      expect(support.enqueueLedger).not.toHaveBeenCalled()
    })

    it('keeps business state when anchoring throws', async () => {
      const { service, support } = setup()
      support.enqueueLedger.mockRejectedValueOnce(new Error('down'))
      const rec = await service.record(CID, 'landlord', INPUT, NOW)
      await expect(
        service.confirm(CID, 'tenant', rec.handoverHash, NOW)
      ).resolves.toMatchObject({ status: 'completed' })
    })

    it('is idempotent once completed', async () => {
      const { service, repo } = setup()
      const rec = await service.record(CID, 'landlord', INPUT, NOW)
      await service.confirm(CID, 'tenant', rec.handoverHash, NOW)
      const saves = repo.save.mock.calls.length
      await service.confirm(CID, 'tenant', rec.handoverHash, NOW)
      expect(repo.save.mock.calls.length).toBe(saves)
    })

    it('rejects a stale hash, an open discrepancy, a landlord and a disputed record', async () => {
      const { service } = setup()
      const rec = await service.record(CID, 'landlord', INPUT, NOW)
      await expect(
        service.confirm(CID, 'landlord', rec.handoverHash)
      ).rejects.toBeInstanceOf(ForbiddenException)
      await expect(
        service.confirm(CID, 'tenant', 'b'.repeat(64))
      ).rejects.toMatchObject({ message: 'MOVE_OUT_REVISION_STALE' })
      await service.reportDiscrepancy(
        CID,
        'tenant',
        rec.handoverHash,
        ' sai ',
        NOW
      )
      await expect(
        service.confirm(CID, 'tenant', rec.handoverHash)
      ).rejects.toMatchObject({ message: 'MOVE_OUT_DISCREPANCY_OPEN' })
      await service.dispute(CID, 'landlord', 'x', NOW)
      await expect(
        service.confirm(CID, 'tenant', rec.handoverHash)
      ).rejects.toMatchObject({ message: 'MOVE_OUT_HANDOVER_DISPUTED' })
    })

    it('returns 404 when nothing is recorded', async () => {
      await expect(
        setup().service.confirm(CID, 'tenant', 'a'.repeat(64))
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('rejects confirming a stale revision after the landlord revised', async () => {
      const { service } = setup()
      const rec = await service.record(CID, 'landlord', INPUT, NOW)
      const oldHash = rec.handoverHash
      await service.revise(CID, 'landlord', { ...INPUT, water: 90 }, NOW)
      await expect(
        service.confirm(CID, 'tenant', oldHash)
      ).rejects.toMatchObject({ message: 'MOVE_OUT_REVISION_STALE' })
    })
  })

  describe('reportDiscrepancy', () => {
    it('appends the discrepancy for the current revision and notifies the landlord', async () => {
      const { service, support } = setup()
      const rec = await service.record(CID, 'landlord', INPUT, NOW)
      const result = await service.reportDiscrepancy(
        CID,
        'tenant',
        rec.handoverHash,
        ' Công tơ sai ',
        NOW
      )
      expect(result.discrepancies).toEqual([
        { revision: 1, note: 'Công tơ sai', at: NOW },
      ])
      expect(result.status).toBe('recorded')
      expect(support.notify).toHaveBeenLastCalledWith(
        ['landlord'],
        expect.any(String),
        expect.any(String),
        expect.any(Object)
      )
    })

    it('rejects landlord, stale hash and finished records', async () => {
      const { service } = setup()
      const rec = await service.record(CID, 'landlord', INPUT, NOW)
      await expect(
        service.reportDiscrepancy(CID, 'landlord', rec.handoverHash, 'x')
      ).rejects.toBeInstanceOf(ForbiddenException)
      await expect(
        service.reportDiscrepancy(CID, 'tenant', 'c'.repeat(64), 'x')
      ).rejects.toMatchObject({ message: 'MOVE_OUT_REVISION_STALE' })
      await service.confirm(CID, 'tenant', rec.handoverHash, NOW)
      await expect(
        service.reportDiscrepancy(CID, 'tenant', rec.handoverHash, 'x')
      ).rejects.toMatchObject({
        message: 'MOVE_OUT_HANDOVER_COMPLETED_IMMUTABLE',
      })
    })
  })

  describe('dispute', () => {
    it('lets the tenant or the landlord dispute and notifies both', async () => {
      const { service, support } = setup()
      await service.record(CID, 'landlord', INPUT, NOW)
      const result = await service.dispute(CID, 'tenant', ' không đúng ', NOW)
      expect(result).toMatchObject({
        status: 'disputed',
        dispute: { by: 'tenant', note: 'không đúng', at: NOW },
      })
      expect(support.notify).toHaveBeenLastCalledWith(
        ['tenant', 'landlord'],
        expect.any(String),
        expect.any(String),
        expect.any(Object)
      )
    })

    it('rejects outsiders, double disputes and completed records', async () => {
      const { service } = setup()
      const rec = await service.record(CID, 'landlord', INPUT, NOW)
      await expect(
        service.dispute(CID, 'stranger', 'x')
      ).rejects.toBeInstanceOf(ForbiddenException)
      await service.dispute(CID, 'landlord', 'x', NOW)
      await expect(service.dispute(CID, 'tenant', 'x')).rejects.toMatchObject({
        message: 'MOVE_OUT_HANDOVER_DISPUTED',
      })
      rec.status = 'completed'
      await expect(service.dispute(CID, 'tenant', 'x')).rejects.toMatchObject({
        message: 'MOVE_OUT_HANDOVER_COMPLETED_IMMUTABLE',
      })
    })
  })

  describe('processResponseDeadlines', () => {
    it('completes expired records with tenant-no-response and is idempotent', async () => {
      const { service } = setup()
      const rec = await service.record(CID, 'landlord', INPUT, NOW)
      const after = new Date(NOW.getTime() + 5 * DAY_MS)

      expect(await service.processResponseDeadlines(after)).toBe(1)
      expect(rec).toMatchObject({
        status: 'completed',
        completionReason: 'tenant-no-response',
      })
      expect(await service.processResponseDeadlines(after)).toBe(0)
    })

    it('leaves records before the deadline, with a discrepancy or disputed', async () => {
      const { service } = setup()
      const rec = await service.record(CID, 'landlord', INPUT, NOW)
      const after = new Date(NOW.getTime() + 6 * DAY_MS)
      expect(
        await service.processResponseDeadlines(new Date(NOW.getTime() + DAY_MS))
      ).toBe(0)
      await service.reportDiscrepancy(CID, 'tenant', rec.handoverHash, 'x', NOW)
      expect(await service.processResponseDeadlines(after)).toBe(0)
      expect(rec.status).toBe('recorded')
      await service.dispute(CID, 'tenant', 'x', NOW)
      expect(await service.processResponseDeadlines(after)).toBe(0)
    })
  })

  describe('access and PDF', () => {
    it('lets parties and staff read, rejects outsiders, 404 when missing', async () => {
      const { service } = setup()
      await expect(
        service.findByContract(CID, 'tenant', false)
      ).rejects.toBeInstanceOf(NotFoundException)
      await service.record(CID, 'landlord', INPUT, NOW)
      await expect(
        service.findByContract(CID, 'tenant', false)
      ).resolves.toBeDefined()
      await expect(
        service.findByContract(CID, 'x', true)
      ).resolves.toBeDefined()
      await expect(
        service.findByContract(CID, 'x', false)
      ).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('renders a PDF only once the handover is completed', async () => {
      const { service } = setup()
      const rec = await service.record(CID, 'landlord', INPUT, NOW)
      await expect(service.getPdf(CID, 'tenant', false)).rejects.toMatchObject({
        message: 'MOVE_OUT_HANDOVER_NOT_COMPLETED',
      })
      await service.confirm(CID, 'tenant', rec.handoverHash, NOW)
      const { buffer, contractCode } = await service.getPdf(
        CID,
        'landlord',
        false
      )
      expect(contractCode).toBe('HD-1')
      expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
    })
  })
})
