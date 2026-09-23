import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common'

import type { EkycProxyService } from '../kyc/ekyc-proxy.service'
import type { KycMediaService } from '../kyc/kyc-media.service'
import type { KycService } from '../kyc/kyc.service'
import { ObjectId } from 'mongodb'
import { ContractsService } from './contracts.service'
import type { Contract } from './schemas/contract.schema'

describe('ContractsService application draft factory', () => {
  it('creates a non-active draft from the immutable package snapshot and reuses it', async () => {
    const repository = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ contractCode: 'HD-APP-app-1' }),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    }
    const service = Object.create(
      ContractsService.prototype
    ) as ContractsService
    Reflect.set(service, 'contractRepository', repository)
    const input = {
      rentalApplicationId: 'app-1',
      depositAgreementId: 'dpa-1',
      propertyId: 'apt-1',
      propertyTitle: 'Sunrise',
      propertyAddress: '1 Example',
      propertyArea: 68,
      propertyFurniture: null,
      landlordId: 'landlord-1',
      tenantId: 'tenant-1',
      moveInDate: new Date('2030-01-01'),
      packageSnapshot: {
        packageId: 'pkg-12',
        version: 2,
        durationMonths: 12 as const,
        monthlyRent: 12_000_000,
        depositPolicy: { type: 'MONTHS_OF_RENT' as const, months: 2 },
        resolvedDepositAmount: 24_000_000,
        currency: 'VND' as const,
      },
    }
    const created = await service.createDraftFromApplication(input)
    const reused = await service.createDraftFromApplication(input)
    expect(created.status).toBe('draft')
    expect(created.legacyFlow).toBe(false)
    expect(created.deposit).toBe(24_000_000)
    expect(created.rentalApplicationId).toBe('app-1')
    expect(reused.contractCode).toBe('HD-APP-app-1')
    expect(repository.save).toHaveBeenCalledTimes(1)
  })
})

function createService(options?: { kycStatus?: string }): {
  service: ContractsService
  kycService: { findByUserId: jest.Mock }
  media: { asMulterFile: jest.Mock }
  proxy: { verifyFace: jest.Mock }
} {
  const kycService = {
    findByUserId: jest.fn().mockResolvedValue({
      status: options?.kycStatus ?? 'verified',
      frontCardUrl: 'kyc-media:owner:front-card:id',
    }),
  }
  const media = {
    asMulterFile: jest.fn().mockResolvedValue({ fieldname: 'frontID' }),
  }
  const proxy = {
    verifyFace: jest.fn().mockResolvedValue({
      verified: true,
      faceMatch: true,
      liveness: true,
      realConfidence: 0.91,
    }),
  }
  const service = Object.create(ContractsService.prototype) as ContractsService
  Reflect.set(service, 'logger', { log: jest.fn(), warn: jest.fn() })
  Reflect.set(service, 'kycService', kycService as unknown as KycService)
  Reflect.set(service, 'kycMediaService', media as unknown as KycMediaService)
  Reflect.set(service, 'ekycProxyService', proxy as unknown as EkycProxyService)
  jest.spyOn(service, 'findOne').mockResolvedValue({
    tenantId: '507f1f77bcf86cd799439011',
    landlordId: '507f1f77bcf86cd799439012',
  } as never)
  return { service, kycService, media, proxy }
}

describe('ContractsService.verifySigner', () => {
  it('compares the selfie with the decrypted verified KYC card', async () => {
    const { service, media, proxy } = createService()
    const selfie = { fieldname: 'selfie' } as Express.Multer.File

    await expect(
      service.verifySigner('contract-id', 'tenant', selfie)
    ).resolves.toEqual({
      verified: true,
      faceMatch: true,
      liveness: true,
      spoofScore: 0.91,
    })
    expect(media.asMulterFile).toHaveBeenCalledWith(
      'kyc-media:owner:front-card:id',
      'frontID'
    )
    expect(proxy.verifyFace).toHaveBeenCalledWith(
      selfie,
      expect.objectContaining({ fieldname: 'frontID' })
    )
  })

  it('rejects a signer whose KYC record is not verified', async () => {
    const { service, proxy } = createService({ kycStatus: 'pending' })

    await expect(
      service.verifySigner('contract-id', 'tenant', {} as Express.Multer.File)
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(proxy.verifyFace).not.toHaveBeenCalled()
  })

  it('fails closed when the eKYC provider is unavailable', async () => {
    const { service, proxy } = createService()
    proxy.verifyFace.mockRejectedValue(new BadGatewayException('unavailable'))

    await expect(
      service.verifySigner('contract-id', 'landlord', {} as Express.Multer.File)
    ).rejects.toBeInstanceOf(BadGatewayException)
  })
})

describe('ContractsService.signContractForUser', () => {
  it('rejects a non-participant before reading a signing grant', async () => {
    const { service } = createService()

    await expect(
      service.signContractForUser('contract-id', 'outsider', 'sg_invalid')
    ).rejects.toThrow('CONTRACT_SIGN_ACCESS_DENIED')
  })
})

describe('ContractsService public-service checklist', () => {
  it('scopes the checklist to an authorized participant and never completes the external procedure', async () => {
    const service = Object.create(
      ContractsService.prototype
    ) as ContractsService
    const findOneForUser = jest
      .spyOn(service, 'findOneForUser')
      .mockResolvedValue({
        executionMethod: 'POC_ECONSENT',
        notarizationStatus: 'not-requested',
        contentLockedHash: 'a'.repeat(64),
        signedByTenant: true,
        signedByLandlord: true,
      } as never)

    const result = await service.getPublicServiceChecklistForUser(
      'contract-id',
      'tenant-id',
      false,
      'temporary-residence'
    )

    expect(result).toEqual(
      expect.objectContaining({
        purpose: 'temporary-residence',
        executionMethod: 'POC_ECONSENT',
        notarizationStatus: 'not-requested',
      })
    )
    expect(result.externalProcedureCompleted).toBe(false)
    expect(findOneForUser).toHaveBeenCalledWith(
      'contract-id',
      'tenant-id',
      false
    )
  })
})

describe('ContractsService contract content', () => {
  function createContentService(): {
    service: ContractsService
    contract: Contract
    repository: { findOne: jest.Mock; save: jest.Mock }
  } {
    const contract = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      propertyId: 'property-1',
      propertyTitle: 'Apartment',
      propertyAddress: 'Address',
      monthlyRent: 10_000_000,
      deposit: 20_000_000,
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2027-10-01T00:00:00.000Z'),
      status: 'draft' as const,
      contentRevision: 0,
      editorContent: null,
      contentLockedHash: null,
      contentLockedAt: null,
      appliedPolicies: {},
      packageSnapshot: null,
    } as unknown as Contract
    const repository = {
      findOne: jest.fn().mockResolvedValue(contract),
      save: jest.fn(
        (value: unknown): Promise<unknown> => Promise.resolve(value)
      ),
    }
    const service = Object.create(
      ContractsService.prototype
    ) as ContractsService
    Reflect.set(service, 'contractRepository', repository)
    return { service, contract, repository }
  }

  const validContent = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Lease terms', marks: [{ type: 'bold' }] },
        ],
      },
    ],
  }

  it('sanitizes and versions editable content', async () => {
    const { service, contract, repository } = createContentService()
    const result = await service.saveContractContent(
      contract._id.toString(),
      'landlord-1',
      { ...validContent, unknown: '<script>' },
      0,
      false
    )

    expect(result.contentRevision).toBe(1)
    expect(result.editorContent).not.toHaveProperty('unknown')
    expect(repository.save).toHaveBeenCalled()
  })

  it('rejects stale revisions and non-owner edits', async () => {
    const { service, contract } = createContentService()

    await expect(
      service.saveContractContent(
        contract._id.toString(),
        'landlord-1',
        validContent,
        1,
        false
      )
    ).rejects.toBeInstanceOf(ConflictException)
    await expect(
      service.saveContractContent(
        contract._id.toString(),
        'tenant-1',
        validContent,
        0,
        false
      )
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('locks content with a deterministic hash and is idempotent', async () => {
    const { service, contract } = createContentService()
    contract.editorContent = validContent
    contract.contentRevision = 1

    const locked = await service.lockContractContent(
      contract._id.toString(),
      'staff-1',
      1,
      true
    )
    expect(locked.status).toBe('awaiting-signature')
    expect(locked.contentLockedHash).toMatch(/^[a-f0-9]{64}$/)
    expect(locked.contentRevision).toBe(2)

    const replay = await service.lockContractContent(
      contract._id.toString(),
      'staff-1',
      1,
      true
    )
    expect(replay.contentLockedHash).toBe(locked.contentLockedHash)
  })

  it('allows landlord to lock contract content without staff role', async () => {
    const { service, contract } = createContentService()
    contract.editorContent = validContent
    contract.contentRevision = 1
    contract.landlordId = 'landlord-1'

    const locked = await service.lockContractContent(
      contract._id.toString(),
      'landlord-1',
      1,
      false
    )
    expect(locked.status).toBe('awaiting-signature')
    expect(locked.contentLockedHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('forbids tenant from locking contract content', async () => {
    const { service, contract } = createContentService()
    contract.editorContent = validContent
    contract.contentRevision = 1
    contract.landlordId = 'landlord-1'
    contract.tenantId = 'tenant-1'

    await expect(
      service.lockContractContent(contract._id.toString(), 'tenant-1', 1, false)
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('rejects edits after content is locked', async () => {
    const { service, contract } = createContentService()
    contract.contentLockedAt = new Date()
    contract.contentLockedHash = 'a'.repeat(64)

    await expect(
      service.saveContractContent(
        contract._id.toString(),
        'staff-1',
        validContent,
        0,
        true
      )
    ).rejects.toThrow('CONTRACT_CONTENT_LOCKED')
  })
})

describe('ContractsService.terminateContract', () => {
  function createTerminationService(): {
    service: ContractsService
    contract: Contract
    apartment: { status: string; isVerified: boolean }
    contractRepository: { save: jest.Mock }
    apartmentRepository: { findOne: jest.Mock; save: jest.Mock }
    ledgerOutboxService: { enqueue: jest.Mock }
  } {
    const contract = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      propertyId: '507f1f77bcf86cd799439012',
      status: 'active' as const,
      terminationIdempotencyKey: null,
      terminationReason: null,
      terminationReasonCode: null,
      terminatedAt: null,
      terminationTxHash: null,
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
    } as unknown as Contract
    const apartment = { status: 'unavailable', isVerified: false }
    const contractRepository = {
      save: jest.fn(
        (value: unknown): Promise<unknown> => Promise.resolve(value)
      ),
    }
    const apartmentRepository = {
      findOne: jest.fn().mockResolvedValue(apartment),
      save: jest.fn(
        (value: unknown): Promise<unknown> => Promise.resolve(value)
      ),
    }
    const ledgerOutboxService = { enqueue: jest.fn().mockResolvedValue({}) }
    const service = Object.create(
      ContractsService.prototype
    ) as ContractsService
    Reflect.set(service, 'contractRepository', contractRepository)
    Reflect.set(service, 'apartmentRepository', apartmentRepository)
    Reflect.set(service, 'ledgerOutboxService', ledgerOutboxService)
    jest.spyOn(service, 'findOne').mockResolvedValue(contract)
    return {
      service,
      contract,
      apartment,
      contractRepository,
      apartmentRepository,
      ledgerOutboxService,
    }
  }

  it('terminates an active contract, releases the apartment, and enqueues a sanitized ledger event', async () => {
    const context = createTerminationService()

    const result = await context.service.terminateContract(
      context.contract._id.toHexString(),
      'staff-1',
      'LANDLORD_REQUEST',
      'Tenant requested termination with private details',
      'term-1'
    )

    expect(result.status).toBe('terminated')
    expect(context.apartment.status).toBe('available')
    expect(context.apartment.isVerified).toBe(true)
    expect(context.ledgerOutboxService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'terminateContract',
        eventType: 'contract.terminated',
        args: [
          context.contract._id.toHexString(),
          'LANDLORD_REQUEST',
          expect.stringMatching(/^[a-f0-9]{64}$/),
          expect.any(String),
        ],
      })
    )
  })

  it('replays the same idempotency key without changing state or creating a second event', async () => {
    const context = createTerminationService()
    await context.service.terminateContract(
      context.contract._id.toHexString(),
      'staff-1',
      'LANDLORD_REQUEST',
      'Tenant requested termination',
      'term-1'
    )
    context.ledgerOutboxService.enqueue.mockClear()

    await context.service.terminateContract(
      context.contract._id.toHexString(),
      'staff-1',
      'LANDLORD_REQUEST',
      'Different retry text is ignored',
      'term-1'
    )

    expect(context.contractRepository.save).toHaveBeenCalledTimes(1)
    expect(context.apartmentRepository.save).toHaveBeenCalledTimes(1)
    expect(context.ledgerOutboxService.enqueue).toHaveBeenCalledTimes(1)
  })

  it('rejects a different idempotency key after termination', async () => {
    const context = createTerminationService()
    context.contract.status = 'terminated'
    context.contract.terminationIdempotencyKey = 'term-1'

    await expect(
      context.service.terminateContract(
        context.contract._id.toHexString(),
        'staff-1',
        'LANDLORD_REQUEST',
        'Reason',
        'term-2'
      )
    ).rejects.toThrow('CONTRACT_ALREADY_TERMINATED')
  })

  it('rejects non-active contracts and invalid termination input', async () => {
    const context = createTerminationService()
    context.contract.status = 'awaiting-signature'
    await expect(
      context.service.terminateContract(
        context.contract._id.toHexString(),
        'staff-1',
        'CODE',
        'Reason',
        'term-1'
      )
    ).rejects.toThrow('CONTRACT_TERMINATION_REQUIRES_ACTIVE')

    context.contract.status = 'active'
    await expect(
      context.service.terminateContract(
        context.contract._id.toHexString(),
        'staff-1',
        ' ',
        'Reason',
        'term-1'
      )
    ).rejects.toThrow('TERMINATION_FIELDS_REQUIRED')
  })
})

describe('ContractsService activation', () => {
  it('queues activation and generates an idempotent rent schedule after the second signature', async () => {
    const contract = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      contractCode: 'HD-1',
      propertyId: 'property-1',
      propertyTitle: 'Apartment',
      propertyAddress: null,
      propertyArea: null,
      landlordId: 'landlord-1',
      landlordName: null,
      landlordCccd: null,
      tenantId: 'tenant-1',
      tenantName: null,
      tenantCccd: null,
      monthlyRent: 10_000_000,
      deposit: 20_000_000,
      latePenaltyRate: 0,
      terminationNoticeDays: 30,
      startDate: new Date('2030-01-01T00:00:00.000Z'),
      endDate: new Date('2030-03-01T00:00:00.000Z'),
      status: 'awaiting-signature' as const,
      signedByTenant: true,
      signedByLandlord: false,
      contractHash: null,
      blockchainAddress: null,
      appliedPolicies: null,
      depositAgreementId: '507f1f77bcf86cd799439099',
      depositId: null,
      depositTxHash: null,
    } as unknown as Contract

    const contractRepository = {
      findOne: jest.fn().mockResolvedValue(contract),
      save: jest.fn(
        (value: Contract): Promise<Contract> => Promise.resolve(value)
      ),
    }
    const ledgerOutboxService = { enqueue: jest.fn().mockResolvedValue({}) }
    const paymentsService = {
      generateSchedule: jest.fn().mockResolvedValue([]),
    }
    const service = Object.create(
      ContractsService.prototype
    ) as ContractsService
    Reflect.set(service, 'contractRepository', contractRepository)
    Reflect.set(service, 'policiesService', {
      findAll: jest.fn().mockResolvedValue([]),
    })
    Reflect.set(service, 'kycService', {
      findByUserId: jest.fn().mockResolvedValue({ status: 'verified' }),
    })
    Reflect.set(service, 'ledgerOutboxService', ledgerOutboxService)
    const depositAgreementRepository = {
      findOne: jest.fn().mockResolvedValue({
        _id: new ObjectId('507f1f77bcf86cd799439099'),
        status: 'paid',
        depositHash: 'd'.repeat(64),
      }),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    }
    Reflect.set(
      service,
      'depositAgreementRepository',
      depositAgreementRepository
    )
    Reflect.set(service, 'paymentsService', paymentsService)
    Reflect.set(service, 'logger', { log: jest.fn() })

    const result = await service.signContract(
      contract._id.toHexString(),
      'landlord'
    )

    expect(result.status).toBe('active')
    expect(result.ledgerStatus).toBe('pending')
    expect(result.depositHash).toBe('d'.repeat(64))
    expect(ledgerOutboxService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'contract.activated',
        action: 'createContract',
        dependencyKey: 'deposit:507f1f77bcf86cd799439099:deposit.paid',
      })
    )
    expect(paymentsService.generateSchedule).toHaveBeenCalledWith(contract)
  })

  it('rejects contract activation if positive deposit is not paid', async () => {
    const contract = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      deposit: 20_000_000,
      status: 'awaiting-signature' as const,
      signedByTenant: true,
      signedByLandlord: false,
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
    } as unknown as Contract
    const contractRepository = {
      findOne: jest.fn().mockResolvedValue(contract),
    }
    const depositAgreementRepository = {
      findOne: jest.fn().mockResolvedValue({
        status: 'pending',
      }),
    }
    const service = Object.create(
      ContractsService.prototype
    ) as ContractsService
    Reflect.set(service, 'contractRepository', contractRepository)
    Reflect.set(
      service,
      'depositAgreementRepository',
      depositAgreementRepository
    )
    Reflect.set(service, 'kycService', {
      findByUserId: jest.fn().mockResolvedValue({ status: 'verified' }),
    })

    await expect(
      service.signContract(contract._id.toHexString(), 'landlord')
    ).rejects.toThrow(
      'Hợp đồng yêu cầu tiền cọc đã thanh toán trước khi có hiệu lực'
    )
  })

  it('persists fully-signed-pending-deposit for the sign-first policy', async () => {
    const contract = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      deposit: 20_000_000,
      depositPaidAt: null,
      status: 'awaiting-signature' as const,
      signedByTenant: true,
      signedByLandlord: false,
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      executionPolicySnapshot: {
        policyId: 'sign-first',
        version: 1,
        strategy: 'SIGN_FIRST' as const,
        contentHash: 'policy-hash',
      },
    } as unknown as Contract
    const contractRepository = {
      findOne: jest.fn().mockResolvedValue(contract),
      save: jest.fn(
        (value: Contract): Promise<Contract> => Promise.resolve(value)
      ),
    }
    const depositAgreementRepository = {
      findOne: jest.fn().mockResolvedValue({ status: 'pending' }),
    }
    const service = Object.create(
      ContractsService.prototype
    ) as ContractsService
    Reflect.set(service, 'contractRepository', contractRepository)
    Reflect.set(
      service,
      'depositAgreementRepository',
      depositAgreementRepository
    )
    Reflect.set(service, 'kycService', {
      findByUserId: jest.fn().mockResolvedValue({ status: 'verified' }),
    })

    const result = await service.signContract(
      contract._id.toHexString(),
      'landlord'
    )

    expect(result.status).toBe('fully-signed-pending-deposit')
    expect(result.signedByTenant).toBe(true)
    expect(result.signedByLandlord).toBe(true)
    expect(contractRepository.save).toHaveBeenCalledWith(contract)
  })

  type SmartCaActivationContext = {
    service: ContractsService
    contract: Contract
    contractRepository: { findOne: jest.Mock; save: jest.Mock }
    depositAgreementRepository: { findOne: jest.Mock; save: jest.Mock }
    ledgerOutboxService: {
      enqueue: jest.MockedFunction<(event: unknown) => Promise<unknown>>
    }
    paymentsService: { generateSchedule: jest.Mock }
  }

  function createSmartCaActivationContext(options?: {
    depositStatus?: 'paid' | 'pending'
    policy?: 'DEPOSIT_FIRST' | 'SIGN_FIRST'
    landlordSignature?: Contract['landlordSignature']
  }): SmartCaActivationContext {
    const contract = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      contractCode: 'HD-SMARTCA-1',
      propertyId: 'property-1',
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      monthlyRent: 10_000_000,
      deposit: 20_000_000,
      depositAgreementId: '507f1f77bcf86cd799439099',
      startDate: new Date('2030-01-01T00:00:00.000Z'),
      status: 'awaiting-signature' as const,
      signedByTenant: false,
      signedByLandlord: Boolean(options?.landlordSignature),
      tenantSignature: null,
      landlordSignature: options?.landlordSignature ?? null,
      contentLockedHash: 'a'.repeat(64),
      contentLockedAt: new Date('2029-12-01T00:00:00.000Z'),
      artifactRef: {
        artifactId: 'artifact-1',
        revision: 1,
        templateKey: 'lease-vn',
        templateVersion: 1,
        hashSchemaVersion: 1,
        artifactHash: 'a'.repeat(64),
        contentType: 'application/pdf' as const,
        lockedAt: new Date('2029-12-01T00:00:00.000Z'),
      },
      executionPolicySnapshot: {
        policyId: 'policy-1',
        version: 1,
        strategy: options?.policy ?? 'DEPOSIT_FIRST',
        contentHash: 'policy-hash',
      },
    } as unknown as Contract
    const contractRepository = {
      findOne: jest.fn().mockResolvedValue(contract),
      save: jest.fn(
        (value: Contract): Promise<Contract> => Promise.resolve(value)
      ),
    }
    const depositAgreementRepository = {
      findOne: jest.fn().mockResolvedValue({
        _id: new ObjectId('507f1f77bcf86cd799439099'),
        status: options?.depositStatus ?? 'paid',
        depositHash: 'd'.repeat(64),
        paidAt:
          options?.depositStatus === 'pending'
            ? null
            : new Date('2030-01-01T00:00:00.000Z'),
      }),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    }
    const ledgerOutboxService = { enqueue: jest.fn().mockResolvedValue({}) }
    const paymentsService = {
      generateSchedule: jest.fn().mockResolvedValue([]),
    }
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
    Reflect.set(service, 'paymentsService', paymentsService)
    Reflect.set(service, 'apartmentRepository', { findOne: jest.fn() })
    return {
      service,
      contract,
      contractRepository,
      depositAgreementRepository,
      ledgerOutboxService,
      paymentsService,
    }
  }

  function smartCaEvidence(
    role: 'tenant' | 'landlord',
    tx: string
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
      artifactHash: 'a'.repeat(64),
      providerTransactionId: tx,
      certificateSerial: `cert-${role}`,
      certificateSubject: `CN=${role}`,
      certificateIssuer: 'CN=VNPT',
      signatureHash: `sig-${role}`,
      signedAt: new Date('2030-01-01T00:00:00.000Z'),
    } as const
  }

  it.each(['DEPOSIT_FIRST', 'SIGN_FIRST'] as const)(
    'activates only after both valid SmartCA signatures (%s)',
    async policy => {
      const context = createSmartCaActivationContext({
        policy,
        depositStatus: 'paid',
      })

      await context.service.recordSmartCaSignature(
        smartCaEvidence('tenant', 'tx-t')
      )
      expect(context.contract.status).toBe('awaiting-signature')
      expect(context.ledgerOutboxService.enqueue).not.toHaveBeenCalled()

      const result = await context.service.recordSmartCaSignature(
        smartCaEvidence('landlord', 'tx-l')
      )
      expect(result.status).toBe('active')
      expect(result.contractHash).toBe('a'.repeat(64))
      expect(result.tenantSignature?.provider).toBe('smartca')
      expect(result.landlordSignature?.provider).toBe('smartca')
      expect(context.ledgerOutboxService.enqueue).toHaveBeenCalledTimes(1)
      const ledgerEvent = context.ledgerOutboxService.enqueue.mock
        .calls[0]?.[0] as {
        args?: string[]
        metadata?: { details?: Record<string, unknown> }
      }
      const evidenceArgument = ledgerEvent.args?.[ledgerEvent.args.length - 1]
      expect(evidenceArgument).toBeDefined()
      const parsedEvidence = JSON.parse(evidenceArgument ?? '{}') as {
        schemaVersion?: number
        artifact?: {
          artifactId?: string
          revision?: number
          artifactHash?: string
        }
      }
      expect(parsedEvidence.schemaVersion).toBe(2)
      expect(parsedEvidence.artifact).toEqual({
        artifactId: 'artifact-1',
        revision: 1,
        artifactHash: 'a'.repeat(64),
        contentType: 'application/pdf',
      })
      expect(ledgerEvent.metadata?.details).toEqual(
        expect.objectContaining({
          artifactId: 'artifact-1',
          artifactRevision: 1,
          artifactHash: 'a'.repeat(64),
        })
      )
      expect(context.paymentsService.generateSchedule).toHaveBeenCalledTimes(1)
    }
  )

  it('keeps sign-first contracts pending when signatures arrive before deposit', async () => {
    const context = createSmartCaActivationContext({
      policy: 'SIGN_FIRST',
      depositStatus: 'pending',
    })

    await context.service.recordSmartCaSignature(
      smartCaEvidence('tenant', 'tx-t')
    )
    const pending = await context.service.recordSmartCaSignature(
      smartCaEvidence('landlord', 'tx-l')
    )
    expect(pending.status).toBe('fully-signed-pending-deposit')
    expect(context.ledgerOutboxService.enqueue).not.toHaveBeenCalled()

    const deposit = (await context.depositAgreementRepository.findOne()) as {
      status: 'paid' | 'pending'
      paidAt: Date | null
    }
    deposit.status = 'paid'
    deposit.paidAt = new Date('2030-01-02T00:00:00.000Z')
    const activated = await context.service.recordSmartCaSignature(
      smartCaEvidence('landlord', 'tx-l')
    )
    expect(activated.status).toBe('active')
    expect(context.ledgerOutboxService.enqueue).toHaveBeenCalledTimes(1)
  })

  it('does not treat POC consent, a failed signature, or a simulation as SmartCA evidence', async () => {
    const context = createSmartCaActivationContext({
      landlordSignature: {
        signerId: 'landlord-1',
        role: 'landlord',
        signedAt: new Date('2030-01-01T00:00:00.000Z'),
        contentHash: 'a'.repeat(64),
        provider: 'platform-consent',
        biometricGrantId: 'bio-1',
        otpSessionId: 'otp-1',
      },
    })

    const result = await context.service.recordSmartCaSignature(
      smartCaEvidence('tenant', 'tx-t')
    )
    expect(result.status).toBe('awaiting-signature')
    expect(context.ledgerOutboxService.enqueue).not.toHaveBeenCalled()
  })

  it('rejects a signature for another artifact and does not enqueue early ledger work', async () => {
    const context = createSmartCaActivationContext()
    await expect(
      context.service.recordSmartCaSignature({
        ...smartCaEvidence('tenant', 'tx-t'),
        artifactHash: 'b'.repeat(64),
      })
    ).rejects.toThrow('SMARTCA_SIGNATURE_DIGEST_MISMATCH')
    expect(context.ledgerOutboxService.enqueue).not.toHaveBeenCalled()
  })

  it('handles a duplicate signed callback idempotently', async () => {
    const context = createSmartCaActivationContext()
    await context.service.recordSmartCaSignature(
      smartCaEvidence('tenant', 'tx-t')
    )
    await context.service.recordSmartCaSignature(
      smartCaEvidence('landlord', 'tx-l')
    )
    const savesAfterActivation =
      context.contractRepository.save.mock.calls.length

    await context.service.recordSmartCaSignature(
      smartCaEvidence('landlord', 'tx-l')
    )
    expect(context.ledgerOutboxService.enqueue).toHaveBeenCalledTimes(1)
    expect(context.contractRepository.save).toHaveBeenCalledTimes(
      savesAfterActivation
    )
  })
})

describe('ContractsService verifyIntegrity 4-state', () => {
  it('returns invalid with isValid=false when mongo hash does not match computed hash', async () => {
    const contract = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      contractHash: 'different-from-computed',
      blockchainAddress: 'tx-123',
      ledgerStatus: 'confirmed',
      appliedPolicies: {},
    } as unknown as Contract
    const service = Object.create(
      ContractsService.prototype
    ) as ContractsService
    jest.spyOn(service, 'findOne').mockResolvedValue(contract)
    Reflect.set(service, 'buildContractHash', () => 'computed-hash-123')

    const result = await service.verifyIntegrity(contract._id.toHexString())
    expect(result.verificationStatus).toBe('invalid')
    expect(result.isValid).toBe(false)
  })

  it('returns not-recorded with isValid=null when contract has no blockchain confirmation', async () => {
    const contract = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      contractHash: 'matching-hash',
      blockchainAddress: null,
      ledgerStatus: 'pending',
      appliedPolicies: {},
    } as unknown as Contract
    const service = Object.create(
      ContractsService.prototype
    ) as ContractsService
    jest.spyOn(service, 'findOne').mockResolvedValue(contract)
    Reflect.set(service, 'buildContractHash', () => 'matching-hash')

    const result = await service.verifyIntegrity(contract._id.toHexString())
    expect(result.verificationStatus).toBe('not-recorded')
    expect(result.isValid).toBeNull()
  })

  it('returns valid with isValid=true when on-chain verifyContract passes', async () => {
    const contract = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      contractHash: 'matching-hash',
      blockchainAddress: 'tx-on-chain-123',
      ledgerStatus: 'confirmed',
      appliedPolicies: {},
    } as unknown as Contract
    const fabricService = {
      evaluateTransaction: jest.fn().mockResolvedValue({
        valid: true,
        reason: 'MATCH',
        txId: 'tx-on-chain-123',
      }),
    }
    const service = Object.create(
      ContractsService.prototype
    ) as ContractsService
    jest.spyOn(service, 'findOne').mockResolvedValue(contract)
    Reflect.set(service, 'buildContractHash', () => 'matching-hash')
    Reflect.set(service, 'fabricService', fabricService)

    const result = await service.verifyIntegrity(contract._id.toHexString())
    expect(result.verificationStatus).toBe('valid')
    expect(result.isValid).toBe(true)
    expect(fabricService.evaluateTransaction).toHaveBeenCalledWith(
      'verifyContract',
      [contract._id.toHexString(), 'matching-hash']
    )
  })

  it('returns unavailable with isValid=null when Fabric query throws network error', async () => {
    const contract = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      contractHash: 'matching-hash',
      blockchainAddress: 'tx-on-chain-123',
      ledgerStatus: 'confirmed',
      appliedPolicies: {},
    } as unknown as Contract
    const fabricService = {
      evaluateTransaction: jest
        .fn()
        .mockRejectedValue(new Error('peer unreachable')),
    }
    const service = Object.create(
      ContractsService.prototype
    ) as ContractsService
    jest.spyOn(service, 'findOne').mockResolvedValue(contract)
    Reflect.set(service, 'buildContractHash', () => 'matching-hash')
    Reflect.set(service, 'fabricService', fabricService)
    Reflect.set(service, 'logger', { warn: jest.fn() })

    const result = await service.verifyIntegrity(contract._id.toHexString())
    expect(result.verificationStatus).toBe('unavailable')
    expect(result.isValid).toBeNull()
  })
})

describe('ContractsService contract ownership', () => {
  it('allows participants and staff to read a contract but rejects outsiders', async () => {
    const contract = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
    } as unknown as Contract
    const service = Object.create(
      ContractsService.prototype
    ) as ContractsService
    jest.spyOn(service, 'findOne').mockResolvedValue(contract)

    await expect(
      service.findOneForUser(contract._id.toHexString(), 'tenant-1', false)
    ).resolves.toBe(contract)
    await expect(
      service.findOneForUser(contract._id.toHexString(), 'staff-1', true)
    ).resolves.toBe(contract)
    await expect(
      service.findOneForUser(contract._id.toHexString(), 'outsider', false)
    ).rejects.toThrow('CONTRACT_ACCESS_DENIED')
  })

  it('rejects malformed contract IDs before repository access', async () => {
    const repository = { findOne: jest.fn() }
    const service = Object.create(
      ContractsService.prototype
    ) as ContractsService
    Reflect.set(service, 'contractRepository', repository)

    await expect(service.findOne('not-an-object-id')).rejects.toThrow(
      'CONTRACT_NOT_FOUND'
    )
    expect(repository.findOne).not.toHaveBeenCalled()
  })
})
