import { ObjectId } from 'mongodb'
import { ContractAmendmentService } from './contract-amendment.service'
import { OccupantChangeRequestService } from './occupant-change-request.service'
import type { Contract } from '../schemas/contract.schema'
import type { ContractAmendment } from '../schemas/contract-amendment.schema'
import type { OccupantChangeRequest } from '../schemas/occupant-change-request.schema'

const contractId = new ObjectId('507f1f77bcf86cd799439031')
const id = contractId.toHexString()
const tenant = { actorId: 'tenant-1', isStaff: false }
const landlord = { actorId: 'landlord-1', isStaff: false }
const person = {
  fullName: 'Trần Thị B',
  birthYear: 2000,
  relationship: 'Chị',
  idPhotoUrls: ['https://cdn.example.com/id-b.jpg'],
}

type Payment = {
  _id: ObjectId
  status: string
  type: string
  dueDate: Date
  amount: number
  periodKey: string
}

/**
 * Nối thật OccupantChangeRequestService với ContractAmendmentService; chỉ giả kho dữ liệu.
 * Chuỗi: hợp đồng có người ở → yêu cầu thêm người kèm phụ phí → Chủ nhà duyệt →
 * phụ lục → hai bên ký → kỳ thuê chưa thanh toán tăng, kỳ đã thanh toán giữ nguyên.
 */
function build(): {
  occupants: OccupantChangeRequestService
  amendments: ContractAmendmentService
  contract: Contract
  payments: Payment[]
  amendmentRows: ContractAmendment[]
} {
  const contract = {
    _id: contractId,
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
    propertyId: new ObjectId().toHexString(),
    status: 'active',
    monthlyRent: 8_000_000,
    deposit: 16_000_000,
    paymentDay: 1,
    latePenaltyRate: 8,
    terminationNoticeDays: 30,
    durationMonths: 12,
    occupants: [
      { fullName: 'Nguyễn Văn A', birthYear: 1995, relationship: 'Bạn' },
    ],
    effectiveCommercial: null,
    effectiveCommercialRevision: 0,
  } as unknown as Contract
  const day = 86_400_000
  const payments: Payment[] = [
    {
      _id: new ObjectId(),
      status: 'paid',
      type: 'rent',
      dueDate: new Date(Date.now() + 10 * day),
      amount: 8_000_000,
      periodKey: '2031-01',
    },
    {
      _id: new ObjectId(),
      status: 'pending',
      type: 'rent',
      dueDate: new Date(Date.now() + 40 * day),
      amount: 8_000_000,
      periodKey: '2031-02',
    },
  ]
  const contractRepo = {
    findOne: jest.fn().mockResolvedValue(contract),
    save: jest.fn().mockResolvedValue(contract),
  }
  const amendmentRows: ContractAmendment[] = []
  const amendmentRepo = {
    findOne: jest.fn(({ where }: { where: unknown }) => {
      if (Array.isArray(where)) return Promise.resolve(null)
      const w = where as { _id?: ObjectId; idempotencyKey?: string }
      if (w.idempotencyKey) return Promise.resolve(null)
      return Promise.resolve(amendmentRows[0] ?? null)
    }),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((value: Partial<ContractAmendment>) => ({
      _id: new ObjectId(),
      ...value,
    })),
    save: jest.fn((value: ContractAmendment) => {
      if (!amendmentRows.includes(value)) amendmentRows.push(value)
      return Promise.resolve(value)
    }),
  }
  const paymentRepo = {
    find: jest.fn().mockResolvedValue(payments),
    save: jest.fn((payment: unknown) => payment),
  }
  const amendments = new ContractAmendmentService(
    amendmentRepo as never,
    contractRepo as never,
    paymentRepo as never,
    undefined,
    { enqueue: jest.fn().mockResolvedValue({}) } as never,
    undefined
  )
  const stored: OccupantChangeRequest[] = []
  const requestRepo = {
    create: jest.fn((value: Partial<OccupantChangeRequest>) => ({
      _id: new ObjectId(),
      createdAt: new Date(),
      ...value,
    })),
    save: jest.fn((value: OccupantChangeRequest) => {
      if (!stored.includes(value)) stored.push(value)
      return Promise.resolve(value)
    }),
    find: jest.fn(() => Promise.resolve(stored)),
    findOne: jest.fn(({ where }: { where: unknown }) =>
      Array.isArray(where)
        ? Promise.resolve(
            stored.find(item => item.status.startsWith('pending')) ?? null
          )
        : Promise.resolve(stored[0] ?? null)
    ),
  }
  const occupants = new OccupantChangeRequestService(
    requestRepo as never,
    contractRepo as never,
    { findOne: jest.fn().mockResolvedValue({ maxOccupants: 4 }) } as never,
    amendments,
    { createNotification: jest.fn().mockResolvedValue({}) } as never
  )
  return { occupants, amendments, contract, payments, amendmentRows }
}

describe('occupant request → amendment → rent schedule', () => {
  it('raises only the unpaid rent period once both parties sign the amendment', async () => {
    const { occupants, amendments, contract, payments, amendmentRows } = build()

    const request = await occupants.create(
      id,
      {
        occupants: [person],
        moveInDate: '2031-01-10',
        reason: 'Chị gái chuyển lên ở cùng.',
        proposedSurcharge: 300_000,
      },
      tenant
    )
    const approved = await occupants.decide(
      id,
      request._id.toHexString(),
      { action: 'approve' },
      landlord
    )
    expect(approved.status).toBe('agreed')
    expect(amendmentRows).toHaveLength(1)
    const amendment = amendmentRows[0]!
    expect(amendment.afterSnapshot.monthlyRent).toBe(8_300_000)
    expect(amendment.afterSnapshot.occupants).toHaveLength(2)

    // Bước khóa bản PDF nằm ngoài phạm vi chuỗi này: dựng sẵn trạng thái chờ ký.
    amendment.effectiveFrom = new Date(Date.now() - 86_400_000)
    amendment.artifactHash = 'c'.repeat(64)
    amendment.artifactRef = {
      artifactId: 'artifact-1',
      revision: 1,
      artifactHash: amendment.artifactHash,
      canonicalContentHash: amendment.contentHash ?? '',
      rendererVersion: 'renderer-v1',
      sourceSchemaVersion: 2,
      byteLength: 100,
      contentType: 'application/pdf',
      lockedAt: new Date(),
    }
    amendment.revision = 2
    amendment.status = 'pending-signature'
    const amendmentId = amendment._id.toHexString()
    await amendments.sign(id, amendmentId, 2, amendment.artifactHash, {
      ...tenant,
      role: 'tenant',
    })
    await amendments.sign(id, amendmentId, 3, amendment.artifactHash, {
      ...landlord,
      role: 'landlord',
    })

    expect(contract.effectiveCommercial).toEqual(
      expect.objectContaining({ monthlyRent: 8_300_000 })
    )
    expect(payments.find(p => p.status === 'pending')!.amount).toBe(8_300_000)
    expect(payments.find(p => p.status === 'paid')!.amount).toBe(8_000_000)
  })
})
