import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Contract } from '../../contracts/schemas/contract.schema'
import type { MoveOutHandover } from '../schemas/move-out-handover.schema'
import { MoveOutSupportService } from '../services/move-out-support.service'
import { renderMoveOutHandoverPdf } from './move-out-handover-pdf.renderer'
import {
  addDays,
  assertPartyOrStaff,
  loadContract,
  pendingEvidence,
  resolveMoveOutResponseDays,
} from './move-out.util'

describe('resolveMoveOutResponseDays', () => {
  it.each([
    [{ moveOutPolicy: { responseDays: 7 } }, 7],
    [{ moveOutPolicy: { responseDays: 1 } }, 1],
    [{ moveOutPolicy: { responseDays: 15 } }, 15],
    [{ moveOutPolicy: { responseDays: 0 } }, 3],
    [{ moveOutPolicy: { responseDays: 16 } }, 3],
    [{ moveOutPolicy: { responseDays: 2.5 } }, 3],
    [{ moveOutPolicy: { responseDays: '5' } }, 3],
    [{ moveOutPolicy: null }, 3],
    [{ moveOutPolicy: {} }, 3],
    [{}, 3],
    [null, 3],
    [undefined, 3],
    ['x', 3],
  ])('%j -> %i', (snapshot, expected) => {
    expect(resolveMoveOutResponseDays(snapshot)).toBe(expected)
  })
})

describe('move-out helpers', () => {
  it('adds calendar days and builds a pending evidence ref', () => {
    expect(addDays(new Date('2030-01-01T00:00:00.000Z'), 7).toISOString()).toBe(
      '2030-01-08T00:00:00.000Z'
    )
    expect(pendingEvidence(2, 'h')).toMatchObject({
      manifestVersion: 2,
      manifestHash: 'h',
      ledgerStatus: 'pending',
      txHash: null,
    })
  })

  it('loadContract 404s on malformed ids and missing rows', async () => {
    const repo = { findOne: jest.fn().mockResolvedValue(null) }
    await expect(loadContract(repo as never, 'bad')).rejects.toBeInstanceOf(
      NotFoundException
    )
    await expect(
      loadContract(repo as never, new ObjectId().toHexString())
    ).rejects.toBeInstanceOf(NotFoundException)
    const contract = { contractCode: 'A' }
    repo.findOne.mockResolvedValue(contract)
    await expect(
      loadContract(repo as never, new ObjectId().toHexString())
    ).resolves.toBe(contract)
  })

  it('assertPartyOrStaff', () => {
    const record = { tenantId: 't', landlordId: 'l' }
    expect(() => assertPartyOrStaff(record, 't', false, 'X')).not.toThrow()
    expect(() => assertPartyOrStaff(record, 'o', true, 'X')).not.toThrow()
    expect(() => assertPartyOrStaff(record, 'o', false, 'X')).toThrow(
      ForbiddenException
    )
  })
})

describe('MoveOutSupportService', () => {
  const build = (
    overrides: {
      notifications?: object
      events?: object | null
      outbox?: object | null
    } = {}
  ): {
    service: MoveOutSupportService
    notifications: { createNotification: jest.Mock }
    events: { record: jest.Mock } | undefined
    outbox: { enqueue: jest.Mock } | undefined
  } => {
    const notifications = overrides.notifications ?? {
      createNotification: jest.fn().mockResolvedValue(undefined),
    }
    const events =
      overrides.events === null
        ? undefined
        : (overrides.events ?? {
            record: jest.fn().mockResolvedValue(undefined),
          })
    const outbox =
      overrides.outbox === null
        ? undefined
        : (overrides.outbox ?? { enqueue: jest.fn().mockResolvedValue({}) })
    return {
      service: new MoveOutSupportService(
        notifications as never,
        events as never,
        outbox as never
      ),
      notifications: notifications as { createNotification: jest.Mock },
      events: events as { record: jest.Mock } | undefined,
      outbox: outbox as { enqueue: jest.Mock } | undefined,
    }
  }
  const EVENT = {
    aggregateType: 'move-out-handover' as const,
    aggregateId: 'a',
    eventType: 'e',
    action: 'recordHandover' as const,
    args: ['1'],
    contractId: 'c',
    payloadHash: 'h',
    schemaVersion: 1,
  }

  it('notifies each user and swallows notification errors', async () => {
    const { service, notifications } = build()
    notifications.createNotification
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce(undefined)
    await service.notify(['a', 'b'], 't', 'b', { k: 1 })
    expect(notifications.createNotification).toHaveBeenCalledTimes(2)
    expect(notifications.createNotification).toHaveBeenLastCalledWith(
      'b',
      't',
      'b',
      'MOVE_OUT_SETTLEMENT',
      { k: 1 }
    )
  })

  it('records transaction events, tolerates absence and failure', async () => {
    const full = build()
    await full.service.recordEvent({
      contractId: 'c',
      eventType: 'e',
      actorRole: 'system',
      transitionKey: 'k',
    })
    expect(full.events!.record).toHaveBeenCalledWith(
      expect.objectContaining({ refs: { contractId: 'c' }, actorId: null })
    )
    full.events!.record.mockRejectedValueOnce(new Error('x'))
    await expect(
      full.service.recordEvent({
        contractId: 'c',
        eventType: 'e',
        actorRole: 'system',
        transitionKey: 'k2',
      })
    ).resolves.toBeUndefined()
    await expect(
      build({ events: null }).service.recordEvent({
        contractId: 'c',
        eventType: 'e',
        actorRole: 'system',
        transitionKey: 'k',
      })
    ).resolves.toBeUndefined()
  })

  it('enqueues ledger events only when an outbox exists and never throws', async () => {
    const full = build()
    expect(full.service.canAnchor).toBe(true)
    await full.service.enqueueLedger(EVENT)
    expect(full.outbox!.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        dependencyKeys: ['contract:c:contract.activated'],
        metadata: { contractId: 'c', schemaVersion: 1, payloadHash: 'h' },
      })
    )
    full.outbox!.enqueue.mockRejectedValueOnce(new Error('x'))
    await expect(full.service.enqueueLedger(EVENT)).resolves.toBeUndefined()
    const none = build({ outbox: null })
    expect(none.service.canAnchor).toBe(false)
    await expect(none.service.enqueueLedger(EVENT)).resolves.toBeUndefined()
  })
})

describe('renderMoveOutHandoverPdf', () => {
  const handover = {
    revision: 2,
    handedBackAt: new Date('2030-03-01T09:00:00.000Z'),
    meterReadings: { electricity: 1, water: 2 },
    keyCount: 2,
    notes: 'Ghi chú',
    inventoryItems: [
      {
        name: 'Sofa',
        quantity: 1,
        conditionAtMoveIn: 'good',
        noteAtMoveIn: null,
        condition: 'damaged',
        note: 'Rách',
      },
      {
        name: 'Bàn',
        quantity: 1,
        conditionAtMoveIn: null,
        noteAtMoveIn: null,
        condition: 'missing',
        note: null,
      },
    ],
    tenantConfirmation: null,
    landlordConfirmation: { at: new Date(), hash: 'h' },
    completedAt: new Date('2030-03-05T00:00:00.000Z'),
  } as unknown as MoveOutHandover
  const contract = {
    contractCode: 'HD-9',
    propertyAddress: null,
    landlordName: 'A',
    tenantName: null,
  } as unknown as Contract

  it('produces a PDF with and without inventory/notes', async () => {
    const full = await renderMoveOutHandoverPdf(contract, handover)
    expect(full.subarray(0, 4).toString()).toBe('%PDF')
    const bare = await renderMoveOutHandoverPdf(contract, {
      ...handover,
      inventoryItems: [],
      notes: null,
      landlordConfirmation: null,
      completedAt: null,
    })
    expect(bare.subarray(0, 4).toString()).toBe('%PDF')
  })
})
