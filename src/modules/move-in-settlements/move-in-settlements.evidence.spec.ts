import { ObjectId } from 'mongodb'
import { MoveInSettlementsService } from './move-in-settlements.service'
import type { MoveInSettlement } from './schemas/move-in-settlement.schema'
import {
  buildMoveInSettlementEvidenceEnvelope,
  hashMoveInSettlementEvidenceEnvelope,
} from '../fabric/move-in-evidence-envelope'
import {
  buildMoveInHandoverEvidenceEnvelope,
  hashMoveInHandoverEvidenceEnvelope,
} from '../fabric/move-in-handover-evidence-envelope'

describe('MoveInSettlementsService ledger evidence producers (PROP-399 D3, tasks 5.1-5.3)', () => {
  const HASH = 'a'.repeat(64)
  const contractId = '507f1f77bcf86cd799439011'
  const settlementId = '507f1f77bcf86cd799439022'
  const parentKey = `contract:${contractId}:contract.activated`

  type EnqueueInput = {
    aggregateType: string
    aggregateId: string
    eventType: string
    action: string
    args: string[]
    dependencyKeys?: string[]
    dependencyKey?: string | null
    metadata?: Record<string, unknown>
  }

  function firstEnqueue(outbox: { enqueue: jest.Mock }): EnqueueInput {
    const calls = outbox.enqueue.mock.calls as unknown as Array<[EnqueueInput]>
    return calls[0]![0]
  }

  function build(): {
    service: MoveInSettlementsService
    settlementRepo: { findOne: jest.Mock; save: jest.Mock }
    outbox: { enqueue: jest.Mock }
  } {
    const settlementRepo = {
      findOne: jest.fn(),
      save: jest.fn(
        (value: unknown): Promise<unknown> => Promise.resolve(value)
      ),
    }
    const outbox = { enqueue: jest.fn().mockResolvedValue({}) }
    const service = new MoveInSettlementsService(
      settlementRepo as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      outbox as never
    )
    return { service, settlementRepo, outbox }
  }

  function paidSettlement(
    overrides: Record<string, unknown> = {}
  ): MoveInSettlement {
    return {
      _id: new ObjectId(settlementId),
      contractId,
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      status: 'paid',
      total: 44_000_000,
      statementHash: HASH,
      lines: [
        {
          kind: 'DEPOSIT_TOPUP',
          amount: 14_000_000,
          paymentId: 'pay-1',
          paidAt: new Date('2030-01-02T00:00:00.000Z'),
        },
        {
          kind: 'FIRST_RENT',
          amount: 30_000_000,
          paymentId: 'pay-2',
          paidAt: new Date('2030-01-03T00:00:00.000Z'),
        },
      ],
      handover: null,
      ...overrides,
    } as unknown as MoveInSettlement
  }

  describe('recordSettlementPaidEvidence', () => {
    it.each(['pending', 'partially-paid', 'overdue', 'cancelled'])(
      'produces no evidence while the settlement is %s',
      async status => {
        const { service, settlementRepo, outbox } = build()
        await service.recordSettlementPaidEvidence(paidSettlement({ status }))
        expect(outbox.enqueue).not.toHaveBeenCalled()
        expect(settlementRepo.save).not.toHaveBeenCalled()
      }
    )

    it('persists settlementEvidence BEFORE enqueueing exactly one move-in.settled item with the contract parent', async () => {
      const { service, settlementRepo, outbox } = build()
      const settlement = paidSettlement()

      await service.recordSettlementPaidEvidence(settlement)

      expect(settlement.settlementEvidence).toEqual({
        manifestVersion: 1,
        manifestHash: expect.stringMatching(/^[a-f0-9]{64}$/) as string,
        ledgerStatus: 'pending',
        txHash: null,
        blockNumber: null,
        recordedAt: expect.any(Date) as Date,
      })
      expect(settlementRepo.save).toHaveBeenCalledWith(settlement)
      expect(settlementRepo.save.mock.invocationCallOrder[0]).toBeLessThan(
        outbox.enqueue.mock.invocationCallOrder[0] ?? Infinity
      )
      expect(outbox.enqueue).toHaveBeenCalledTimes(1)
      const input = firstEnqueue(outbox)
      expect(input).toMatchObject({
        aggregateType: 'move-in-settlement',
        aggregateId: settlementId,
        eventType: 'move-in.settled',
        action: 'recordMoveInSettlement',
        dependencyKeys: [parentKey],
      })
      expect(input.dependencyKey ?? null).toBeNull()
      expect(input.args).toEqual([
        settlementId,
        contractId,
        settlement.settlementEvidence?.manifestHash,
        '1',
        '2030-01-03T00:00:00.000Z',
      ])
    })

    it('hashes the canonical settlement manifest (statementHash, lines, total, latest paid time)', async () => {
      const { service } = build()
      const settlement = paidSettlement()
      await service.recordSettlementPaidEvidence(settlement)
      expect(settlement.settlementEvidence?.manifestHash).toBe(
        hashMoveInSettlementEvidenceEnvelope(
          buildMoveInSettlementEvidenceEnvelope({
            settlementId,
            contractId,
            statementHash: HASH,
            lines: [
              { kind: 'DEPOSIT_TOPUP', amount: 14_000_000, paymentId: 'pay-1' },
              { kind: 'FIRST_RENT', amount: 30_000_000, paymentId: 'pay-2' },
            ],
            total: 44_000_000,
            paidAt: '2030-01-03T00:00:00.000Z',
          })
        )
      )
    })

    it('never puts lines, amounts, payment ids or party ids into the outbox input', async () => {
      const { service, outbox } = build()
      await service.recordSettlementPaidEvidence(paidSettlement())
      const serialized = JSON.stringify(outbox.enqueue.mock.calls)
      for (const leaked of [
        'DEPOSIT_TOPUP',
        'FIRST_RENT',
        'pay-1',
        'tenant-1',
        'landlord-1',
        '14000000',
        '44000000',
      ]) {
        expect(serialized).not.toContain(leaked)
      }
    })

    it('is idempotent: a settlement that already carries evidence enqueues nothing', async () => {
      const { service, outbox, settlementRepo } = build()
      const settlement = paidSettlement({
        settlementEvidence: {
          manifestVersion: 1,
          manifestHash: HASH,
          ledgerStatus: 'pending',
          txHash: null,
          blockNumber: null,
          recordedAt: new Date(),
        },
      })
      await service.recordSettlementPaidEvidence(settlement)
      expect(outbox.enqueue).not.toHaveBeenCalled()
      expect(settlementRepo.save).not.toHaveBeenCalled()
    })

    it('does not fail the business transition when the outbox is down (evidence stays pending for reconciliation)', async () => {
      const { service, outbox } = build()
      outbox.enqueue.mockRejectedValue(new Error('mongo down'))
      const settlement = paidSettlement()
      await expect(
        service.recordSettlementPaidEvidence(settlement)
      ).resolves.toBeUndefined()
      expect(settlement.settlementEvidence?.ledgerStatus).toBe('pending')
    })

    it('does not enqueue when persisting the evidence reference fails', async () => {
      const { service, outbox, settlementRepo } = build()
      settlementRepo.save.mockRejectedValue(new Error('write failed'))
      await expect(
        service.recordSettlementPaidEvidence(paidSettlement())
      ).resolves.toBeUndefined()
      expect(outbox.enqueue).not.toHaveBeenCalled()
    })

    it('is a no-op when the ledger outbox is not wired', async () => {
      const service = new MoveInSettlementsService(
        {} as never,
        {} as never,
        {} as never,
        {} as never
      )
      await expect(
        service.recordSettlementPaidEvidence(paidSettlement())
      ).resolves.toBeUndefined()
    })
  })

  describe('confirmHandover evidence', () => {
    function recordedSettlement(
      extra: Record<string, unknown> = {}
    ): MoveInSettlement {
      return {
        _id: new ObjectId(settlementId),
        contractId,
        tenantId: 'tenant',
        landlordId: 'landlord',
        status: 'paid',
        handover: {
          revision: 2,
          handedOverAt: new Date('2030-01-01T00:00:00.000Z'),
          meterReadings: { electricity: 123, water: 456 },
          keyCount: 7,
          inventoryReference: 'INV-SECRET-REF',
          notes: 'PRIVATE NOTE',
          handoverHash: HASH,
          recordedBy: 'landlord',
          tenantConfirmation: null,
          landlordConfirmation: null,
          discrepancyNote: null,
          overrideReason: null,
          completedAt: null,
          ...extra,
        },
      } as unknown as MoveInSettlement
    }

    it('enqueues nothing after only one confirmation', async () => {
      const { service, settlementRepo, outbox } = build()
      settlementRepo.findOne.mockResolvedValue(recordedSettlement())
      await service.confirmHandover(settlementId, 'tenant', 'tenant', HASH)
      expect(outbox.enqueue).not.toHaveBeenCalled()
    })

    it('persists handoverEvidence and enqueues exactly one handover.completed item when the second confirmation completes it', async () => {
      const { service, settlementRepo, outbox } = build()
      settlementRepo.findOne.mockResolvedValue(recordedSettlement())
      await service.confirmHandover(settlementId, 'tenant', 'tenant', HASH)
      const done = await service.confirmHandover(
        settlementId,
        'landlord',
        'landlord',
        HASH
      )

      expect(done.handoverEvidence).toEqual({
        manifestVersion: 1,
        manifestHash: expect.stringMatching(/^[a-f0-9]{64}$/) as string,
        ledgerStatus: 'pending',
        txHash: null,
        blockNumber: null,
        recordedAt: expect.any(Date) as Date,
      })
      expect(outbox.enqueue).toHaveBeenCalledTimes(1)
      const input = firstEnqueue(outbox)
      expect(input).toMatchObject({
        aggregateType: 'move-in-handover',
        aggregateId: settlementId,
        eventType: 'handover.completed',
        action: 'recordHandover',
        dependencyKeys: [parentKey],
      })
      const completedAt = done.handover?.completedAt?.toISOString() ?? ''
      expect(input.args).toEqual([
        settlementId,
        contractId,
        HASH,
        '1',
        '2',
        'false',
        completedAt,
      ])
      expect(done.handoverEvidence?.manifestHash).toBe(
        hashMoveInHandoverEvidenceEnvelope(
          buildMoveInHandoverEvidenceEnvelope({
            settlementId,
            contractId,
            revision: 2,
            handoverHash: HASH,
            tenantConfirmationHash: HASH,
            landlordConfirmationHash: HASH,
            completedAt,
            overrideUsed: false,
          })
        )
      )
    })

    it('flags overrideUsed without ever sending the override reason, meter readings, key count, inventory, notes or discrepancy note', async () => {
      const { service, settlementRepo, outbox } = build()
      settlementRepo.findOne.mockResolvedValue(
        recordedSettlement({ overrideReason: 'STAFF OVERRIDE TEXT' })
      )
      await service.confirmHandover(settlementId, 'tenant', 'tenant', HASH)
      await service.confirmHandover(
        settlementId,
        'landlord',
        'landlord',
        HASH,
        'DISCREPANCY TEXT'
      )
      const input = firstEnqueue(outbox)
      expect(input.args[5]).toBe('true')
      const serialized = JSON.stringify(input)
      for (const leaked of [
        'STAFF OVERRIDE TEXT',
        'DISCREPANCY TEXT',
        'PRIVATE NOTE',
        'INV-SECRET-REF',
      ]) {
        expect(serialized).not.toContain(leaked)
      }
    })

    it('enqueues nothing for a repeated confirmation after completion', async () => {
      const { service, settlementRepo, outbox } = build()
      settlementRepo.findOne.mockResolvedValue(recordedSettlement())
      await service.confirmHandover(settlementId, 'tenant', 'tenant', HASH)
      await service.confirmHandover(settlementId, 'landlord', 'landlord', HASH)
      await service.confirmHandover(settlementId, 'landlord', 'landlord', HASH)
      expect(outbox.enqueue).toHaveBeenCalledTimes(1)
    })

    it('completes the handover even when the outbox fails', async () => {
      const { service, settlementRepo, outbox } = build()
      outbox.enqueue.mockRejectedValue(new Error('mongo down'))
      settlementRepo.findOne.mockResolvedValue(recordedSettlement())
      await service.confirmHandover(settlementId, 'tenant', 'tenant', HASH)
      const done = await service.confirmHandover(
        settlementId,
        'landlord',
        'landlord',
        HASH
      )
      expect(done.handover?.completedAt).toBeInstanceOf(Date)
    })
  })
})
