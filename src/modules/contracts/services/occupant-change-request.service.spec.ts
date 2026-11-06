import { ObjectId } from 'mongodb'
import { OccupantChangeRequestService } from './occupant-change-request.service'
import type { Contract } from '../schemas/contract.schema'
import type { OccupantChangeRequest } from '../schemas/occupant-change-request.schema'

const contractId = new ObjectId('507f1f77bcf86cd799439021')
const id = contractId.toHexString()
const person = {
  fullName: 'Trần Thị B',
  birthYear: 2000,
  relationship: 'Chị',
  idPhotoUrls: ['https://cdn.example.com/id-b.jpg'],
}
const input = {
  occupants: [person],
  moveInDate: '2031-01-10',
  reason: 'Chị gái chuyển lên ở cùng để đi làm.',
  proposedSurcharge: 300_000,
}
const tenant = { actorId: 'tenant-1', isStaff: false }
const landlord = { actorId: 'landlord-1', isStaff: false }

type AmendmentCall = [
  string,
  { changes: Array<{ field: string; after: unknown }> },
]

function build(
  options: {
    maxOccupants?: number | null
    contract?: Partial<Contract>
    existing?: OccupantChangeRequest | null
  } = {}
): {
  service: OccupantChangeRequestService
  amendments: { create: jest.Mock }
  notifications: { createNotification: jest.Mock }
  stored: OccupantChangeRequest[]
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
    ...options.contract,
  } as unknown as Contract
  const stored: OccupantChangeRequest[] = options.existing
    ? [options.existing]
    : []
  const requests = {
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
    findOne: jest.fn(({ where }: { where: unknown }) => {
      if (Array.isArray(where)) {
        return Promise.resolve(
          stored.find(item => item.status.startsWith('pending')) ?? null
        )
      }
      return Promise.resolve(stored[0] ?? null)
    }),
  }
  const contracts = { findOne: jest.fn().mockResolvedValue(contract) }
  const apartments = {
    findOne: jest
      .fn()
      .mockResolvedValue({ maxOccupants: options.maxOccupants ?? 4 }),
  }
  const amendments = {
    create: jest.fn().mockResolvedValue({ _id: new ObjectId() }),
  }
  const notifications = { createNotification: jest.fn().mockResolvedValue({}) }
  const service = new OccupantChangeRequestService(
    requests as never,
    contracts as never,
    apartments as never,
    amendments as never,
    notifications as never
  )
  return { service, amendments, notifications, stored }
}

describe('OccupantChangeRequestService', () => {
  it('creates a pending request and notifies the landlord', async () => {
    const { service, notifications } = build()
    const request = await service.create(id, input, tenant)
    expect(request.status).toBe('pending-landlord')
    expect(request.proposedSurcharge).toBe(300_000)
    expect(notifications.createNotification).toHaveBeenCalledWith(
      'landlord-1',
      expect.any(String),
      expect.any(String),
      'occupant-change-request',
      expect.any(Object)
    )
  })

  it('rejects a request above the apartment limit', async () => {
    const { service } = build({ maxOccupants: 2 })
    await expect(service.create(id, input, tenant)).rejects.toThrow(
      'Căn hộ này cho phép tối đa 2 người ở.'
    )
  })

  it('rejects when a request is already open', async () => {
    const open = { status: 'pending-landlord' } as OccupantChangeRequest
    const { service } = build({ existing: open })
    await expect(service.create(id, input, tenant)).rejects.toThrow(
      'OCCUPANT_REQUEST_IN_PROGRESS'
    )
  })

  it('rejects people who are not the tenant and inactive contracts', async () => {
    await expect(build().service.create(id, input, landlord)).rejects.toThrow(
      'OCCUPANT_REQUEST_TENANT_ONLY'
    )
    await expect(
      build({ contract: { status: 'draft' } }).service.create(id, input, tenant)
    ).rejects.toThrow('OCCUPANT_REQUEST_CONTRACT_NOT_ACTIVE')
  })

  it('creates an amendment with the new occupants and the higher rent when the landlord approves', async () => {
    const { service, amendments } = build()
    const created = await service.create(id, input, tenant)
    const approved = await service.decide(
      id,
      created._id.toHexString(),
      { action: 'approve' },
      landlord
    )
    expect(approved.status).toBe('agreed')
    expect(approved.agreedSurcharge).toBe(300_000)
    const call = amendments.create.mock.calls[0] as unknown as AmendmentCall
    expect(call[1].changes).toEqual([
      {
        field: 'occupants',
        after: [
          { fullName: 'Nguyễn Văn A', birthYear: 1995, relationship: 'Bạn' },
          { fullName: 'Trần Thị B', birthYear: 2000, relationship: 'Chị' },
        ],
      },
      { field: 'monthlyRent', after: 8_300_000 },
    ])
  })

  it('leaves the rent untouched when the agreed surcharge is zero', async () => {
    const { service, amendments } = build()
    const created = await service.create(
      id,
      { ...input, proposedSurcharge: 0 },
      tenant
    )
    await service.decide(
      id,
      created._id.toHexString(),
      { action: 'approve' },
      landlord
    )
    const call = amendments.create.mock.calls[0] as unknown as AmendmentCall
    expect(call[1].changes.map(change => change.field)).toEqual(['occupants'])
  })

  it('lets the landlord counter the fee and applies the tenant answer', async () => {
    const accepted = build()
    const first = await accepted.service.create(id, input, tenant)
    const countered = await accepted.service.decide(
      id,
      first._id.toHexString(),
      {
        action: 'counter',
        counterSurcharge: 500_000,
        reason: 'Điện nước tăng',
      },
      landlord
    )
    expect(countered.status).toBe('pending-tenant')
    const agreed = await accepted.service.respondToCounter(
      id,
      first._id.toHexString(),
      true,
      tenant
    )
    expect(agreed.agreedSurcharge).toBe(500_000)

    const declined = build()
    const second = await declined.service.create(id, input, tenant)
    await declined.service.decide(
      id,
      second._id.toHexString(),
      { action: 'counter', counterSurcharge: 900_000 },
      landlord
    )
    const closed = await declined.service.respondToCounter(
      id,
      second._id.toHexString(),
      false,
      tenant
    )
    expect(closed.status).toBe('rejected')
    expect(declined.amendments.create).not.toHaveBeenCalled()
  })

  it('closes the request when the landlord rejects', async () => {
    const { service, amendments } = build()
    const created = await service.create(id, input, tenant)
    const rejected = await service.decide(
      id,
      created._id.toHexString(),
      { action: 'reject', reason: 'Nội quy tòa nhà không cho phép' },
      landlord
    )
    expect(rejected.status).toBe('rejected')
    expect(rejected.decisionReason).toBe('Nội quy tòa nhà không cho phép')
    expect(amendments.create).not.toHaveBeenCalled()
  })

  it('re-checks the limit when the landlord approves after the limit dropped', async () => {
    const created = await build({ maxOccupants: 4 }).service.create(
      id,
      input,
      tenant
    )
    const lowered = build({ maxOccupants: 2 })
    lowered.stored.push(created)
    await expect(
      lowered.service.decide(
        id,
        created._id.toHexString(),
        { action: 'approve' },
        landlord
      )
    ).rejects.toThrow('Căn hộ này cho phép tối đa 2 người ở.')
  })

  it('notifies the right party at each step and records an audit trail', async () => {
    const { service, notifications } = build()
    const created = await service.create(id, input, tenant)
    const recipients = (): string[] =>
      notifications.createNotification.mock.calls.map(
        call => (call as unknown as [string])[0]
      )
    expect(recipients()).toEqual(['landlord-1'])
    await service.decide(
      id,
      created._id.toHexString(),
      { action: 'counter', counterSurcharge: 400_000 },
      landlord
    )
    expect(recipients()).toEqual(['landlord-1', 'tenant-1'])
    const agreed = await service.respondToCounter(
      id,
      created._id.toHexString(),
      true,
      tenant
    )
    expect(recipients()).toEqual(['landlord-1', 'tenant-1', 'landlord-1'])
    expect(agreed.auditTrail.map(entry => entry.action)).toEqual([
      'submitted',
      'countered',
      'agreed',
    ])
  })

  it('blocks the tenant from deciding', async () => {
    const { service } = build()
    const created = await service.create(id, input, tenant)
    await expect(
      service.decide(
        id,
        created._id.toHexString(),
        { action: 'approve' },
        tenant
      )
    ).rejects.toThrow('OCCUPANT_REQUEST_LANDLORD_ONLY')
  })
})
