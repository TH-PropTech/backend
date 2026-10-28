import 'reflect-metadata'
import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { ROLES_KEY } from '../../../common/decorators/roles.decorator'
import {
  RecordRefundDto,
  RespondStatementDto,
  SaveStatementDraftDto,
} from '../dto/deposit-settlement-statement.dto'
import {
  ConfirmMoveOutHandoverDto,
  DisputeNoteDto,
  MoveOutDiscrepancyDto,
  RecordMoveOutHandoverDto,
} from '../dto/move-out-handover.dto'
import { DepositSettlementStatementsController } from './deposit-settlement-statements.controller'
import { MoveOutHandoversController } from './move-out-handovers.controller'

// Cùng cấu hình với pipe toàn cục trong utils/setup-app.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
})
const parse = (metatype: new () => object, body: unknown): Promise<unknown> =>
  pipe.transform(body, { type: 'body', metatype })

const HASH = 'a'.repeat(64)
const VALID_HANDOVER = {
  handedBackAt: '2030-03-01T09:00:00.000Z',
  electricity: 10,
  water: 5,
  keyCount: 2,
  inventoryItems: [{ name: 'Sofa', quantity: 1, condition: 'missing' }],
}
const VALID_LINE = {
  reason: 'Sơn tường',
  amount: 1000,
  evidenceUrls: ['https://res.cloudinary.com/demo/a.PNG'],
}

describe('move-out DTO validation', () => {
  it('accepts valid payloads', async () => {
    await expect(
      parse(RecordMoveOutHandoverDto, VALID_HANDOVER)
    ).resolves.toBeInstanceOf(RecordMoveOutHandoverDto)
    await expect(
      parse(ConfirmMoveOutHandoverDto, { handoverHash: HASH })
    ).resolves.toBeDefined()
    await expect(
      parse(MoveOutDiscrepancyDto, { handoverHash: HASH, note: 'x' })
    ).resolves.toBeDefined()
    await expect(parse(DisputeNoteDto, { note: 'x' })).resolves.toBeDefined()
  })

  it.each([
    ['negative reading', { electricity: -1 }],
    ['float key count', { keyCount: 1.5 }],
    ['bad date', { handedBackAt: '01/03/2030' }],
    [
      'unknown condition',
      { inventoryItems: [{ name: 'a', quantity: 1, condition: 'broken' }] },
    ],
    ['unknown field', { recordedBy: 'x' }],
  ])('rejects handover with %s', async (_l, patch) => {
    await expect(
      parse(RecordMoveOutHandoverDto, { ...VALID_HANDOVER, ...patch })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects bad hash and blank notes', async () => {
    await expect(
      parse(ConfirmMoveOutHandoverDto, { handoverHash: 'zz' })
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(parse(DisputeNoteDto, { note: '   ' })).rejects.toBeInstanceOf(
      BadRequestException
    )
  })

  it('accepts a statement draft with up to 5 JPEG/PNG https URLs, or no lines', async () => {
    await expect(
      parse(SaveStatementDraftDto, { lines: [VALID_LINE] })
    ).resolves.toBeDefined()
    await expect(
      parse(SaveStatementDraftDto, { lines: [] })
    ).resolves.toBeDefined()
  })

  it.each([
    ['missing reason', { reason: '' }],
    ['zero amount', { amount: 0 }],
    [
      'more than 5 files',
      { evidenceUrls: Array(6).fill(VALID_LINE.evidenceUrls[0]) },
    ],
    ['http url', { evidenceUrls: ['http://x.com/a.jpg'] }],
    ['webp file', { evidenceUrls: ['https://x.com/a.webp'] }],
    ['pdf file', { evidenceUrls: ['https://x.com/a.pdf'] }],
  ])('rejects statement line with %s', async (_l, patch) => {
    await expect(
      parse(SaveStatementDraftDto, { lines: [{ ...VALID_LINE, ...patch }] })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('validates tenant responses', async () => {
    await expect(
      parse(RespondStatementDto, {
        responses: [{ lineId: 'a', decision: 'reject', note: 'n' }],
      })
    ).resolves.toBeDefined()
    await expect(
      parse(RespondStatementDto, { responses: [] })
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      parse(RespondStatementDto, {
        responses: [{ lineId: 'a', decision: 'maybe' }],
      })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('validates refunds and refuses attachments', async () => {
    const ok = {
      amount: 100,
      transactionRef: 'FT1',
      paidAt: '2030-03-05T00:00:00.000Z',
    }
    await expect(parse(RecordRefundDto, ok)).resolves.toBeDefined()
    await expect(
      parse(RecordRefundDto, { ...ok, receiptUrl: 'https://x.com/a.jpg' })
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      parse(RecordRefundDto, { ...ok, amount: 0 })
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      parse(RecordRefundDto, { ...ok, transactionRef: ' ' })
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('controller role guards (landlord-only authoring)', () => {
  const rolesOf = (controller: object, handler: string): string[] | undefined =>
    Reflect.getMetadata(
      ROLES_KEY,
      (controller as Record<string, object>)[handler] as object
    ) as string[] | undefined

  it.each([
    ['record', ['landlord']],
    ['revise', ['landlord']],
    ['confirm', ['tenant']],
    ['discrepancy', ['tenant']],
    ['dispute', ['landlord', 'tenant']],
    ['processDeadlines', ['admin', 'staff']],
  ])('MoveOutHandoversController.%s', (handler, roles) => {
    expect(rolesOf(MoveOutHandoversController.prototype, handler)).toEqual(
      roles
    )
  })

  it.each([
    ['saveDraft', ['landlord']],
    ['submit', ['landlord']],
    ['respond', ['tenant']],
    ['dispute', ['landlord', 'tenant']],
    ['recordRefund', ['landlord']],
    ['acknowledgeRefund', ['tenant']],
    ['processDeadlines', ['admin', 'staff']],
  ])('DepositSettlementStatementsController.%s', (handler, roles) => {
    expect(
      rolesOf(DepositSettlementStatementsController.prototype, handler)
    ).toEqual(roles)
  })

  it('delegates with the actor id and staff flag', async () => {
    const service = {
      findByContract: jest.fn().mockResolvedValue('row'),
      record: jest.fn().mockResolvedValue('rec'),
      confirm: jest.fn().mockResolvedValue('ok'),
      processResponseDeadlines: jest.fn().mockResolvedValue(2),
    }
    const controller = new MoveOutHandoversController(service as never)
    const staff = { _id: 'u1', roles: ['staff'] } as never
    const tenant = { _id: 't1', roles: ['tenant'] } as never
    await controller.get('c1', staff)
    expect(service.findByContract).toHaveBeenCalledWith('c1', 'u1', true)
    await controller.get('c1', tenant)
    expect(service.findByContract).toHaveBeenLastCalledWith('c1', 't1', false)
    await controller.record('c1', VALID_HANDOVER as never, tenant)
    expect(service.record).toHaveBeenCalledWith('c1', 't1', VALID_HANDOVER)
    await controller.confirm('c1', { handoverHash: HASH }, tenant)
    expect(service.confirm).toHaveBeenCalledWith('c1', 't1', HASH)
    await expect(controller.processDeadlines()).resolves.toBe(2)
  })

  it('statement controller delegates', async () => {
    const service = {
      findByContract: jest.fn().mockResolvedValue('row'),
      saveDraft: jest.fn().mockResolvedValue('d'),
      submit: jest.fn().mockResolvedValue('s'),
      respond: jest.fn().mockResolvedValue('r'),
      recordRefund: jest.fn().mockResolvedValue('f'),
      acknowledgeRefund: jest.fn().mockResolvedValue('a'),
      dispute: jest.fn().mockResolvedValue('x'),
      processDeadlines: jest.fn().mockResolvedValue(1),
    }
    const controller = new DepositSettlementStatementsController(
      service as never
    )
    const user = { _id: 'u1', roles: ['landlord'] } as never
    await controller.get('c1', user)
    expect(service.findByContract).toHaveBeenCalledWith('c1', 'u1', false)
    await controller.saveDraft('c1', { lines: [] }, user)
    expect(service.saveDraft).toHaveBeenCalledWith('c1', 'u1', [])
    await controller.submit('c1', user)
    await controller.respond('c1', { responses: [] }, user)
    expect(service.respond).toHaveBeenCalledWith('c1', 'u1', [])
    await controller.dispute('c1', { note: 'n' }, user)
    expect(service.dispute).toHaveBeenCalledWith('c1', 'u1', 'n')
    await controller.recordRefund('c1', { amount: 1 } as never, user)
    await controller.acknowledgeRefund('c1', 'r1', user)
    expect(service.acknowledgeRefund).toHaveBeenCalledWith('c1', 'u1', 'r1')
    await expect(controller.processDeadlines()).resolves.toBe(1)
  })
})
