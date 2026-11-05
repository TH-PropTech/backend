import { ObjectId } from 'mongodb'
import { ContractChangeRequestService } from './contract-change-request.service'
import type { Contract } from '../schemas/contract.schema'
import type { ContractChangeRequest } from '../schemas/contract-change-request.schema'

const contractId = '507f1f77bcf86cd799439033'
const landlord = { actorId: 'landlord-1', isStaff: false }
const tenant = { actorId: 'tenant-1', isStaff: false }
const admin = { actorId: 'admin-1', isStaff: true }
const outsider = { actorId: 'other', isStaff: false }

type Harness = {
  service: ContractChangeRequestService
  contract: Contract
  stored: ContractChangeRequest[]
  contracts: { findOne: jest.Mock; save: jest.Mock }
  notifications: { createNotification: jest.Mock }
}

function setup(overrides: Partial<Contract> = {}): Harness {
  const contract = {
    _id: new ObjectId(contractId),
    landlordId: 'landlord-1',
    tenantId: 'tenant-1',
    monthlyRent: 12_000_000,
    deposit: 24_000_000,
    paymentDay: 1,
    latePenaltyRate: 0,
    terminationNoticeDays: 30,
    durationMonths: 12,
    status: 'draft',
    commercialRevision: 0,
    commercialDraft: null,
    commercialAudit: [],
    contentLockedHash: null,
    contentLockedAt: null,
    ...overrides,
  } as unknown as Contract
  const stored: ContractChangeRequest[] = []
  const requests = {
    find: jest.fn(
      ({ where }: { where: { contractId: string; status?: string } }) =>
        Promise.resolve(
          stored
            .filter(
              item =>
                item.contractId === where.contractId &&
                (where.status === undefined || item.status === where.status)
            )
            .sort((a, b) => b.sequence - a.sequence)
        )
    ),
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        stored.find(
          item =>
            item.contractId === where['contractId'] &&
            (where['idempotencyKey'] === undefined ||
              item.idempotencyKey === where['idempotencyKey']) &&
            (where['_id'] === undefined ||
              item._id.toHexString() ===
                (where['_id'] as ObjectId).toHexString())
        ) ?? null
      )
    ),
    create: jest.fn(
      (value: Partial<ContractChangeRequest>) =>
        ({ _id: new ObjectId(), ...value }) as ContractChangeRequest
    ),
    save: jest.fn((value: ContractChangeRequest) => {
      if (!stored.includes(value)) stored.push(value)
      return Promise.resolve(value)
    }),
  }
  const contracts = {
    findOne: jest.fn().mockResolvedValue(contract),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
  }
  const notifications = { createNotification: jest.fn().mockResolvedValue({}) }
  const service = new ContractChangeRequestService(
    requests as never,
    contracts as never,
    undefined,
    notifications as never
  )
  return { service, contract, stored, contracts, notifications }
}

const noticeChange = {
  changes: [{ field: 'terminationNoticeDays', after: 45 }],
  reason: 'Cần báo trước lâu hơn',
  expectedRevision: 0,
}

function withChange(
  field: string,
  after: unknown
): Omit<typeof noticeChange, 'changes'> & {
  changes: Array<{ field: string; after: unknown }>
} {
  return { ...noticeChange, changes: [{ field, after }] }
}

describe('ContractChangeRequestService', () => {
  it('lets the landlord request a change and notifies the tenant', async () => {
    const { service, notifications } = setup()
    const request = await service.create(contractId, noticeChange, landlord)
    expect(request.status).toBe('pending-counterparty')
    expect(request.requestedRole).toBe('landlord')
    expect(request.changes).toEqual([
      { field: 'terminationNoticeDays', before: 30, after: 45 },
    ])
    expect(notifications.createNotification).toHaveBeenCalledWith(
      'tenant-1',
      expect.any(String),
      expect.any(String),
      'contract-change-request',
      expect.objectContaining({ contractId })
    )
  })

  it('rejects a second open request with CONTRACT_CHANGE_REQUEST_IN_PROGRESS', async () => {
    const { service } = setup()
    await service.create(contractId, noticeChange, landlord)
    await expect(
      service.create(contractId, noticeChange, tenant)
    ).rejects.toThrow('CONTRACT_CHANGE_REQUEST_IN_PROGRESS')
  })

  it('returns the existing request for a repeated idempotency key', async () => {
    const { service, stored } = setup()
    const input = { ...noticeChange, idempotencyKey: 'key-1' }
    const first = await service.create(contractId, input, landlord)
    const second = await service.create(contractId, input, landlord)
    expect(second).toBe(first)
    expect(stored).toHaveLength(1)
  })

  it('refuses outsiders, locked drafts and stale revisions', async () => {
    await expect(
      setup().service.create(contractId, noticeChange, outsider)
    ).rejects.toThrow('CONTRACT_CHANGE_REQUEST_ACCESS_DENIED')
    await expect(
      setup({ contentLockedHash: 'abc' }).service.create(
        contractId,
        noticeChange,
        landlord
      )
    ).rejects.toThrow('CONTRACT_CONTENT_LOCKED')
    await expect(
      setup({ commercialRevision: 2 }).service.create(
        contractId,
        noticeChange,
        landlord
      )
    ).rejects.toThrow('CONTRACT_REVISION_STALE')
  })

  it('refuses no-op, illegal and non-allowlisted changes', async () => {
    await expect(
      setup().service.create(
        contractId,
        withChange('terminationNoticeDays', 30),
        landlord
      )
    ).rejects.toThrow('CONTRACT_CHANGE_REQUEST_NO_CHANGE')
    await expect(
      setup().service.create(
        contractId,
        withChange('latePenaltyRate', 30),
        landlord
      )
    ).rejects.toMatchObject({
      response: { message: 'CONTRACT_CHANGE_REQUEST_VIOLATES_LAW' },
    })
    await expect(
      setup().service.create(
        contractId,
        withChange('legalProfile', 'X'),
        landlord
      )
    ).rejects.toThrow('CONTRACT_CHANGE_FIELD_NOT_ALLOWED')
  })

  it('applies the change to the draft when the tenant accepts', async () => {
    const { service, contract, contracts } = setup()
    const request = await service.create(
      contractId,
      {
        changes: [
          { field: 'monthlyRent', after: 13_000_000 },
          { field: 'customClauses', after: 'Không nuôi thú cưng.' },
        ],
        reason: 'Điều chỉnh giá',
        expectedRevision: 0,
      },
      landlord
    )
    const accepted = await service.accept(
      contractId,
      request._id.toHexString(),
      tenant
    )
    expect(accepted.status).toBe('applied')
    expect(contract.commercialRevision).toBe(1)
    expect(contract.commercialDraft?.monthlyRent).toBe(13_000_000)
    expect(contract.customClauses).toBe('Không nuôi thú cưng.')
    expect(contract.consentedTerms).toEqual({
      monthlyRent: 13_000_000,
      deposit: 24_000_000,
      durationMonths: 12,
    })
    expect(contract.commercialAudit?.[0]?.changedFields).toEqual([
      'monthlyRent',
      'customClauses',
    ])
    expect(contracts.save).toHaveBeenCalledTimes(1)
  })

  it('does not record consent when only non-consent fields change', async () => {
    const { service, contract } = setup()
    const request = await service.create(contractId, noticeChange, landlord)
    await service.accept(contractId, request._id.toHexString(), tenant)
    expect(contract.consentedTerms).toBeUndefined()
  })

  it('blocks self-decision and any admin acceptance', async () => {
    const { service } = setup()
    const request = await service.create(contractId, noticeChange, landlord)
    const id = request._id.toHexString()
    await expect(service.accept(contractId, id, landlord)).rejects.toThrow(
      'CONTRACT_CHANGE_REQUEST_SELF_DECISION'
    )
    await expect(service.accept(contractId, id, admin)).rejects.toThrow(
      'CONTRACT_CHANGE_REQUEST_ACCESS_DENIED'
    )
  })

  it('refuses to apply when the draft moved on after the request', async () => {
    const { service, contract } = setup()
    const request = await service.create(contractId, noticeChange, landlord)
    contract.commercialRevision = 1
    await expect(
      service.accept(contractId, request._id.toHexString(), tenant)
    ).rejects.toThrow('CONTRACT_REVISION_STALE')
    expect(contract.commercialDraft).toBeNull()
  })

  it('keeps the draft unchanged when the tenant rejects', async () => {
    const { service, contract } = setup()
    const request = await service.create(contractId, noticeChange, landlord)
    const rejected = await service.reject(
      contractId,
      request._id.toHexString(),
      'Không đồng ý',
      tenant
    )
    expect(rejected.status).toBe('rejected')
    expect(rejected.decisionReason).toBe('Không đồng ý')
    expect(contract.commercialDraft).toBeNull()
  })

  it('lets the requester withdraw and the admin close a stalled request', async () => {
    const first = setup()
    const own = await first.service.create(contractId, noticeChange, landlord)
    const ownId = own._id.toHexString()
    await expect(
      first.service.cancel(contractId, ownId, 'Nhầm', tenant)
    ).rejects.toThrow('CONTRACT_CHANGE_REQUEST_ACCESS_DENIED')
    const withdrawn = await first.service.cancel(
      contractId,
      ownId,
      'Nhầm',
      landlord
    )
    expect(withdrawn.status).toBe('cancelled')

    const second = setup()
    const stalled = await second.service.create(
      contractId,
      noticeChange,
      tenant
    )
    const closed = await second.service.cancel(
      contractId,
      stalled._id.toHexString(),
      'Quá hạn',
      admin
    )
    expect(closed.status).toBe('cancelled')
  })

  it('expires a request past its deadline and allows a new one', async () => {
    const { service, stored } = setup()
    const request = await service.create(contractId, noticeChange, landlord)
    stored[0]!.expiresAt = new Date(Date.now() - 1000)
    await expect(
      service.accept(contractId, request._id.toHexString(), tenant)
    ).rejects.toThrow('CONTRACT_CHANGE_REQUEST_NOT_PENDING')
    expect(stored[0]!.status).toBe('expired')
    const next = await service.create(contractId, noticeChange, landlord)
    expect(next.sequence).toBe(2)
  })

  it('lists for participants and staff only', async () => {
    const { service } = setup()
    await service.create(contractId, noticeChange, landlord)
    const asAdmin = await service.list(contractId, admin)
    expect(asAdmin.items).toHaveLength(1)
    expect(asAdmin).toMatchObject({ commercialRevision: 0, locked: false })
    expect((await service.list(contractId, tenant)).items).toHaveLength(1)
    await expect(service.list(contractId, outsider)).rejects.toThrow(
      'CONTRACT_CHANGE_REQUEST_ACCESS_DENIED'
    )
  })
})
