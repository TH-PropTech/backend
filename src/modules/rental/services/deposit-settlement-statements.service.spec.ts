import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Contract } from '../../contracts/schemas/contract.schema'
import type { DepositSettlementStatement } from '../schemas/deposit-settlement-statement.schema'
import type { MoveOutHandover } from '../schemas/move-out-handover.schema'
import { DAY_MS } from '../utils/move-out.util'
import {
  DepositSettlementStatementsService,
  refundableAmount,
} from './deposit-settlement-statements.service'
import { createMemoryRepo, createSupportMock } from './move-out.fixtures'

const NOW = new Date('2030-03-01T00:00:00.000Z')
const CONTRACT_ID = new ObjectId()
const CID = CONTRACT_ID.toHexString()
const DEPOSIT = 10_000_000
const LINE = {
  reason: 'Sơn lại tường',
  amount: 2_000_000,
  evidenceUrls: ['https://res.cloudinary.com/x/a.jpg'],
}
const REFUND = {
  amount: 8_000_000,
  transactionRef: ' FT123 ',
  paidAt: '2030-03-05T09:00:00.000Z',
}

type Ctx = {
  service: DepositSettlementStatementsService
  repo: ReturnType<typeof createMemoryRepo<DepositSettlementStatement>>
  support: ReturnType<typeof createSupportMock>
}

function setup(
  options: { handover?: 'completed' | 'recorded' | null; anchor?: boolean } = {}
): Ctx {
  const contract = {
    _id: CONTRACT_ID,
    tenantId: 'tenant',
    landlordId: 'landlord',
    deposit: DEPOSIT,
    packageSnapshot: { moveOutPolicy: { responseDays: 4 } },
  } as unknown as Contract
  const contractRepo = { findOne: jest.fn().mockResolvedValue(contract) }
  const handoverRepo = createMemoryRepo<MoveOutHandover>(
    options.handover === null
      ? []
      : ([
          { contractId: CID, status: options.handover ?? 'completed' },
        ] as MoveOutHandover[])
  )
  const repo = createMemoryRepo<DepositSettlementStatement>()
  const support = createSupportMock(options.anchor ?? true)
  const service = new DepositSettlementStatementsService(
    repo as never,
    contractRepo as never,
    handoverRepo as never,
    support as never
  )
  return { service, repo, support }
}

async function submitted(
  lines: Array<{ reason: string; amount: number; evidenceUrls?: string[] }> = [
    LINE,
  ],
  options: Parameters<typeof setup>[0] = {}
): Promise<Ctx & { statement: DepositSettlementStatement }> {
  const ctx = setup(options)
  await ctx.service.saveDraft(CID, 'landlord', lines, NOW)
  const statement = await ctx.service.submit(CID, 'landlord', NOW)
  return { ...ctx, statement }
}

async function accepted(): Promise<
  Ctx & { statement: DepositSettlementStatement }
> {
  const ctx = await submitted()
  const line = ctx.statement.lines[0]!
  await ctx.service.respond(
    CID,
    'tenant',
    [{ lineId: line.id, decision: 'accept' }],
    NOW
  )
  return ctx
}

describe('DepositSettlementStatementsService', () => {
  describe('saveDraft', () => {
    it('creates a draft with deposit and responseDays snapshot', async () => {
      const { service } = setup()
      const draft = await service.saveDraft(CID, 'landlord', [LINE], NOW)
      expect(draft).toMatchObject({
        status: 'draft',
        depositAmount: DEPOSIT,
        responseDays: 4,
        refunds: [],
      })
      expect(draft.lines[0]).toMatchObject({
        reason: 'Sơn lại tường',
        amount: 2_000_000,
        tenantResponse: null,
      })
      expect(draft.auditLog.map(entry => entry.action)).toEqual(['draft-saved'])
    })

    it('returns 409 when a concurrent request creates the statement first', async () => {
      const { service, repo } = setup()
      jest.spyOn(repo, 'save').mockRejectedValueOnce({ code: 11000 })
      await expect(
        service.saveDraft(CID, 'landlord', [LINE], NOW)
      ).rejects.toMatchObject({ message: 'STATEMENT_EXISTS' })
    })

    it('rethrows other save errors untouched', async () => {
      const { service, repo } = setup()
      const failure = new Error('disk full')
      jest.spyOn(repo, 'save').mockRejectedValueOnce(failure)
      await expect(
        service.saveDraft(CID, 'landlord', [LINE], NOW)
      ).rejects.toBe(failure)
    })

    it('replaces lines of an existing draft and defaults evidence to empty', async () => {
      const { service } = setup()
      await service.saveDraft(CID, 'landlord', [LINE], NOW)
      const again = await service.saveDraft(
        CID,
        'landlord',
        [{ reason: '  Vệ sinh ', amount: 500_000 }],
        NOW
      )
      expect(again.lines).toHaveLength(1)
      expect(again.lines[0]).toMatchObject({
        reason: 'Vệ sinh',
        evidenceUrls: [],
      })
    })

    it('accepts no lines and a total equal to the deposit (boundary)', async () => {
      const { service } = setup()
      await expect(
        service.saveDraft(CID, 'landlord', [], NOW)
      ).resolves.toMatchObject({ lines: [] })
      await expect(
        service.saveDraft(
          CID,
          'landlord',
          [{ reason: 'a', amount: DEPOSIT }],
          NOW
        )
      ).resolves.toBeDefined()
    })

    it('rejects totals above the deposit with 400 and saves nothing new', async () => {
      const { service, repo } = setup()
      await expect(
        service.saveDraft(
          CID,
          'landlord',
          [
            { reason: 'a', amount: 7_000_000 },
            { reason: 'b', amount: 5_000_000 },
          ],
          NOW
        )
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(repo.save).not.toHaveBeenCalled()
    })

    it('rejects a non-landlord with 403', async () => {
      await expect(
        setup().service.saveDraft(CID, 'tenant', [LINE])
      ).rejects.toBeInstanceOf(ForbiddenException)
    })

    it.each([['recorded' as const], [null]])(
      'rejects with 409 when the move-out handover is %s',
      async handover => {
        await expect(
          setup({ handover }).service.saveDraft(CID, 'landlord', [LINE])
        ).rejects.toMatchObject({ message: 'MOVE_OUT_HANDOVER_NOT_COMPLETED' })
      }
    )

    it('rejects editing once submitted', async () => {
      const { service } = await submitted()
      await expect(
        service.saveDraft(CID, 'landlord', [LINE])
      ).rejects.toMatchObject({ message: 'STATEMENT_NOT_DRAFT' })
    })
  })

  describe('submit', () => {
    it('moves to awaiting-tenant, sets the deadline, anchors and notifies the tenant', async () => {
      const { statement, support } = await submitted()
      expect(statement.status).toBe('awaiting-tenant')
      expect(statement.statementHash).toMatch(/^[a-f0-9]{64}$/)
      expect(statement.responseDueAt).toEqual(
        new Date(NOW.getTime() + 4 * DAY_MS)
      )
      expect(statement.evidence?.ledgerStatus).toBe('pending')
      expect(support.enqueueLedger).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateType: 'deposit-statement',
          action: 'recordMoveInSettlement',
        })
      )
      expect(support.notify).toHaveBeenCalledWith(
        ['tenant'],
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ contractId: CID })
      )
    })

    it('treats a statement without lines as accepted with a refund deadline', async () => {
      const { statement } = await submitted([])
      expect(statement).toMatchObject({
        status: 'accepted',
        acceptedReason: 'no-deductions',
      })
      expect(statement.refundDueAt).toEqual(
        new Date(NOW.getTime() + 7 * DAY_MS)
      )
    })

    it('closes immediately when the whole deposit is deducted and accepted', async () => {
      const { service } = setup()
      await service.saveDraft(
        CID,
        'landlord',
        [{ reason: 'a', amount: DEPOSIT }],
        NOW
      )
      const statement = await service.submit(CID, 'landlord', NOW)
      const line = statement.lines[0]!
      const result = await service.respond(
        CID,
        'tenant',
        [{ lineId: line.id, decision: 'accept' }],
        NOW
      )
      expect(result).toMatchObject({
        status: 'closed',
        closeReason: 'no-refund-due',
      })
    })

    it('skips anchoring without an outbox and survives anchor failure', async () => {
      const none = await submitted([LINE], { anchor: false })
      expect(none.statement.evidence).toBeNull()
      expect(none.support.enqueueLedger).not.toHaveBeenCalled()
      const failing = setup()
      failing.support.enqueueLedger.mockRejectedValueOnce(new Error('down'))
      await failing.service.saveDraft(CID, 'landlord', [LINE], NOW)
      await expect(
        failing.service.submit(CID, 'landlord', NOW)
      ).resolves.toMatchObject({ status: 'awaiting-tenant' })
    })

    it('rejects non-landlord (403), missing (404), repeat (409), incomplete handover (409)', async () => {
      const { service, repo } = setup()
      await expect(service.submit(CID, 'landlord')).rejects.toBeInstanceOf(
        NotFoundException
      )
      await service.saveDraft(CID, 'landlord', [LINE], NOW)
      await expect(service.submit(CID, 'tenant')).rejects.toBeInstanceOf(
        ForbiddenException
      )
      await service.submit(CID, 'landlord', NOW)
      await expect(service.submit(CID, 'landlord')).rejects.toBeInstanceOf(
        ConflictException
      )
      const stale = setup({ handover: 'recorded' })
      stale.repo.rows.push({
        ...repo.rows[0]!,
        status: 'draft',
      })
      await expect(stale.service.submit(CID, 'landlord')).rejects.toMatchObject(
        { message: 'MOVE_OUT_HANDOVER_NOT_COMPLETED' }
      )
    })
  })

  describe('respond', () => {
    it('accepts all lines -> accepted with refundDueAt = +7 days and notifies the landlord', async () => {
      const { statement, support } = await accepted()
      expect(statement).toMatchObject({
        status: 'accepted',
        acceptedReason: 'tenant-accepted',
      })
      expect(statement.refundDueAt).toEqual(
        new Date(NOW.getTime() + 7 * DAY_MS)
      )
      expect(support.notify).toHaveBeenLastCalledWith(
        ['landlord'],
        expect.any(String),
        expect.any(String),
        expect.any(Object)
      )
    })

    it('stays awaiting-tenant until every line is answered', async () => {
      const { service } = setup()
      await service.saveDraft(
        CID,
        'landlord',
        [LINE, { reason: 'b', amount: 100 }],
        NOW
      )
      const st = await service.submit(CID, 'landlord', NOW)
      const result = await service.respond(
        CID,
        'tenant',
        [{ lineId: st.lines[0]!.id, decision: 'accept' }],
        NOW
      )
      expect(result.status).toBe('awaiting-tenant')
    })

    it('moves to disputed when a line is rejected and ignores it in the refundable cap', async () => {
      const { service } = setup()
      await service.saveDraft(
        CID,
        'landlord',
        [LINE, { reason: 'b', amount: 1_000_000 }],
        NOW
      )
      const st = await service.submit(CID, 'landlord', NOW)
      const result = await service.respond(
        CID,
        'tenant',
        [
          { lineId: st.lines[0]!.id, decision: 'accept' },
          { lineId: st.lines[1]!.id, decision: 'reject', note: ' quá cao ' },
        ],
        NOW
      )
      expect(result.status).toBe('disputed')
      expect(result.lines[1]!.tenantResponse).toMatchObject({
        decision: 'reject',
        note: 'quá cao',
      })
      expect(refundableAmount(result)).toBe(DEPOSIT - 2_000_000)
    })

    it('rejects a reject without a note (400), unknown line (404)', async () => {
      const { service, statement } = await submitted()
      const lineId = statement.lines[0]!.id
      await expect(
        service.respond(CID, 'tenant', [{ lineId, decision: 'reject' }], NOW)
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.respond(
          CID,
          'tenant',
          [{ lineId: 'nope', decision: 'accept' }],
          NOW
        )
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('rejects landlord (403), wrong status and late replies (409)', async () => {
      const { service, statement } = await submitted()
      const lineId = statement.lines[0]!.id
      await expect(
        service.respond(CID, 'landlord', [{ lineId, decision: 'accept' }], NOW)
      ).rejects.toBeInstanceOf(ForbiddenException)
      await expect(
        service.respond(
          CID,
          'tenant',
          [{ lineId, decision: 'accept' }],
          new Date(NOW.getTime() + 4 * DAY_MS)
        )
      ).rejects.toMatchObject({ message: 'STATEMENT_RESPONSE_EXPIRED' })
      await service.respond(
        CID,
        'tenant',
        [{ lineId, decision: 'accept' }],
        NOW
      )
      await expect(
        service.respond(CID, 'tenant', [{ lineId, decision: 'accept' }], NOW)
      ).rejects.toMatchObject({ message: 'STATEMENT_NOT_AWAITING_TENANT' })
    })
  })

  describe('dispute', () => {
    it('lets either party dispute while awaiting-tenant or accepted', async () => {
      const a = await submitted()
      await expect(
        a.service.dispute(CID, 'landlord', ' x ', NOW)
      ).resolves.toMatchObject({
        status: 'disputed',
        dispute: { by: 'landlord', note: 'x' },
      })
      expect(a.support.notify).toHaveBeenLastCalledWith(
        ['tenant'],
        expect.any(String),
        expect.any(String),
        expect.any(Object)
      )
      const b = await accepted()
      await expect(
        b.service.dispute(CID, 'tenant', 'y', NOW)
      ).resolves.toMatchObject({ status: 'disputed' })
      expect(b.support.notify).toHaveBeenLastCalledWith(
        ['landlord'],
        expect.any(String),
        expect.any(String),
        expect.any(Object)
      )
    })

    it('rejects outsiders, double disputes, drafts and later states', async () => {
      const { service, statement } = await submitted()
      await expect(service.dispute(CID, 'x', 'n')).rejects.toBeInstanceOf(
        ForbiddenException
      )
      await service.dispute(CID, 'tenant', 'n', NOW)
      await expect(service.dispute(CID, 'tenant', 'n')).rejects.toMatchObject({
        message: 'STATEMENT_ALREADY_DISPUTED',
      })
      statement.status = 'closed'
      await expect(service.dispute(CID, 'tenant', 'n')).rejects.toMatchObject({
        message: 'STATEMENT_DISPUTE_NOT_ALLOWED',
      })
    })
  })

  describe('refunds', () => {
    it('records a declared refund (no attachments) and notifies the tenant', async () => {
      const { service, support } = await accepted()
      const result = await service.recordRefund(CID, 'landlord', REFUND, NOW)
      expect(result.status).toBe('refund-recorded')
      expect(result.refunds[0]).toMatchObject({
        amount: 8_000_000,
        transactionRef: 'FT123',
        note: null,
        tenantAcknowledgedAt: null,
      })
      expect(result.refunds[0]!.evidence?.ledgerStatus).toBe('pending')
      expect(support.enqueueLedger).toHaveBeenLastCalledWith(
        expect.objectContaining({ aggregateType: 'deposit-refund' })
      )
      expect(support.notify).toHaveBeenLastCalledWith(
        ['tenant'],
        expect.any(String),
        expect.any(String),
        expect.any(Object)
      )
    })

    it('allows partial refunds from disputed and rejects exceeding the cap', async () => {
      const { service } = await submitted()
      await service.dispute(CID, 'tenant', 'n', NOW)
      await service.recordRefund(
        CID,
        'landlord',
        { ...REFUND, amount: 3_000_000, note: ' một phần ' },
        NOW
      )
      await expect(
        service.recordRefund(
          CID,
          'landlord',
          { ...REFUND, amount: 5_000_001 },
          NOW
        )
      ).rejects.toMatchObject({ message: 'STATEMENT_REFUND_EXCEEDS_LIMIT' })
      await expect(
        service.recordRefund(
          CID,
          'landlord',
          { ...REFUND, amount: 5_000_000 },
          NOW
        )
      ).resolves.toMatchObject({ status: 'refund-recorded' })
    })

    it('rejects a refund of 9,000,000 when 2,000,000 was accepted', async () => {
      const { service } = await accepted()
      await expect(
        service.recordRefund(
          CID,
          'landlord',
          { ...REFUND, amount: 9_000_000 },
          NOW
        )
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects tenant (403), draft/awaiting statements and closed ones (409)', async () => {
      const { service } = await submitted()
      await expect(
        service.recordRefund(CID, 'tenant', REFUND, NOW)
      ).rejects.toBeInstanceOf(ForbiddenException)
      await expect(
        service.recordRefund(CID, 'landlord', REFUND, NOW)
      ).rejects.toMatchObject({ message: 'STATEMENT_REFUND_NOT_ALLOWED' })
      await expect(
        setup().service.recordRefund(CID, 'landlord', REFUND)
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('closes when the tenant acknowledges the full refund', async () => {
      const { service } = await accepted()
      const rec = await service.recordRefund(CID, 'landlord', REFUND, NOW)
      const id = rec.refunds[0]!.id
      const result = await service.acknowledgeRefund(CID, 'tenant', id, NOW)
      expect(result).toMatchObject({
        status: 'closed',
        closeReason: 'tenant-acknowledged',
      })
      expect(await service.acknowledgeRefund(CID, 'tenant', id, NOW)).toBe(
        result
      )
    })

    it('stays open while acknowledged refunds are below the payable amount', async () => {
      const { service } = await accepted()
      await service.recordRefund(
        CID,
        'landlord',
        { ...REFUND, amount: 3_000_000 },
        NOW
      )
      const rec = await service.recordRefund(
        CID,
        'landlord',
        { ...REFUND, amount: 1_000_000 },
        NOW
      )
      const result = await service.acknowledgeRefund(
        CID,
        'tenant',
        rec.refunds[0]!.id,
        NOW
      )
      expect(result.status).toBe('refund-recorded')
    })

    it('rejects landlord ack (403) and unknown refund (404)', async () => {
      const { service } = await accepted()
      await service.recordRefund(CID, 'landlord', REFUND, NOW)
      await expect(
        service.acknowledgeRefund(CID, 'landlord', 'x', NOW)
      ).rejects.toBeInstanceOf(ForbiddenException)
      await expect(
        service.acknowledgeRefund(CID, 'tenant', 'x', NOW)
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('processDeadlines', () => {
    it('auto-accepts after the response deadline (no-response) and notifies both', async () => {
      const { service, statement, support } = await submitted()
      const count = await service.processDeadlines(
        new Date(NOW.getTime() + 4 * DAY_MS)
      )
      expect(count).toBe(1)
      expect(statement).toMatchObject({
        status: 'accepted',
        acceptedReason: 'tenant-no-response',
      })
      expect(support.notify).toHaveBeenLastCalledWith(
        ['tenant', 'landlord'],
        expect.any(String),
        expect.any(String),
        expect.any(Object)
      )
    })

    it('does not touch awaiting statements before the deadline, draft or closed ones', async () => {
      const { service } = await submitted()
      expect(
        await service.processDeadlines(new Date(NOW.getTime() + DAY_MS))
      ).toBe(0)
    })

    it('sends one reminder near the refund deadline, then one overdue audit event, without sanction', async () => {
      const { service, statement, support } = await accepted()
      const due = statement.refundDueAt!
      expect(
        await service.processDeadlines(new Date(due.getTime() - 3 * DAY_MS))
      ).toBe(0)

      const nearly = new Date(due.getTime() - DAY_MS / 2)
      expect(await service.processDeadlines(nearly)).toBe(1)
      expect(statement.refundReminderSentAt).toEqual(nearly)
      expect(await service.processDeadlines(nearly)).toBe(0)

      const late = new Date(due.getTime() + 1000)
      expect(await service.processDeadlines(late)).toBe(1)
      expect(statement.refundOverdueAt).toEqual(late)
      expect(statement.status).toBe('accepted')
      expect(support.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'deposit-statement.refund-overdue',
        })
      )
      expect(statement.auditLog.some(e => e.action === 'refund-overdue')).toBe(
        true
      )
      expect(await service.processDeadlines(late)).toBe(0)
    })

    it('skips refund reminders when a refund is already recorded and closes un-acknowledged ones', async () => {
      const { service, statement } = await accepted()
      await service.recordRefund(CID, 'landlord', REFUND, NOW)
      const due = statement.refundDueAt!
      expect(
        await service.processDeadlines(new Date(due.getTime() + DAY_MS))
      ).toBe(1)
      expect(statement).toMatchObject({
        status: 'closed',
        closeReason: 'tenant-no-acknowledge',
      })
      expect(statement.refundOverdueAt).toBeNull()
    })

    it('does not close a refund-recorded statement before responseDays pass', async () => {
      const { service } = await accepted()
      await service.recordRefund(CID, 'landlord', REFUND, NOW)
      expect(
        await service.processDeadlines(new Date(NOW.getTime() + 3 * DAY_MS))
      ).toBe(0)
    })

    it('logs and continues when one record fails', async () => {
      const { service, repo } = await submitted()
      repo.save.mockRejectedValueOnce(new Error('db'))
      expect(
        await service.processDeadlines(new Date(NOW.getTime() + 5 * DAY_MS))
      ).toBe(0)
    })
  })

  describe('findByContract', () => {
    it('hides an unsent draft from the tenant but not from the landlord or staff', async () => {
      const { service } = setup()
      await service.saveDraft(CID, 'landlord', [LINE], NOW)
      await expect(
        service.findByContract(CID, 'tenant', false)
      ).rejects.toMatchObject({ message: 'STATEMENT_NOT_FOUND' })
      await expect(
        service.findByContract(CID, 'landlord', false)
      ).resolves.toMatchObject({ status: 'draft' })
      await expect(
        service.findByContract(CID, 'x', true)
      ).resolves.toMatchObject({ status: 'draft' })
    })

    it('returns for parties and staff, 403 for outsiders, 404 when missing', async () => {
      const { service } = await submitted()
      await expect(
        service.findByContract(CID, 'tenant', false)
      ).resolves.toBeDefined()
      await expect(
        service.findByContract(CID, 'x', true)
      ).resolves.toBeDefined()
      await expect(
        service.findByContract(CID, 'x', false)
      ).rejects.toBeInstanceOf(ForbiddenException)
      await expect(
        setup().service.findByContract(CID, 'tenant', false)
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })
})
