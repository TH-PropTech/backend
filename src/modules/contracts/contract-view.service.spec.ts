import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { ForbiddenException } from '@nestjs/common'
import { ContractViewService } from './contract-view.service'
import { Contract } from './schemas/contract.schema'
import { DepositAgreement } from './schemas/deposit-agreement.schema'
import { KycService } from '../kyc/kyc.service'
import type { KycRecord } from '../kyc/schemas/kyc-record.schema'
import { LedgerAuditQueryService } from '../fabric/ledger-audit-query.service'
import { OwnershipTransferResolver } from '../property-ownership-transfer/ownership-transfer.resolver'
import { ContractArtifactService } from './contract-artifact.service'

describe('ContractViewService', () => {
  let service: ContractViewService
  let contractRepo: jest.Mocked<Repository<Contract>>
  let depositAgreementRepo: jest.Mocked<Repository<DepositAgreement>>
  let kycService: jest.Mocked<KycService>
  let artifactService: { resolveCanonicalArtifact: jest.Mock }
  let ownershipTransferResolver: {
    resolveContractAccess: jest.Mock
  }

  const validContractId = new ObjectId().toString()

  const mockContract: Partial<Contract> = {
    _id: new ObjectId(validContractId),
    contractCode: 'CT-2026-VIEW',
    propertyId: 'prop-1',
    propertyTitle: 'Căn hộ Masteri Thảo Điền',
    tenantId: 'user-tenant-1',
    tenantName: 'Nguyễn Văn Thuê',
    tenantCccd: '079123456789',
    landlordId: 'user-landlord-1',
    landlordName: 'Trần Thị Chủ',
    landlordCccd: '079987654321',
    monthlyRent: 15000000,
    deposit: 30000000,
    paymentDay: 5,
    status: 'awaiting-signature',
    contentLockedHash: 'mock-locked-sha256-hash',
    contentLockedAt: new Date('2026-09-14T08:00:00Z'),
    contentRevision: 1,
    depositPaidAt: new Date('2026-09-14T07:30:00Z'),
    signedByTenant: false,
    signedByLandlord: false,
    configStatus: null,
  }

  beforeEach(async () => {
    const mockContractRepo = {
      findOne: jest.fn(),
    }
    const mockDepositRepo = {
      findOne: jest.fn(),
    }
    const mockKycService = {
      findByUserId: jest.fn(),
    }
    const mockLedgerQueryService = {
      getContractEvents: jest.fn().mockResolvedValue([]),
    }
    const mockOwnershipTransferResolver = {
      resolveContractAccess: jest.fn(),
    }
    const mockArtifactService = {
      resolveCanonicalArtifact: jest.fn().mockResolvedValue({}),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractViewService,
        {
          provide: getRepositoryToken(Contract),
          useValue: mockContractRepo,
        },
        {
          provide: getRepositoryToken(DepositAgreement),
          useValue: mockDepositRepo,
        },
        {
          provide: KycService,
          useValue: mockKycService,
        },
        {
          provide: LedgerAuditQueryService,
          useValue: mockLedgerQueryService,
        },
        {
          provide: OwnershipTransferResolver,
          useValue: mockOwnershipTransferResolver,
        },
        {
          provide: ContractArtifactService,
          useValue: mockArtifactService,
        },
      ],
    }).compile()

    service = module.get<ContractViewService>(ContractViewService)
    contractRepo = module.get(getRepositoryToken(Contract))
    depositAgreementRepo = module.get(getRepositoryToken(DepositAgreement))
    kycService = module.get(KycService)
    artifactService = module.get(ContractArtifactService)
    ownershipTransferResolver = module.get(OwnershipTransferResolver)
    ownershipTransferResolver.resolveContractAccess.mockImplementation(
      (
        actorId: string,
        contract: Pick<Contract, 'landlordId' | 'tenantId'>,
        isStaff: boolean
      ) => {
        const isOriginalParticipant =
          actorId === contract.landlordId || actorId === contract.tenantId
        return {
          canReadWorkspace: isStaff || isOriginalParticipant,
          canSign: !isStaff && isOriginalParticipant,
          isOriginalParticipant,
          isSuccessorOwner: false,
        }
      }
    )
  })

  it('should return enriched ContractViewDto for authorized tenant and calculate eligible=true', async () => {
    contractRepo.findOne.mockResolvedValue(mockContract as Contract)
    kycService.findByUserId.mockImplementation((userId: string) => {
      if (userId === 'user-tenant-1') {
        return Promise.resolve({
          status: 'verified',
          idCardNumber: '079123456789',
        } as KycRecord)
      }
      return Promise.resolve({
        status: 'verified',
        idCardNumber: '079987654321',
      } as KycRecord)
    })

    const view = await service.getForActor(
      validContractId,
      'user-tenant-1',
      false
    )

    expect(view.contract.code).toBe('CT-2026-VIEW')
    expect(view.parties.tenant.maskedCccd).toBe('079***789')
    expect(view.parties.landlord.maskedCccd).toBe('079***321')
    expect(view.document.sections).toHaveLength(12)
    expect(view.actions.signingEligibility.eligible).toBe(true)
    expect(view.actions.signingEligibility.reasonCode).toBeNull()
  })

  it('projects the current linked deposit agreement revision and hash for tenant consent', async () => {
    const agreementId = new ObjectId()
    contractRepo.findOne.mockResolvedValue({
      ...mockContract,
      depositAgreementId: agreementId.toHexString(),
      depositPaidAt: null,
    } as Contract)
    depositAgreementRepo.findOne.mockResolvedValue({
      _id: agreementId,
      agreementCode: 'DPA-2026-001',
      amount: 30000000,
      status: 'draft',
      tenantConsent: null,
      contentRevision: 3,
      contentHash: 'deposit-content-hash',
    } as DepositAgreement)
    kycService.findByUserId.mockResolvedValue({
      status: 'verified',
      idCardNumber: '079123456789',
    } as KycRecord)

    const view = await service.getForActor(
      validContractId,
      'user-tenant-1',
      false
    )

    expect(view.deposit).toEqual(
      expect.objectContaining({
        consentGiven: false,
        contentRevision: 3,
        contentHash: 'deposit-content-hash',
      })
    )
  })

  it('keeps a contract without a linked agreement compatible with null consent metadata', async () => {
    contractRepo.findOne.mockResolvedValue({
      ...mockContract,
      depositAgreementId: null,
      depositPaidAt: null,
    } as Contract)
    kycService.findByUserId.mockResolvedValue({
      status: 'verified',
      idCardNumber: '079123456789',
    } as KycRecord)

    const view = await service.getForActor(
      validContractId,
      'user-tenant-1',
      false
    )

    expect(view.deposit).toEqual(
      expect.objectContaining({
        contentRevision: null,
        contentHash: null,
      })
    )
  })

  it('projects SmartCA certificate evidence into both party view records', async () => {
    contractRepo.findOne.mockResolvedValue({
      ...mockContract,
      signedByTenant: true,
      signedByLandlord: true,
      tenantSignature: {
        signerId: 'user-tenant-1',
        role: 'tenant',
        signedAt: new Date('2026-09-15T09:00:00Z'),
        contentHash: 'tenant-hash',
        provider: 'smartca',
        providerTransactionId: 'sca-tenant-1',
        certificateSerial: 'cert-tenant-1',
        signatureAlgorithm: 'RSA-PSS-SHA256',
        signatureValueRef: 'sig-ref-tenant-1',
        providerStatus: 'signed',
        verifiedAt: new Date('2026-09-15T09:01:00Z'),
      },
      landlordSignature: {
        signerId: 'user-landlord-1',
        role: 'landlord',
        signedAt: new Date('2026-09-15T09:02:00Z'),
        contentHash: 'landlord-hash',
        provider: 'smartca',
        providerTransactionId: 'sca-landlord-1',
        certificateSerial: 'cert-landlord-1',
        signatureAlgorithm: 'RSA-PSS-SHA256',
        signatureValueRef: 'sig-ref-landlord-1',
        providerStatus: 'signed',
        verifiedAt: new Date('2026-09-15T09:03:00Z'),
      },
    } as Contract)
    kycService.findByUserId.mockResolvedValue({
      status: 'verified',
      idCardNumber: '079123456789',
    } as KycRecord)

    const view = await service.getForActor(
      validContractId,
      'user-tenant-1',
      false
    )

    expect(view.parties.tenant).toEqual(
      expect.objectContaining({
        provider: 'smartca',
        providerTransactionId: 'sca-tenant-1',
        certificateSerial: 'cert-tenant-1',
        signatureAlgorithm: 'RSA-PSS-SHA256',
        providerStatus: 'signed',
        verifiedAt: '2026-09-15T09:01:00.000Z',
      })
    )
    expect(view.parties.landlord).toEqual(
      expect.objectContaining({
        provider: 'smartca',
        providerTransactionId: 'sca-landlord-1',
        certificateSerial: 'cert-landlord-1',
        signatureValueRef: 'sig-ref-landlord-1',
      })
    )
  })

  it('resolves the stored canonical artifact before exposing a locked contract view', async () => {
    const artifactRef = {
      artifactId: new ObjectId().toHexString(),
      revision: 2,
      templateKey: 'lease-vn',
      templateVersion: 4,
      hashSchemaVersion: 1,
      artifactHash: mockContract.contentLockedHash,
      contentType: 'application/pdf' as const,
      lockedAt: mockContract.contentLockedAt as Date,
    }
    contractRepo.findOne.mockResolvedValue({
      ...mockContract,
      artifactRef,
    } as Contract)
    kycService.findByUserId.mockResolvedValue({
      status: 'verified',
      idCardNumber: '079123456789',
    } as KycRecord)

    const view = await service.getForActor(
      validContractId,
      'user-tenant-1',
      false
    )

    expect(artifactService.resolveCanonicalArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ artifactRef })
    )
    expect(view.document.canonicalArtifact).toEqual(
      expect.objectContaining({
        artifactId: artifactRef.artifactId,
        revision: artifactRef.revision,
        artifactHash: artifactRef.artifactHash,
      })
    )
  })

  it('should throw ForbiddenException if actor is neither tenant, landlord, nor staff', async () => {
    contractRepo.findOne.mockResolvedValue(mockContract as Contract)

    await expect(
      service.getForActor(validContractId, 'intruder-user', false)
    ).rejects.toThrow(ForbiddenException)
  })

  it('allows a verified successor to read without granting signing access', async () => {
    contractRepo.findOne.mockResolvedValue(mockContract as Contract)
    ownershipTransferResolver.resolveContractAccess.mockResolvedValueOnce({
      canReadWorkspace: true,
      canSign: false,
      isOriginalParticipant: false,
      isSuccessorOwner: true,
    })
    kycService.findByUserId.mockResolvedValue({
      status: 'verified',
      idCardNumber: '079987654321',
    } as KycRecord)

    const view = await service.getForActor(
      validContractId,
      'successor-user',
      false
    )

    expect(view.access).toEqual({
      canReadWorkspace: true,
      canSign: false,
      isOriginalParticipant: false,
      isSuccessorOwner: true,
    })
    expect(view.parties.landlord.id).toBe('user-landlord-1')
    expect(view.actions.signingEligibility.reasonCode).toBe('NOT_PARTICIPANT')
  })

  it('should return eligible=false with KYC_NOT_VERIFIED if tenant KYC is not verified', async () => {
    contractRepo.findOne.mockResolvedValue(mockContract as Contract)
    kycService.findByUserId.mockImplementation((userId: string) => {
      if (userId === 'user-tenant-1') {
        return Promise.resolve({
          status: 'pending',
          idCardNumber: '079123456789',
        } as KycRecord)
      }
      return Promise.resolve({
        status: 'verified',
        idCardNumber: '079987654321',
      } as KycRecord)
    })

    const view = await service.getForActor(
      validContractId,
      'user-tenant-1',
      false
    )

    expect(view.actions.signingEligibility.eligible).toBe(false)
    expect(view.actions.signingEligibility.reasonCode).toBe('KYC_NOT_VERIFIED')
  })

  it('should return eligible=false with DEPOSIT_REQUIRED if deposit is unpaid', async () => {
    const unpaidContract = {
      ...mockContract,
      depositPaidAt: null,
    }
    contractRepo.findOne.mockResolvedValue(unpaidContract as Contract)
    kycService.findByUserId.mockResolvedValue({
      status: 'verified',
      idCardNumber: '079123456789',
    } as KycRecord)

    const view = await service.getForActor(
      validContractId,
      'user-tenant-1',
      false
    )

    expect(view.actions.signingEligibility.eligible).toBe(false)
    expect(view.actions.signingEligibility.reasonCode).toBe('DEPOSIT_REQUIRED')
  })

  it('should return eligible=false with ALREADY_SIGNED if participant already signed', async () => {
    const signedContract = {
      ...mockContract,
      signedByTenant: true,
    }
    contractRepo.findOne.mockResolvedValue(signedContract as Contract)
    kycService.findByUserId.mockResolvedValue({
      status: 'verified',
      idCardNumber: '079123456789',
    } as KycRecord)

    const view = await service.getForActor(
      validContractId,
      'user-tenant-1',
      false
    )

    expect(view.actions.signingEligibility.eligible).toBe(false)
    expect(view.actions.signingEligibility.reasonCode).toBe('ALREADY_SIGNED')
  })

  it('should return eligible=false with CONTENT_NOT_LOCKED if content is unlocked', async () => {
    const unlockedContract = {
      ...mockContract,
      contentLockedHash: null,
      contentLockedAt: null,
    }
    contractRepo.findOne.mockResolvedValue(unlockedContract as Contract)
    kycService.findByUserId.mockResolvedValue({
      status: 'verified',
      idCardNumber: '079123456789',
    } as KycRecord)

    const view = await service.getForActor(
      validContractId,
      'user-tenant-1',
      false
    )

    expect(view.actions.signingEligibility.eligible).toBe(false)
    expect(view.actions.signingEligibility.reasonCode).toBe(
      'CONTENT_NOT_LOCKED'
    )
  })

  it('projects truthful confirmed-fabric ledger summary with onChainValid=null', async () => {
    const confirmedContract = {
      ...mockContract,
      status: 'active',
      ledgerStatus: 'confirmed',
      ledgerNetworkMode: 'fabric' as const,
      blockchainAddress: 'tx-fabric-real-999',
      ledgerRecordedAt: new Date('2026-09-14T10:00:00Z'),
    }
    contractRepo.findOne.mockResolvedValue(confirmedContract as Contract)
    kycService.findByUserId.mockResolvedValue({
      status: 'verified',
      idCardNumber: '079123456789',
    } as KycRecord)

    const view = await service.getForActor(
      validContractId,
      'user-tenant-1',
      false
    )

    expect(view.ledger.networkMode).toBe('fabric')
    expect(view.ledger.status).toBe('confirmed-fabric')
    expect(view.ledger.txHash).toBe('tx-fabric-real-999')
    expect(view.ledger.onChainValid).toBeNull()
  })

  it('projects pending ledger status without claiming confirmation when outbox is pending', async () => {
    const pendingContract = {
      ...mockContract,
      status: 'active',
      ledgerStatus: 'pending',
      ledgerNetworkMode: null,
      blockchainAddress: null,
    }
    contractRepo.findOne.mockResolvedValue(pendingContract as Contract)
    kycService.findByUserId.mockResolvedValue({
      status: 'verified',
      idCardNumber: '079123456789',
    } as KycRecord)

    const view = await service.getForActor(
      validContractId,
      'user-tenant-1',
      false
    )

    expect(view.ledger.status).toBe('pending')
    expect(view.ledger.txHash).toBeNull()
    expect(view.ledger.onChainValid).toBeNull()
    expect(view.ledger.connectionState).toBeDefined()
  })

  it('exposes canEditContent=true and canLockContent=true for staff on unlocked draft contracts', async () => {
    const draftContract = {
      ...mockContract,
      status: 'draft',
      contentLockedHash: null,
      contentLockedAt: null,
      editorContent: { type: 'doc', content: [{ type: 'paragraph' }] },
    }
    contractRepo.findOne.mockResolvedValue(draftContract as Contract)
    kycService.findByUserId.mockResolvedValue({
      status: 'verified',
      idCardNumber: '079123456789',
    } as KycRecord)

    const view = await service.getForActor(
      validContractId,
      'staff-admin-id',
      true
    )

    expect(view.actions.canEditContent).toBe(true)
    expect(view.actions.canLockContent).toBe(true)
  })

  it('denies canEditContent and canLockContent for participant tenant', async () => {
    contractRepo.findOne.mockResolvedValue(mockContract as Contract)
    kycService.findByUserId.mockResolvedValue({
      status: 'verified',
      idCardNumber: '079123456789',
    } as KycRecord)

    const view = await service.getForActor(
      validContractId,
      'user-tenant-1',
      false
    )

    expect(view.actions.canEditContent).toBe(false)
    expect(view.actions.canLockContent).toBe(false)
  })

  it('exposes canEditContent=true and canLockContent=true for landlord on unlocked draft contracts', async () => {
    const draftContract = {
      ...mockContract,
      status: 'draft',
      contentLockedHash: null,
      contentLockedAt: null,
      landlordId: 'user-landlord-1',
    }
    contractRepo.findOne.mockResolvedValue(draftContract as Contract)
    kycService.findByUserId.mockResolvedValue({
      status: 'verified',
      idCardNumber: '079123456789',
    } as KycRecord)

    const view = await service.getForActor(
      validContractId,
      'user-landlord-1',
      false
    )

    expect(view.actions.canEditContent).toBe(true)
    expect(view.actions.canLockContent).toBe(true)
  })
})
