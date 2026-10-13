import { ConflictException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { MoveInSettlementsService } from './move-in-settlements.service'
import type { MoveInSettlement } from '../schemas/move-in-settlement.schema'
import {
  buildMoveInSettlementEvidenceEnvelope,
  hashMoveInSettlementEvidenceEnvelope,
} from '../../fabric/utils/move-in-evidence-envelope'

describe('MoveInSettlementsService repair producers (PROP-399 D7)', () => {
  const HASH = 'a'.repeat(64)
  const contractId = '507f1f77bcf86cd799439011'
  const settlementId = '507f1f77bcf86cd799439022'

  function build(row: Record<string, unknown> | null): {
    service: MoveInSettlementsService
    repo: { findOne: jest.Mock; save: jest.Mock }
    outbox: { enqueue: jest.Mock }
    created: { _id: ObjectId }
  } {
    const repo = {
      findOne: jest.fn().mockResolvedValue(row),
      save: jest.fn((v: unknown): Promise<unknown> => Promise.resolve(v)),
    }
    const created = { _id: new ObjectId() }
    const outbox = { enqueue: jest.fn().mockResolvedValue(created) }
    const service = new MoveInSettlementsService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      outbox as never
    )
    return { service, repo, outbox, created }
  }

  function paid(extra: Record<string, unknown> = {}): MoveInSettlement {
    return {
      _id: new ObjectId(settlementId),
      contractId,
      status: 'paid',
      total: 10,
      statementHash: HASH,
      lines: [
        {
          kind: 'FIRST_RENT',
          amount: 10,
          paymentId: 'p-1',
          paidAt: new Date('2030-01-03T00:00:00.000Z'),
        },
      ],
      handover: null,
      ...extra,
    } as unknown as MoveInSettlement
  }

  function expectedManifest(): string {
    return hashMoveInSettlementEvidenceEnvelope(
      buildMoveInSettlementEvidenceEnvelope({
        settlementId,
        contractId,
        statementHash: HASH,
        lines: [{ kind: 'FIRST_RENT', amount: 10, paymentId: 'p-1' }],
        total: 10,
        paidAt: '2030-01-03T00:00:00.000Z',
      })
    )
  }

  describe('ensureSettlementEvidenceQueued', () => {
    it('re-enqueues the deterministic item (and persists the missing evidence ref) for a paid settlement', async () => {
      const row = paid()
      const { service, outbox, repo, created } = build(row as never)
      const result = await service.ensureSettlementEvidenceQueued(settlementId)

      expect(result).toBe(created)
      expect(row.settlementEvidence?.manifestHash).toBe(expectedManifest())
      expect(repo.save).toHaveBeenCalledTimes(1)
      expect(outbox.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateType: 'move-in-settlement',
          aggregateId: settlementId,
          eventType: 'move-in.settled',
          action: 'recordMoveInSettlement',
          dependencyKeys: [`contract:${contractId}:contract.activated`],
          args: [
            settlementId,
            contractId,
            expectedManifest(),
            '1',
            '2030-01-03T00:00:00.000Z',
          ],
        })
      )
    })

    it('does not rewrite existing evidence and relies on enqueue idempotency', async () => {
      const row = paid({
        settlementEvidence: {
          manifestVersion: 1,
          manifestHash: expectedManifest(),
          ledgerStatus: 'pending',
          txHash: null,
          blockNumber: null,
          recordedAt: new Date(),
        },
      })
      const { service, repo, outbox } = build(row as never)
      await service.ensureSettlementEvidenceQueued(settlementId)
      expect(repo.save).not.toHaveBeenCalled()
      expect(outbox.enqueue).toHaveBeenCalledTimes(1)
    })

    it('returns null when the business precondition is gone (not paid / missing / bad id) and never enqueues', async () => {
      for (const row of [paid({ status: 'pending' }), null]) {
        const { service, outbox } = build(row as never)
        await expect(
          service.ensureSettlementEvidenceQueued(settlementId)
        ).resolves.toBeNull()
        expect(outbox.enqueue).not.toHaveBeenCalled()
      }
      const { service, outbox } = build(paid() as never)
      await expect(
        service.ensureSettlementEvidenceQueued('not-an-id')
      ).resolves.toBeNull()
      expect(outbox.enqueue).not.toHaveBeenCalled()
    })

    it('refuses to enqueue when stored evidence no longer matches the settlement (hash conflict)', async () => {
      const row = paid({
        settlementEvidence: {
          manifestVersion: 1,
          manifestHash: 'f'.repeat(64),
          ledgerStatus: 'pending',
          txHash: null,
          blockNumber: null,
          recordedAt: new Date(),
        },
      })
      const { service, outbox } = build(row as never)
      await expect(
        service.ensureSettlementEvidenceQueued(settlementId)
      ).rejects.toBeInstanceOf(ConflictException)
      expect(outbox.enqueue).not.toHaveBeenCalled()
    })

    it('is a no-op without a ledger outbox', async () => {
      const service = new MoveInSettlementsService(
        {} as never,
        {} as never,
        {} as never,
        {} as never
      )
      await expect(
        service.ensureSettlementEvidenceQueued(settlementId)
      ).resolves.toBeNull()
    })
  })

  describe('ensureHandoverEvidenceQueued', () => {
    function completed(extra: Record<string, unknown> = {}): MoveInSettlement {
      return paid({
        handover: {
          revision: 2,
          handoverHash: HASH,
          tenantConfirmation: { at: new Date(), hash: HASH },
          landlordConfirmation: { at: new Date(), hash: HASH },
          overrideReason: null,
          completedAt: new Date('2030-01-04T00:00:00.000Z'),
        },
        ...extra,
      })
    }

    it('re-enqueues the handover item with only the allowlisted args', async () => {
      const row = completed()
      const { service, outbox, created } = build(row as never)
      await expect(
        service.ensureHandoverEvidenceQueued(settlementId)
      ).resolves.toBe(created)
      expect(row.handoverEvidence?.manifestHash).toMatch(/^[a-f0-9]{64}$/)
      expect(outbox.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateType: 'move-in-handover',
          eventType: 'handover.completed',
          action: 'recordHandover',
          args: [
            settlementId,
            contractId,
            HASH,
            '1',
            '2',
            'false',
            '2030-01-04T00:00:00.000Z',
          ],
        })
      )
    })

    it('returns null until the handover is completed and conflicts on a drifted manifest', async () => {
      const { service, outbox } = build(paid() as never)
      await expect(
        service.ensureHandoverEvidenceQueued(settlementId)
      ).resolves.toBeNull()
      expect(outbox.enqueue).not.toHaveBeenCalled()

      const drifted = completed({
        handoverEvidence: {
          manifestVersion: 1,
          manifestHash: 'f'.repeat(64),
          ledgerStatus: 'pending',
          txHash: null,
          blockNumber: null,
          recordedAt: new Date(),
        },
      })
      const second = build(drifted as never)
      await expect(
        second.service.ensureHandoverEvidenceQueued(settlementId)
      ).rejects.toBeInstanceOf(ConflictException)
    })
  })
})
