import { BadRequestException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { ContractAmendmentService } from './contract-amendment.service'
import type {
  Contract,
  ContractCommercialDraft,
} from './schemas/contract.schema'
import type { ContractAmendment } from './schemas/contract-amendment.schema'
import type { LedgerOutbox } from '../fabric/schemas/ledger-outbox.schema'
import { LedgerOutboxService } from '../fabric/ledger-outbox.service'

type AmendmentTestSetup = {
  contract: Contract
  amendment: ContractAmendment
  payments: Array<{
    _id: ObjectId
    status: string
    type: string
    dueDate: Date
    amount: number
    periodKey: string
    governingAmendmentId?: string
    governingAmendmentHash?: string | null
  }>
  amendmentRepository: Record<string, jest.Mock>
  contractRepository: Record<string, jest.Mock>
  paymentRepository: Record<string, jest.Mock>
  ledgerOutboxService: Record<string, jest.Mock>
  service: ContractAmendmentService
}

describe('ContractAmendmentService', () => {
  const contractId = new ObjectId('507f1f77bcf86cd799439011')
  const baseCommercial: ContractCommercialDraft = {
    monthlyRent: 15_000_000,
    deposit: 30_000_000,
    paymentDay: 1,
    latePenaltyRate: 8,
    terminationNoticeDays: 30,
    durationMonths: 12,
  }

  function setup(): AmendmentTestSetup {
    const contract = {
      _id: contractId,
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      status: 'active',
      monthlyRent: baseCommercial.monthlyRent,
      deposit: baseCommercial.deposit,
      paymentDay: baseCommercial.paymentDay,
      latePenaltyRate: baseCommercial.latePenaltyRate,
      terminationNoticeDays: baseCommercial.terminationNoticeDays,
      durationMonths: baseCommercial.durationMonths,
      effectiveCommercial: null,
      effectiveCommercialRevision: 0,
    } as unknown as Contract
    const amendment = {
      _id: new ObjectId('507f1f77bcf86cd799439012'),
      contractId: contractId.toHexString(),
      sequence: 1,
      status: 'draft',
      revision: 0,
      changes: [],
      beforeSnapshot: baseCommercial,
      afterSnapshot: { ...baseCommercial, monthlyRent: 17_000_000 },
      effectiveFrom: new Date(Date.now() + 86_400_000),
      predecessorId: null,
      contentHash: 'b'.repeat(64),
      artifactHash: null,
      artifactRef: null,
      tenantSignature: null,
      landlordSignature: null,
      ledgerStatus: 'not-requested',
      projectionAppliedAt: null,
    } as unknown as ContractAmendment
    const amendmentRepository = {
      findOne: jest.fn(({ where }: { where: unknown }) => {
        if (Array.isArray(where)) return null
        if (where && typeof where === 'object' && 'idempotencyKey' in where) {
          return null
        }
        return amendment
      }),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((input: Partial<ContractAmendment>) =>
        Object.assign(amendment, input)
      ),
      save: jest.fn().mockResolvedValue(amendment),
    }
    const contractRepository = {
      findOne: jest.fn().mockResolvedValue(contract),
      save: jest.fn().mockResolvedValue(contract),
    }
    const payments: Array<{
      _id: ObjectId
      status: string
      type: string
      dueDate: Date
      amount: number
      periodKey: string
      governingAmendmentId?: string
      governingAmendmentHash?: string | null
    }> = [
      {
        _id: new ObjectId(),
        status: 'pending',
        type: 'rent',
        dueDate: new Date(Date.now() + 10 * 86_400_000),
        amount: 15_000_000,
        periodKey: '2026-10',
      },
      {
        _id: new ObjectId(),
        status: 'paid',
        type: 'rent',
        dueDate: new Date(Date.now() + 10 * 86_400_000),
        amount: 15_000_000,
        periodKey: '2026-10-paid',
      },
    ]
    const paymentRepository = {
      find: jest.fn().mockResolvedValue(payments),
      save: jest.fn().mockImplementation((payment: unknown) => payment),
    }
    const ledgerOutboxService = { enqueue: jest.fn().mockResolvedValue({}) }
    return {
      contract,
      amendment,
      payments,
      amendmentRepository,
      contractRepository,
      paymentRepository,
      ledgerOutboxService,
      service: new ContractAmendmentService(
        amendmentRepository as never,
        contractRepository as never,
        paymentRepository as never,
        undefined,
        ledgerOutboxService as never,
        undefined
      ),
    }
  }

  it('creates a future commercial amendment and rejects protected fields', async () => {
    const { service, amendment } = setup()
    const future = new Date(Date.now() + 86_400_000).toISOString()

    const created = await service.create(
      contractId.toHexString(),
      {
        changes: [{ field: 'monthlyRent', after: 17_000_000 }],
        effectiveFrom: future,
        idempotencyKey: 'amendment-1',
      },
      { actorId: 'admin-1', isStaff: true }
    )

    expect(created).toBe(amendment)
    expect(amendment.sequence).toBe(1)
    expect(amendment.changes).toEqual([
      expect.objectContaining({ field: 'monthlyRent', after: 17_000_000 }),
    ])

    await expect(
      service.create(
        contractId.toHexString(),
        {
          changes: [{ field: 'legalProfile', after: 'OTHER' }],
          effectiveFrom: future,
        },
        { actorId: 'admin-1', isStaff: true }
      )
    ).rejects.toThrow(BadRequestException)
  })

  it('locks the amendment with optimistic concurrency and binds both signatures to one artifact', async () => {
    const { service, contract, amendment, payments, ledgerOutboxService } =
      setup()
    amendment.status = 'locked'
    amendment.revision = 2
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
    amendment.status = 'pending-signature'

    await expect(
      service.sign(
        contractId.toHexString(),
        amendment._id.toHexString(),
        1,
        amendment.artifactHash,
        { actorId: 'tenant-1', isStaff: false, role: 'tenant' }
      )
    ).rejects.toThrow('CONTRACT_AMENDMENT_REVISION_STALE')

    await service.sign(
      contractId.toHexString(),
      amendment._id.toHexString(),
      2,
      amendment.artifactHash,
      { actorId: 'tenant-1', isStaff: false, role: 'tenant' }
    )
    await service.sign(
      contractId.toHexString(),
      amendment._id.toHexString(),
      3,
      amendment.artifactHash,
      { actorId: 'landlord-1', isStaff: false, role: 'landlord' }
    )

    expect(amendment.status).toBe('effective')
    expect(contract.monthlyRent).toBe(baseCommercial.monthlyRent)
    expect(contract.effectiveCommercial).toEqual(
      expect.objectContaining({ monthlyRent: 17_000_000 })
    )
    expect(payments[0]!.amount).toBe(17_000_000)
    expect(payments[0]!.governingAmendmentId).toBe(amendment._id.toHexString())
    expect(payments[1]!.amount).toBe(15_000_000)
    expect(ledgerOutboxService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateType: 'contract-amendment',
        action: 'recordContractAmendment',
        args: [contractId.toHexString(), amendment.contentHash],
      })
    )
  })

  it('rejects a pending amendment without changing the governing commercial terms', async () => {
    const { service, amendment, contract } = setup()
    amendment.status = 'pending-signature'
    amendment.revision = 2

    const rejected = await service.reject(
      contractId.toHexString(),
      amendment._id.toHexString(),
      2,
      { actorId: 'tenant-1', isStaff: false, role: 'tenant' }
    )

    expect(rejected.status).toBe('rejected')
    expect(rejected.rejectedAt).toBeInstanceOf(Date)
    expect(rejected.revision).toBe(3)
    expect(contract.effectiveCommercial).toBeNull()
  })

  it('fails closed when an amendment attempts a retroactive effective date', async () => {
    const { service } = setup()

    await expect(
      service.create(
        contractId.toHexString(),
        {
          changes: [{ field: 'monthlyRent', after: 18_000_000 }],
          effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
        },
        { actorId: 'admin-1', isStaff: true }
      )
    ).rejects.toThrow('CONTRACT_AMENDMENT_EFFECTIVE_DATE_INVALID')
  })

  it('activates concurrent duplicate signature requests once and enqueues one ledger event', async () => {
    const { service, contract, amendment, ledgerOutboxService } = setup()
    amendment.status = 'pending-signature'
    amendment.revision = 2
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
    amendment.tenantSignature = {
      signerId: 'tenant-1',
      role: 'tenant',
      signedAt: new Date(),
      contentHash: amendment.contentHash ?? '',
      artifactHash: amendment.artifactHash,
      providerStatus: 'signed',
    }

    await Promise.all([
      service.sign(
        contractId.toHexString(),
        amendment._id.toHexString(),
        2,
        amendment.artifactHash,
        { actorId: 'landlord-1', isStaff: false, role: 'landlord' }
      ),
      service.sign(
        contractId.toHexString(),
        amendment._id.toHexString(),
        2,
        amendment.artifactHash,
        { actorId: 'landlord-1', isStaff: false, role: 'landlord' }
      ),
    ])

    expect(amendment.status).toBe('effective')
    expect(contract.effectiveCommercial).toEqual(
      expect.objectContaining({ monthlyRent: 17_000_000 })
    )
    expect(ledgerOutboxService.enqueue).toHaveBeenCalledTimes(1)
  })

  it('keeps an effective amendment and retryable outbox event when Fabric is unavailable', async () => {
    const {
      amendment,
      paymentRepository,
      contractRepository,
      amendmentRepository,
    } = setup()
    amendment.status = 'pending-signature'
    amendment.revision = 2
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

    let outboxEvent: LedgerOutbox | null = null
    const outboxRepository = {
      findOne: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        if ('_id' in where) return outboxEvent
        return null
      }),
      find: jest.fn(() =>
        outboxEvent?.status === 'pending' ? [outboxEvent] : []
      ),
      create: jest.fn((input: Partial<LedgerOutbox>) =>
        Object.assign({ _id: new ObjectId() } as LedgerOutbox, input)
      ),
      save: jest.fn((event: LedgerOutbox) => {
        outboxEvent = event
        return event
      }),
    }
    const fabricService = {
      submitTransaction: jest
        .fn()
        .mockRejectedValue(new Error('FABRIC_GATEWAY_UNAVAILABLE')),
    }
    const projectionService = { projectResult: jest.fn() }
    const outboxService = new LedgerOutboxService(
      outboxRepository as never,
      fabricService as never,
      projectionService as never
    )
    const service = new ContractAmendmentService(
      amendmentRepository as never,
      contractRepository as never,
      paymentRepository as never,
      undefined,
      outboxService,
      undefined
    )

    await service.sign(
      contractId.toHexString(),
      amendment._id.toHexString(),
      2,
      amendment.artifactHash,
      { actorId: 'tenant-1', isStaff: false, role: 'tenant' }
    )
    await service.sign(
      contractId.toHexString(),
      amendment._id.toHexString(),
      3,
      amendment.artifactHash,
      { actorId: 'landlord-1', isStaff: false, role: 'landlord' }
    )

    expect(amendment.status).toBe('effective')
    expect(amendment.ledgerStatus).toBe('pending')
    const eventAfterActivation = outboxEvent as LedgerOutbox | null
    expect(eventAfterActivation?.status).toBe('pending')

    await outboxService.processPending()

    const eventAfterProcessing = outboxEvent as LedgerOutbox | null
    expect(eventAfterProcessing?.status).toBe('pending')
    expect(eventAfterProcessing?.attempts).toBe(1)
    expect(eventAfterProcessing?.lastError).toBe('FABRIC_GATEWAY_UNAVAILABLE')
    expect(projectionService.projectResult).not.toHaveBeenCalled()
  })
})
