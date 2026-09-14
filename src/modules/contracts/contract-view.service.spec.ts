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

describe('ContractViewService', () => {
  let service: ContractViewService
  let contractRepo: jest.Mocked<Repository<Contract>>
  let kycService: jest.Mocked<KycService>

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
      ],
    }).compile()

    service = module.get<ContractViewService>(ContractViewService)
    contractRepo = module.get(getRepositoryToken(Contract))
    kycService = module.get(KycService)
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

  it('should throw ForbiddenException if actor is neither tenant, landlord, nor staff', async () => {
    contractRepo.findOne.mockResolvedValue(mockContract as Contract)

    await expect(
      service.getForActor(validContractId, 'intruder-user', false)
    ).rejects.toThrow(ForbiddenException)
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
})
