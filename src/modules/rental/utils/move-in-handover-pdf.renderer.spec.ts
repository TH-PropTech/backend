import { ObjectId } from 'mongodb'
import type { Contract } from '../../contracts/schemas/contract.schema'
import type { MoveInSettlement } from '../schemas/move-in-settlement.schema'
import { renderMoveInHandoverPdf } from './move-in-handover-pdf.renderer'

const CONTRACT = {
  contractCode: 'HD-TEST-001',
  propertyAddress: 'Căn hộ 101, Toà A',
  landlordName: 'Nguyễn Văn A',
  tenantName: 'Trần Thị B',
} as Pick<
  Contract,
  'contractCode' | 'propertyAddress' | 'landlordName' | 'tenantName'
>

function settlement(handover: MoveInSettlement['handover']): MoveInSettlement {
  return {
    _id: new ObjectId(),
    contractId: new ObjectId().toHexString(),
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
    lines: [],
    total: 1_000_000,
    dueAt: new Date('2030-01-01'),
    status: 'paid',
    statementHash: 'hash',
    handover,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as MoveInSettlement
}

describe('renderMoveInHandoverPdf', () => {
  it('rejects when the handover has no record', async () => {
    await expect(
      renderMoveInHandoverPdf(CONTRACT, settlement(null))
    ).rejects.toThrow('HANDOVER_NOT_RECORDED')
  })

  it('renders a non-empty PDF buffer starting with the %PDF signature', async () => {
    const buffer = await renderMoveInHandoverPdf(
      CONTRACT,
      settlement({
        revision: 1,
        handedOverAt: new Date('2030-01-05T10:00:00Z'),
        meterReadings: { electricity: 120, water: 30 },
        keyCount: 2,
        inventoryReference: null,
        inventoryItems: [
          { name: 'Sofa', quantity: 1, condition: 'good', note: null },
        ],
        discrepancies: [],
        responseDueAt: null,
        completionReason: 'both-confirmed',
        notes: 'Bàn giao đầy đủ',
        handoverHash: 'h'.repeat(64),
        recordedBy: 'landlord-1',
        tenantConfirmation: { at: new Date('2030-01-05T12:00:00Z'), hash: 'h' },
        landlordConfirmation: {
          at: new Date('2030-01-05T10:00:00Z'),
          hash: 'h',
        },
        discrepancyNote: null,
        completedAt: new Date('2030-01-05T12:00:00Z'),
      })
    )
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buffer.length).toBeGreaterThan(500)
  })
})
