import 'reflect-metadata'
import { BadRequestException, ValidationPipe } from '@nestjs/common'
import {
  ConfirmHandoverDto,
  HandoverDiscrepancyDto,
  RecordHandoverDto,
} from '../dto/move-in-handover.dto'
import { MoveInSettlementsController } from './move-in-settlements.controller'

// Cùng cấu hình với pipe toàn cục trong utils/setup-app.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
})
const parse = (metatype: new () => object, body: unknown): Promise<unknown> =>
  pipe.transform(body, { type: 'body', metatype })

const HASH = 'a'.repeat(64)
const VALID_RECORD = {
  handedOverAt: '2030-02-01T09:00:00.000Z',
  electricity: 120,
  water: 45,
  meterPhotos: {
    electricity: ['https://cdn.example.com/dien.jpg'],
    water: ['https://cdn.example.com/nuoc.png'],
  },
  keyCount: 2,
  inventoryItems: [{ name: 'Sofa', quantity: 1, condition: 'good' }],
  notes: 'Bàn giao đủ',
}

describe('move-in handover DTOs (400 on invalid input)', () => {
  it('accepts a valid handover record', async () => {
    await expect(
      parse(RecordHandoverDto, VALID_RECORD)
    ).resolves.toBeInstanceOf(RecordHandoverDto)
  })

  it.each([
    ['negative meter reading', { electricity: -1 }],
    ['non-integer key count', { keyCount: 1.5 }],
    ['invalid date', { handedOverAt: '31/02/2030' }],
    [
      'unknown condition',
      { inventoryItems: [{ name: 'Sofa', quantity: 1, condition: 'broken' }] },
    ],
    [
      'zero quantity',
      { inventoryItems: [{ name: 'Sofa', quantity: 0, condition: 'good' }] },
    ],
    [
      'blank item name',
      { inventoryItems: [{ name: '   ', quantity: 1, condition: 'good' }] },
    ],
    [
      'more than 100 items',
      {
        inventoryItems: Array.from({ length: 101 }, () => ({
          name: 'Ghế',
          quantity: 1,
          condition: 'good',
        })),
      },
    ],
    ['unknown field', { discrepancyNote: 'x' }],
  ])('rejects %s', async (_label, patch) => {
    await expect(
      parse(RecordHandoverDto, { ...VALID_RECORD, ...patch })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects a confirmation with a discrepancy note, bad hash or role', async () => {
    await expect(
      parse(ConfirmHandoverDto, { handoverHash: HASH, role: 'tenant' })
    ).resolves.toBeInstanceOf(ConfirmHandoverDto)
    for (const body of [
      { handoverHash: HASH, role: 'tenant', discrepancyNote: 'x' },
      { handoverHash: 'not-a-hash', role: 'tenant' },
      { handoverHash: HASH, role: 'staff' },
    ]) {
      await expect(parse(ConfirmHandoverDto, body)).rejects.toBeInstanceOf(
        BadRequestException
      )
    }
  })

  it('rejects an empty or whitespace-only discrepancy note and trims a valid one', async () => {
    for (const note of ['', '   ']) {
      await expect(
        parse(HandoverDiscrepancyDto, { handoverHash: HASH, note })
      ).rejects.toBeInstanceOf(BadRequestException)
    }
    await expect(
      parse(HandoverDiscrepancyDto, { handoverHash: HASH, note: ' Nước 125 ' })
    ).resolves.toMatchObject({ note: 'Nước 125' })
  })
})

describe('MoveInSettlementsController', () => {
  function build(): {
    controller: MoveInSettlementsController
    service: Record<string, jest.Mock>
  } {
    const service = {
      updateHandover: jest.fn().mockResolvedValue({}),
      confirmHandover: jest.fn().mockResolvedValue({}),
      reportHandoverDiscrepancy: jest.fn().mockResolvedValue({}),
      processHandoverResponseDeadlines: jest.fn().mockResolvedValue(3),
    }
    return {
      controller: new MoveInSettlementsController(service as never),
      service,
    }
  }

  it('passes the staff flag derived from roles when recording', async () => {
    const { controller, service } = build()
    await controller.handover('s1', VALID_RECORD as RecordHandoverDto, {
      _id: 'staff-1',
      roles: ['staff'],
    })
    expect(service.updateHandover).toHaveBeenCalledWith(
      's1',
      'staff-1',
      expect.objectContaining({ isStaff: true, keyCount: 2 })
    )
  })

  it('confirms without a discrepancy note and reports discrepancies separately', async () => {
    const { controller, service } = build()
    const user = { _id: 'tenant', roles: ['tenant'] } as never
    await controller.confirm('s1', { handoverHash: HASH, role: 'tenant' }, user)
    expect(service.confirmHandover).toHaveBeenCalledWith(
      's1',
      'tenant',
      'tenant',
      HASH
    )
    await controller.reportDiscrepancy(
      's1',
      { handoverHash: HASH, note: 'Nước 125' },
      user
    )
    expect(service.reportHandoverDiscrepancy).toHaveBeenCalledWith(
      's1',
      'tenant',
      HASH,
      'Nước 125'
    )
  })

  it('exposes the handover deadline sweep to admin/staff', async () => {
    const { controller } = build()
    await expect(controller.processHandoverDeadlines()).resolves.toBe(3)
  })
})
