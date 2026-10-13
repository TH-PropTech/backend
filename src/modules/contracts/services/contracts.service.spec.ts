import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common'

import type { EkycProxyService } from '../../ekyc/services/ekyc-proxy.service'
import type { KycMediaService } from '../../users/services/kyc-media.service'
import type { KycService } from '../../users/services/kyc.service'
import { ObjectId } from 'mongodb'
import { ContractsService } from './contracts.service'
import type { Contract } from '../schemas/contract.schema'
import { RentalTransactionEventService } from '../../rental/services/rental-transaction-event.service'
import type { RentalTransactionEvent } from '../../rental/schemas/rental-transaction-event.schema'

/** Minimal in-memory repository stand-in matching the finder/create/save shape
 * RentalTransactionEventService relies on, so tests exercise its real
 * dedup-by-transitionKey logic instead of a fully mocked `record()`. */
function createInMemoryTransactionEventService(): {
  service: RentalTransactionEventService
  events: RentalTransactionEvent[]
} {
  const events: RentalTransactionEvent[] = []
  const repository = {
    findOne: jest.fn(
      ({ where }: { where: { transitionKey: string } }) =>
        Promise.resolve(
          events.find(event => event.transitionKey === where.transitionKey) ??
            null
        ) as unknown
    ),
    create: jest.fn(
      (input: Partial<RentalTransactionEvent>) =>
        ({ ...input }) as RentalTransactionEvent
    ),
    save: jest.fn((event: RentalTransactionEvent) => {
      events.push(event)
      return Promise.resolve(event)
    }),
  }
  const service = new RentalTransactionEventService(repository as never)
  return { service, events }
}

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
      paymentCycleMonths: 3 as const,
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
    expect(created.paymentCycleMonths).toBe(3)
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

describe('ContractsService.signContractForTest', () => {
  const originalEnv = { ...process.env }
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('is refused unless ENABLE_TEST_SIGN_BYPASS=true', async () => {
    delete process.env['ENABLE_TEST_SIGN_BYPASS']
    process.env['NODE_ENV'] = 'development'
    const { service } = createService()

    await expect(
      service.signContractForTest('contract-id', 'user-id')
    ).rejects.toThrow('TEST_SIGN_BYPASS_DISABLED')
  })

  it('is refused in production even when the flag is set', async () => {
    process.env['ENABLE_TEST_SIGN_BYPASS'] = 'true'
    process.env['NODE_ENV'] = 'production'
    const { service } = createService()

    await expect(
      service.signContractForTest('contract-id', 'user-id')
    ).rejects.toThrow('TEST_SIGN_BYPASS_DISABLED')
  })

  it('records dev-test signature evidence with a timestamp so the UI is not blank', async () => {
    process.env['ENABLE_TEST_SIGN_BYPASS'] = 'true'
    process.env['NODE_ENV'] = 'development'
    const service = Object.create(
      ContractsService.prototype
    ) as ContractsService
    const contract = {
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      contentLockedHash: 'a'.repeat(64),
      artifactRef: { artifactHash: 'b'.repeat(64) },
      tenantSignature: null,
    } as unknown as Contract
    const save = jest.fn((value: Contract) => Promise.resolve(value))
    Reflect.set(service, 'contractRepository', { save })
    jest.spyOn(service, 'findOne').mockResolvedValue(contract)
    jest.spyOn(service, 'signContract').mockResolvedValue(contract)

    const saved = await service.signContractForTest('contract-id', 'tenant-1')

    expect(saved.tenantSignature).toMatchObject({
      signerId: 'tenant-1',
      role: 'tenant',
      provider: 'dev-test',
      providerStatus: 'signed',
      contentHash: 'a'.repeat(64),
      artifactHash: 'b'.repeat(64),
    })
    expect(saved.tenantSignature?.signedAt).toBeInstanceOf(Date)
  })

  it('rejects a non-participant when the bypass is enabled', async () => {
    process.env['ENABLE_TEST_SIGN_BYPASS'] = 'true'
    process.env['NODE_ENV'] = 'development'
    const { service } = createService()

    await expect(
      service.signContractForTest('contract-id', 'outsider')
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
    Reflect.set(service, 'kycService', {
      findByUserId: jest.fn().mockResolvedValue(null),
    })
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

  it('snapshots a matching published layout and upgrades only that lock to v3', async () => {
    const { service, contract } = createContentService()
    contract.editorContent = validContent
    contract.contentRevision = 1
    contract.contractTemplateRef = {
      key: 'lease-vn',
      version: 1,
      contentHash: 'a'.repeat(64),
    }
    Reflect.set(service, 'templateGovernanceService', {
      getPublishedVersion: jest.fn().mockResolvedValue({
        legalProfile: 'PRIVATE_CIVIL_APARTMENT_LEASE',
      }),
    })
    Reflect.set(service, 'layoutService', {
      findPublishedForContract: jest.fn().mockResolvedValue({
        profileKey: 'standard',
        version: 2,
        contentHash: 'b'.repeat(64),
      }),
    })

    const locked = await service.lockContractContent(
      contract._id.toString(),
      'staff-1',
      1,
      true
    )

    expect(locked.hashSchemaVersion).toBe(3)
    expect(locked.layoutProfileRef).toEqual({
      profileKey: 'standard',
      version: 2,
      contentHash: 'b'.repeat(64),
      supplementaryClauses: [],
    })
  })

  it('asks the flow notifier to check stages once content is newly locked', async () => {
    const { service, contract } = createContentService()
    const notifier = { notifyForContract: jest.fn() }
    Reflect.set(service, 'flowNotificationService', notifier)
    contract.editorContent = validContent
    contract.contentRevision = 1

    await service.lockContractContent(
      contract._id.toString(),
      'staff-1',
      1,
      true
    )
    await service.lockContractContent(
      contract._id.toString(),
      'staff-1',
      1,
      true
    )

    expect(notifier.notifyForContract).toHaveBeenCalledTimes(1)
    expect(notifier.notifyForContract).toHaveBeenCalledWith(
      contract._id.toString()
    )
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

  it('snapshots both parties from their verified KYC records when locking, without overwriting existing values', async () => {
    const { service, contract } = createContentService()
    contract.editorContent = validContent
    contract.contentRevision = 1
    contract.landlordId = 'landlord-1'
    contract.tenantId = 'tenant-1'
    contract.landlordName = null
    contract.tenantName = 'Tên do nhân viên nhập'
    Reflect.set(service, 'kycService', {
      findByUserId: jest.fn((userId: string) =>
        Promise.resolve(
          userId === 'landlord-1'
            ? {
                status: 'verified',
                fullName: 'Nguyễn Văn Chủ',
                idCardNumber: '001204000001',
                placeOfResidence: 'Phường Vườn Lài, TP.HCM',
                dateOfBirth: '12/04/2000',
                issueDate: '10/05/2021',
                placeOfIssue: 'Cục Cảnh sát QLHC về TTXH',
              }
            : {
                status: 'verified',
                fullName: 'Trần Thị Khách',
                idCardNumber: '001204000002',
                placeOfResidence: 'Phường Gò Vấp, TP.HCM',
              }
        )
      ),
    })

    const locked = await service.lockContractContent(
      contract._id.toString(),
      'landlord-1',
      1,
      false
    )

    expect(locked.landlordName).toBe('Nguyễn Văn Chủ')
    expect(locked.landlordCccd).toBe('001204000001')
    expect(locked.landlordAddress).toBe('Phường Vườn Lài, TP.HCM')
    expect(locked.landlordBirthDate).toBe('12/04/2000')
    expect(locked.landlordIdIssued).toBe(
      'cấp ngày 10/05/2021 tại Cục Cảnh sát QLHC về TTXH'
    )
    expect(locked.tenantIdIssued).toBeNull()
    expect(locked.tenantName).toBe('Tên do nhân viên nhập')
    expect(locked.tenantCccd).toBe('001204000002')
  })

  it('snapshots party phones and the ownership certificate when locking', async () => {
    const { service, contract } = createContentService()
    contract.editorContent = validContent
    contract.contentRevision = 1
    contract.landlordId = '507f1f77bcf86cd799439021'
    contract.tenantId = '507f1f77bcf86cd799439022'
    contract.propertyId = '507f1f77bcf86cd799439023'
    Reflect.set(service, 'userRepository', {
      findOne: jest.fn(
        ({ where }: { where: { _id: { toHexString: () => string } } }) =>
          Promise.resolve({
            phone:
              where._id.toHexString() === '507f1f77bcf86cd799439021'
                ? '0384589387'
                : '0912345678',
          })
      ),
    })
    Reflect.set(service, 'apartmentRepository', {
      findOne: jest
        .fn()
        .mockResolvedValue({ ownershipCertificate: ' CS 12345 ' }),
    })

    const locked = await service.lockContractContent(
      contract._id.toString(),
      '507f1f77bcf86cd799439021',
      1,
      false
    )

    expect(locked.landlordPhone).toBe('0384589387')
    expect(locked.tenantPhone).toBe('0912345678')
    expect(locked.propertyOwnershipCertificate).toBe('CS 12345')
  })

  it('ignores parties whose KYC is not verified when locking', async () => {
    const { service, contract } = createContentService()
    contract.editorContent = validContent
    contract.contentRevision = 1
    contract.landlordId = 'landlord-1'
    contract.landlordName = null
    Reflect.set(service, 'kycService', {
      findByUserId: jest
        .fn()
        .mockResolvedValue({ status: 'pending', fullName: 'Chưa duyệt' }),
    })

    const locked = await service.lockContractContent(
      contract._id.toString(),
      'landlord-1',
      1,
      false
    )

    expect(locked.landlordName).toBeNull()
  })

  it('falls back to the account full name for parties without verified KYC, but never takes CCCD from it', async () => {
    const { service, contract } = createContentService()
    contract.editorContent = validContent
    contract.contentRevision = 1
    contract.landlordId = '507f1f77bcf86cd799439031'
    contract.tenantId = '507f1f77bcf86cd799439032'
    contract.landlordName = null
    contract.tenantName = null
    contract.landlordCccd = null
    Reflect.set(service, 'kycService', {
      findByUserId: jest.fn().mockResolvedValue(null),
    })
    Reflect.set(service, 'userRepository', {
      findOne: jest.fn(
        ({ where }: { where: { _id: { toHexString: () => string } } }) =>
          Promise.resolve({
            fullName:
              where._id.toHexString() === '507f1f77bcf86cd799439031'
                ? ' Nguyễn Văn Chủ '
                : 'Trần Thị Khách',
          })
      ),
    })

    const locked = await service.lockContractContent(
      contract._id.toString(),
      '507f1f77bcf86cd799439031',
      1,
      false
    )

    expect(locked.landlordName).toBe('Nguyễn Văn Chủ')
    expect(locked.tenantName).toBe('Trần Thị Khách')
    expect(locked.landlordCccd).toBeNull()
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
      generatePlatformFeeInvoices: jest.fn().mockResolvedValue([]),
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
    Reflect.set(service, 'fabricService', {
      getChaincodeAbiVersion: jest.fn(() => 1),
    })

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
        args: [
          contract._id.toHexString(),
          'HD-1',
          'tenant-1',
          'landlord-1',
          expect.any(String),
          '10000000',
          '2030-01-01T00:00:00.000Z',
          '507f1f77bcf86cd799439099',
          'd'.repeat(64),
        ],
      })
    )
    const enqueueMock = ledgerOutboxService.enqueue
    const enqueueCalls = enqueueMock.mock.calls as unknown as ReadonlyArray<
      readonly unknown[]
    >
    const activationEvent = enqueueCalls[0]?.[0] as
      | { metadata?: { argsVersion?: number } }
      | undefined
    expect(activationEvent?.metadata?.argsVersion).toBe(1)
    expect(paymentsService.generateSchedule).toHaveBeenCalledWith(contract)
  })

  it('leaves the legacy (non-SmartCA) signContract activation unbound: it has no canonical artifact to carry a v3 governance block (PROP-399 D2)', async () => {
    const contract = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      contractCode: 'HD-LEGACY',
      propertyId: 'property-1',
      landlordId: 'landlord-1',
      tenantId: 'tenant-1',
      monthlyRent: 10_000_000,
      deposit: 0,
      startDate: new Date('2030-01-01T00:00:00.000Z'),
      status: 'awaiting-signature' as const,
      signedByTenant: true,
      signedByLandlord: false,
      executionPolicySnapshot: {
        policyId: 'policy-1',
        version: 1,
        strategy: 'DEPOSIT_FIRST',
        contentHash: 'policy-hash',
      },
    } as unknown as Contract
    const contractRepository = {
      findOne: jest.fn().mockResolvedValue(contract),
      save: jest.fn(
        (value: Contract): Promise<Contract> => Promise.resolve(value)
      ),
      update: jest.fn(),
    }
    const ledgerOutboxService = { enqueue: jest.fn().mockResolvedValue({}) }
    const governanceService = {
      findLatestEligibleForExecutionPolicy: jest.fn().mockResolvedValue({
        _id: new ObjectId(),
        version: 1,
        manifestHash: 'c'.repeat(64),
      }),
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
    Reflect.set(service, 'governanceService', governanceService)
    Reflect.set(service, 'logger', { log: jest.fn() })
    Reflect.set(service, 'fabricService', {
      getChaincodeAbiVersion: jest.fn(() => 2),
    })

    await service.signContract(contract._id.toHexString(), 'landlord')

    expect(
      governanceService.findLatestEligibleForExecutionPolicy
    ).not.toHaveBeenCalled()
    expect(contractRepository.update).not.toHaveBeenCalled()
    expect(contract.governanceSnapshotRef ?? null).toBeNull()
    const enqueueCalls = ledgerOutboxService.enqueue.mock
      .calls as unknown as ReadonlyArray<readonly unknown[]>
    const event = enqueueCalls[0]?.[0] as { dependencyKeys?: string[] }
    expect(event.dependencyKeys).toBeUndefined()
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
    paymentsService: {
      generateSchedule: jest.Mock
      generatePlatformFeeInvoices: jest.Mock
    }
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
      generatePlatformFeeInvoices: jest.fn().mockResolvedValue([]),
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
    Reflect.set(service, 'fabricService', {
      getChaincodeAbiVersion: jest.fn(() => 2),
    })
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

  it('asks the flow notifier to check stages after each recorded SmartCA signature', async () => {
    const context = createSmartCaActivationContext({ depositStatus: 'paid' })
    const notifier = { notifyForContract: jest.fn() }
    Reflect.set(context.service, 'flowNotificationService', notifier)

    await context.service.recordSmartCaSignature(
      smartCaEvidence('tenant', 'tx-t')
    )
    await context.service.recordSmartCaSignature(
      smartCaEvidence('landlord', 'tx-l')
    )

    expect(notifier.notifyForContract).toHaveBeenCalledTimes(2)
    expect(notifier.notifyForContract).toHaveBeenCalledWith(
      context.contract._id.toString()
    )
  })

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
        metadata?: { argsVersion?: number; details?: Record<string, unknown> }
      }
      expect(ledgerEvent.args).toHaveLength(10)
      expect(ledgerEvent.args?.slice(7, 9)).toEqual([
        '507f1f77bcf86cd799439099',
        'd'.repeat(64),
      ])
      expect(ledgerEvent.metadata?.argsVersion).toBe(2)
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

  it('records exactly one contract.activated transaction event when the second signature is processed twice', async () => {
    const context = createSmartCaActivationContext()
    const { service: transactionEventService, events } =
      createInMemoryTransactionEventService()
    Reflect.set(
      context.service,
      'transactionEventService',
      transactionEventService
    )

    await context.service.recordSmartCaSignature(
      smartCaEvidence('tenant', 'tx-t')
    )
    await context.service.recordSmartCaSignature(
      smartCaEvidence('landlord', 'tx-l')
    )
    // Duplicate delivery of the same second (landlord) signature, e.g. a
    // retried webhook.
    await context.service.recordSmartCaSignature(
      smartCaEvidence('landlord', 'tx-l')
    )

    const activatedEvents = events.filter(
      event => event.eventType === 'contract.activated'
    )
    expect(activatedEvents).toHaveLength(1)
  })

  describe('governance snapshot binding (PROP-399 D2, SmartCA activation site)', () => {
    const SNAPSHOT_ID = '507f1f77bcf86cd799439abc'
    const MANIFEST_HASH = 'c'.repeat(64)
    const eligibleSnapshot = {
      _id: new ObjectId(SNAPSHOT_ID),
      version: 3,
      manifestHash: MANIFEST_HASH,
    }

    type EnqueueEvent = {
      args: string[]
      dependencyKey?: string | null
      dependencyKeys?: string[]
      metadata?: Record<string, unknown> & {
        details?: Record<string, unknown>
      }
    }

    function withGovernance(
      options: Parameters<typeof createSmartCaActivationContext>[0] = {},
      snapshot: unknown = eligibleSnapshot
    ): ReturnType<typeof createSmartCaActivationContext> & {
      governanceService: { findLatestEligibleForExecutionPolicy: jest.Mock }
      update: jest.Mock
    } {
      const context = createSmartCaActivationContext({
        depositStatus: 'paid',
        ...options,
      })
      const governanceService = {
        findLatestEligibleForExecutionPolicy: jest
          .fn()
          .mockResolvedValue(snapshot),
      }
      const update = jest.fn().mockResolvedValue({ affected: 1 })
      Reflect.set(context.service, 'governanceService', governanceService)
      Reflect.set(context.contractRepository, 'update', update)
      return { ...context, governanceService, update }
    }

    async function activate(
      context: ReturnType<typeof createSmartCaActivationContext>
    ): Promise<EnqueueEvent> {
      await context.service.recordSmartCaSignature(
        smartCaEvidence('tenant', 'tx-t')
      )
      await context.service.recordSmartCaSignature(
        smartCaEvidence('landlord', 'tx-l')
      )
      expect(context.ledgerOutboxService.enqueue).toHaveBeenCalledTimes(1)
      return context.ledgerOutboxService.enqueue.mock
        .calls[0]?.[0] as EnqueueEvent
    }

    it('selects the snapshot by the contract own executionPolicySnapshot (policyId + version)', async () => {
      const context = withGovernance()
      await activate(context)
      expect(
        context.governanceService.findLatestEligibleForExecutionPolicy
      ).toHaveBeenCalledWith({ policyId: 'policy-1', version: 1 })
    })

    it('persists the immutable governanceSnapshotRef BEFORE enqueueing activation evidence', async () => {
      const context = withGovernance()
      await activate(context)

      const expectedRef = {
        snapshotId: SNAPSHOT_ID,
        version: 3,
        manifestHash: MANIFEST_HASH,
      }
      expect(context.contract.governanceSnapshotRef).toEqual(expectedRef)
      expect(context.update).toHaveBeenCalledWith(
        { _id: context.contract._id },
        { governanceSnapshotRef: expectedRef }
      )
      expect(context.update.mock.invocationCallOrder[0]).toBeLessThan(
        context.ledgerOutboxService.enqueue.mock.invocationCallOrder[0] ??
          Number.POSITIVE_INFINITY
      )
    })

    it('enqueues activation with both parents: deposit.paid and governance.published', async () => {
      const context = withGovernance()
      const event = await activate(context)

      expect(event.dependencyKeys).toEqual([
        'deposit:507f1f77bcf86cd799439099:deposit.paid',
        `governance-snapshot:${SNAPSHOT_ID}:governance.published`,
      ])
      expect(event.dependencyKey ?? null).toBeNull()
    })

    it('enqueues only the governance parent when the contract has no deposit', async () => {
      const context = withGovernance()
      context.contract.deposit = 0
      const event = await activate(context)

      expect(event.dependencyKeys).toEqual([
        `governance-snapshot:${SNAPSHOT_ID}:governance.published`,
      ])
    })

    it('builds v3 evidence carrying the governance block and the v2 positional args', async () => {
      const context = withGovernance()
      const event = await activate(context)

      expect(event.args).toHaveLength(10)
      const evidence = JSON.parse(
        event.args[event.args.length - 1] ?? '{}'
      ) as {
        schemaVersion: number
        governance: {
          snapshotId: string
          version: number
          manifestHash: string
        }
      }
      expect(evidence.schemaVersion).toBe(3)
      expect(evidence.governance).toEqual({
        snapshotId: SNAPSHOT_ID,
        version: 3,
        manifestHash: MANIFEST_HASH,
      })
      expect(event.metadata?.details).toEqual(
        expect.objectContaining({ evidenceSchemaVersion: 3 })
      )
    })

    it('makes the item wait for a chaincode that supports ABI v2 and evidence v3 (CHAINCODE_UPGRADE_REQUIRED)', async () => {
      const context = withGovernance()
      const event = await activate(context)

      expect(event.metadata).toEqual(
        expect.objectContaining({
          minimumAbiVersion: 2,
          minimumEvidenceSchemaVersion: 3,
          waitingCode: 'CHAINCODE_UPGRADE_REQUIRED',
        })
      )
    })

    it('never drops the governance reference on an ABI v1 chaincode: args stay v2-shaped and the item waits', async () => {
      const context = withGovernance()
      Reflect.set(context.service, 'fabricService', {
        getChaincodeAbiVersion: jest.fn(() => 1),
      })
      const event = await activate(context)

      expect(event.args).toHaveLength(10)
      expect(event.metadata?.argsVersion).toBe(2)
      expect(event.metadata?.minimumAbiVersion).toBe(2)
    })

    it('keeps an already-bound reference immutable and does not reselect', async () => {
      const context = withGovernance()
      const existing = {
        snapshotId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        version: 1,
        manifestHash: 'e'.repeat(64),
      }
      context.contract.governanceSnapshotRef = existing
      const event = await activate(context)

      expect(
        context.governanceService.findLatestEligibleForExecutionPolicy
      ).not.toHaveBeenCalled()
      expect(context.update).not.toHaveBeenCalled()
      expect(context.contract.governanceSnapshotRef).toBe(existing)
      expect(event.dependencyKeys).toContain(
        'governance-snapshot:aaaaaaaaaaaaaaaaaaaaaaaa:governance.published'
      )
    })

    it('is byte-identical to the legacy path when no eligible snapshot exists (v2, single dependencyKey, no ref)', async () => {
      const context = withGovernance({}, null)
      const event = await activate(context)

      expect(context.contract.governanceSnapshotRef ?? null).toBeNull()
      expect(context.update).not.toHaveBeenCalled()
      expect(event.dependencyKey).toBe(
        'deposit:507f1f77bcf86cd799439099:deposit.paid'
      )
      expect(event.dependencyKeys).toBeUndefined()
      expect(event.metadata).not.toHaveProperty('minimumEvidenceSchemaVersion')
      expect(event.metadata).not.toHaveProperty('waitingCode')
      expect(event.metadata).not.toHaveProperty('minimumAbiVersion')
      const evidence = JSON.parse(
        event.args[event.args.length - 1] ?? '{}'
      ) as {
        schemaVersion: number
        governance?: unknown
      }
      expect(evidence.schemaVersion).toBe(2)
      expect(evidence.governance).toBeUndefined()
    })

    it('does not bind a contract that has no executionPolicySnapshot', async () => {
      const context = withGovernance()
      context.contract.executionPolicySnapshot = null
      const event = await activate(context)

      expect(
        context.governanceService.findLatestEligibleForExecutionPolicy
      ).not.toHaveBeenCalled()
      expect(event.dependencyKeys).toBeUndefined()
    })

    it('behaves exactly as before when the governance service is not wired', async () => {
      const context = createSmartCaActivationContext({ depositStatus: 'paid' })
      const event = await activate(context)
      expect(event.dependencyKeys).toBeUndefined()
      expect(context.contract.governanceSnapshotRef ?? null).toBeNull()
    })
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
    expect(result.layers.offChain.status).toBe('valid')
    expect(result.layers.artifact.status).toBe('not-recorded')
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

  it('returns valid only when the locked SmartCA artifact bytes still match GridFS metadata', async () => {
    const artifactHash = 'a'.repeat(64)
    const contract = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      contractHash: 'matching-hash',
      contentLockedHash: 'semantic-hash',
      blockchainAddress: 'tx-on-chain-123',
      ledgerStatus: 'confirmed',
      appliedPolicies: {},
      artifactRef: {
        artifactId: 'artifact-1',
        revision: 1,
        templateKey: 'lease-vn',
        templateVersion: 1,
        hashSchemaVersion: 2,
        artifactHash,
        canonicalContentHash: 'semantic-hash',
        rendererVersion: 'pdf-v1',
        sourceSchemaVersion: 2,
        byteLength: 10,
        amendmentId: null,
        contentType: 'application/pdf' as const,
        lockedAt: new Date(),
      },
    } as unknown as Contract
    const service = Object.create(
      ContractsService.prototype
    ) as ContractsService
    jest.spyOn(service, 'findOne').mockResolvedValue(contract)
    Reflect.set(service, 'buildContractHash', () => 'matching-hash')
    Reflect.set(service, 'fabricService', {
      evaluateTransaction: jest.fn().mockResolvedValue({ valid: true }),
    })
    Reflect.set(service, 'artifactService', {
      resolveCanonicalArtifact: jest.fn().mockResolvedValue({
        reference: contract.artifactRef,
        artifact: { artifactHash },
        bytes: Buffer.from('%PDF-1.7'),
      }),
    })

    const result = await service.verifyIntegrity(contract._id.toHexString())

    expect(result.isValid).toBe(true)
    expect(result.layers.offChain.status).toBe('valid')
    expect(result.layers.artifact.status).toBe('valid')
    expect(result.layers.artifact.hash).toBe(artifactHash)
    expect(result.layers.onChain.status).toBe('valid')
  })

  it('marks artifact mismatch invalid even when the on-chain hash still matches', async () => {
    const contract = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      contractHash: 'matching-hash',
      contentLockedHash: 'semantic-hash',
      blockchainAddress: 'tx-on-chain-123',
      ledgerStatus: 'confirmed',
      appliedPolicies: {},
      artifactRef: {
        artifactId: 'artifact-1',
        revision: 1,
        artifactHash: 'a'.repeat(64),
        canonicalContentHash: 'semantic-hash',
        contentType: 'application/pdf' as const,
        lockedAt: new Date(),
      },
    } as unknown as Contract
    const service = Object.create(
      ContractsService.prototype
    ) as ContractsService
    jest.spyOn(service, 'findOne').mockResolvedValue(contract)
    Reflect.set(service, 'buildContractHash', () => 'matching-hash')
    Reflect.set(service, 'fabricService', {
      evaluateTransaction: jest.fn().mockResolvedValue({ valid: true }),
    })
    Reflect.set(service, 'artifactService', {
      resolveCanonicalArtifact: jest
        .fn()
        .mockRejectedValue(new Error('CONTRACT_ARTIFACT_HASH_MISMATCH')),
    })

    const result = await service.verifyIntegrity(contract._id.toHexString())

    expect(result.verificationStatus).toBe('invalid')
    expect(result.isValid).toBe(false)
    expect(result.layers.artifact.status).toBe('mismatch')
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
