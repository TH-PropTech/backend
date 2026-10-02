import { ObjectId } from 'mongodb'
import { ContractsService } from './contracts.service'
import type { Contract } from './schemas/contract.schema'

describe('SmartCA two-party activation integration', () => {
  const artifactHash = 'a'.repeat(64)

  type IntegrationContext = {
    service: ContractsService
    contract: Contract
    deposit: { status: 'paid' | 'pending'; paidAt: Date | null }
    ledgerOutboxService: { enqueue: jest.Mock }
  }

  function setup(
    depositStatus: 'paid' | 'pending' = 'paid'
  ): IntegrationContext {
    const contract = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      contractCode: 'HD-SMARTCA-INTEGRATION',
      propertyId: 'property-1',
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      monthlyRent: 10_000_000,
      deposit: 20_000_000,
      depositAgreementId: '507f1f77bcf86cd799439099',
      startDate: new Date('2030-01-01T00:00:00.000Z'),
      status: 'awaiting-signature',
      signedByTenant: false,
      signedByLandlord: false,
      tenantSignature: null,
      landlordSignature: null,
      contentLockedHash: artifactHash,
      contentLockedAt: new Date('2029-12-01T00:00:00.000Z'),
      artifactRef: {
        artifactId: 'artifact-1',
        revision: 1,
        templateKey: 'lease-vn',
        templateVersion: 1,
        hashSchemaVersion: 1,
        artifactHash,
        contentType: 'application/pdf',
        lockedAt: new Date('2029-12-01T00:00:00.000Z'),
      },
      executionPolicySnapshot: {
        policyId: 'policy-1',
        version: 1,
        strategy: 'SIGN_FIRST',
        contentHash: 'policy-hash',
      },
    } as unknown as Contract
    const deposit = {
      _id: new ObjectId('507f1f77bcf86cd799439099'),
      status: depositStatus,
      depositHash: 'd'.repeat(64),
      paidAt:
        depositStatus === 'paid' ? new Date('2030-01-01T00:00:00.000Z') : null,
    }
    const contractRepository = {
      findOne: jest.fn().mockResolvedValue(contract),
      save: jest.fn((value: Contract) => Promise.resolve(value)),
    }
    const depositAgreementRepository = {
      findOne: jest.fn().mockImplementation(() => Promise.resolve(deposit)),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    }
    const ledgerOutboxService = { enqueue: jest.fn().mockResolvedValue({}) }
    const service = Object.create(
      ContractsService.prototype
    ) as ContractsService
    Reflect.set(service, 'contractRepository', contractRepository)
    Reflect.set(
      service,
      'depositAgreementRepository',
      depositAgreementRepository
    )
    Reflect.set(service, 'ledgerOutboxService', ledgerOutboxService)
    Reflect.set(service, 'fabricService', {
      getChaincodeAbiVersion: jest.fn().mockReturnValue(2),
    })
    Reflect.set(service, 'paymentsService', {
      generateSchedule: jest.fn().mockResolvedValue([]),
      generatePlatformFeeInvoices: jest.fn().mockResolvedValue([]),
    })
    Reflect.set(service, 'apartmentRepository', { findOne: jest.fn() })
    return { service, contract, deposit, ledgerOutboxService }
  }

  function evidence(
    role: 'tenant' | 'landlord',
    hash = artifactHash
  ): {
    contractId: string
    signerId: string
    role: 'tenant' | 'landlord'
    artifactHash: string
    providerTransactionId: string
    certificateSerial: string
    certificateSubject: string
    certificateIssuer: string
    signatureHash: string
    signedAt: Date
  } {
    return {
      contractId: '507f1f77bcf86cd799439011',
      signerId: `${role}-1`,
      role,
      artifactHash: hash,
      providerTransactionId: `tx-${role}`,
      certificateSerial: `cert-${role}`,
      certificateSubject: `CN=${role}`,
      certificateIssuer: 'CN=VNPT',
      signatureHash: `signature-${role}`,
      signedAt: new Date('2030-01-01T00:00:00.000Z'),
    } as const
  }

  it('enqueues only after both participants sign the same artifact and deposit is paid', async () => {
    const context = setup('paid')

    await context.service.recordSmartCaSignature(evidence('tenant'))
    expect(context.contract.status).toBe('awaiting-signature')
    expect(context.ledgerOutboxService.enqueue).not.toHaveBeenCalled()

    const activated = await context.service.recordSmartCaSignature(
      evidence('landlord')
    )
    expect(activated.status).toBe('active')
    expect(context.ledgerOutboxService.enqueue).toHaveBeenCalledTimes(1)
  })

  it('holds a fully signed contract until deposit and rejects another artifact revision', async () => {
    const context = setup('pending')

    await context.service.recordSmartCaSignature(evidence('tenant'))
    const pending = await context.service.recordSmartCaSignature(
      evidence('landlord')
    )
    expect(pending.status).toBe('fully-signed-pending-deposit')
    expect(context.ledgerOutboxService.enqueue).not.toHaveBeenCalled()

    await expect(
      context.service.recordSmartCaSignature(evidence('tenant', 'b'.repeat(64)))
    ).rejects.toThrow('SMARTCA_SIGNATURE_DIGEST_MISMATCH')

    context.deposit.status = 'paid'
    context.deposit.paidAt = new Date('2030-01-02T00:00:00.000Z')
    const activated = await context.service.recordSmartCaSignature(
      evidence('landlord')
    )
    expect(activated.status).toBe('active')
    expect(context.ledgerOutboxService.enqueue).toHaveBeenCalledTimes(1)
  })

  it('activates a fully signed SmartCA contract exactly once when its deposit arrives', async () => {
    const context = setup('pending')

    await context.service.recordSmartCaSignature(evidence('tenant'))
    await context.service.recordSmartCaSignature(evidence('landlord'))
    context.deposit.status = 'paid'
    context.deposit.paidAt = new Date('2030-01-02T00:00:00.000Z')

    const activated = await context.service.activateAfterDeposit(
      context.contract._id.toHexString()
    )
    const replay = await context.service.activateAfterDeposit(
      context.contract._id.toHexString()
    )

    expect(activated.status).toBe('active')
    expect(replay.status).toBe('active')
    expect(context.ledgerOutboxService.enqueue).toHaveBeenCalledTimes(1)
  })
})
