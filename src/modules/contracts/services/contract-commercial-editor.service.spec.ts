import { ConflictException, ForbiddenException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { ContractCommercialEditorService } from './contract-commercial-editor.service'
import { ContractsService } from './contracts.service'
import type { DepositAgreementsService } from './deposit-agreements.service'
import type {
  Contract,
  ContractCommercialDraft,
} from '../schemas/contract.schema'

type CommercialEditorTestSetup = {
  contract: Contract
  repository: Record<string, jest.Mock>
  service: ContractCommercialEditorService
  depositAgreementsService: { reviseSecurityDepositBeforeConsent: jest.Mock }
}

describe('ContractCommercialEditorService', () => {
  const draft: ContractCommercialDraft = {
    monthlyRent: 18_000_000,
    deposit: 36_000_000,
    paymentDay: 5,
    latePenaltyRate: 10,
    terminationNoticeDays: 30,
    durationMonths: 12,
    utilities: { electricity: 'tenant' },
    addendaIds: ['HANDOVER_RECORD'],
  }

  function setup(): CommercialEditorTestSetup {
    const contract = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      monthlyRent: 15_000_000,
      deposit: 30_000_000,
      paymentDay: 1,
      latePenaltyRate: 8,
      terminationNoticeDays: 30,
      durationMonths: 12,
      status: 'draft',
      commercialRevision: 0,
      commercialDraft: null,
      commercialAudit: [],
      contentLockedHash: null,
      contentLockedAt: null,
      contractCode: 'HD-ADMIN-INTEGRATION-1',
      propertyId: 'property-1',
      propertyTitle: 'Apartment 1',
      propertyAddress: '1 Example Street',
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2027-10-01T00:00:00.000Z'),
      depositAgreementId: 'deposit-agreement-1',
      contentRevision: 0,
      editorContent: null,
    } as unknown as Contract
    const repository = {
      findOne: jest.fn().mockResolvedValue(contract),
      save: jest.fn().mockResolvedValue(contract),
    }
    const depositAgreementsService = {
      reviseSecurityDepositBeforeConsent: jest
        .fn()
        .mockResolvedValue(undefined),
    }
    return {
      contract,
      repository,
      depositAgreementsService,
      service: new ContractCommercialEditorService(
        repository as never,
        depositAgreementsService as unknown as DepositAgreementsService
      ),
    }
  }

  it('returns base commercial values and exposes protected fields without making them editable', async () => {
    const { service } = setup()

    const result = await service.getEditor(
      '507f1f77bcf86cd799439011',
      'admin-1',
      true
    )

    expect(result.commercial).toEqual(
      expect.objectContaining({ monthlyRent: 15_000_000, deposit: 30_000_000 })
    )
    expect(result.protectedFields).toEqual(
      expect.arrayContaining(['legalProfile', 'clauses', 'contractTemplateRef'])
    )
    expect(result.locked).toBe(false)
  })

  it('rejects non-admin access and invalid commercial values', async () => {
    const { service } = setup()

    await expect(
      service.getEditor('507f1f77bcf86cd799439011', 'staff-1', false)
    ).rejects.toBeInstanceOf(ForbiddenException)

    const invalidDraft = await service.validateDraft(
      '507f1f77bcf86cd799439011',
      { ...draft, paymentDay: 32, addendaIds: ['UNTRUSTED_ADDENDUM'] },
      'admin-1',
      true
    )
    expect(invalidDraft.valid).toBe(false)
    expect(invalidDraft.errors).toContain('PAYMENT_DAY_INVALID')
    expect(invalidDraft.errors).toContain('COMMERCIAL_ADDENDUM_NOT_ALLOWED')

    const protectedFieldDraft = await service.validateDraft(
      '507f1f77bcf86cd799439011',
      { ...draft, legalProfile: 'FORGED' } as ContractCommercialDraft,
      'admin-1',
      true
    )
    expect(protectedFieldDraft.valid).toBe(false)
    expect(protectedFieldDraft.errors).toContain('COMMERCIAL_FIELD_NOT_ALLOWED')
  })

  it('saves an allowlisted draft with optimistic revision and audit hashes', async () => {
    const { service, contract, repository, depositAgreementsService } = setup()

    const result = await service.saveDraft(
      '507f1f77bcf86cd799439011',
      draft,
      0,
      'admin-1',
      true
    )

    expect(contract.commercialDraft).toEqual(draft)
    expect(contract.commercialRevision).toBe(1)
    const audit = contract.commercialAudit?.[0]
    expect(audit).toBeDefined()
    if (!audit) throw new Error('Expected a commercial audit entry')
    expect(audit.actorId).toBe('admin-1')
    expect(audit.revision).toBe(1)
    expect(audit.changedFields).toEqual(
      expect.arrayContaining(['monthlyRent', 'deposit'])
    )
    expect(audit.beforeHash).toMatch(/^[a-f0-9]{64}$/)
    expect(audit.afterHash).toMatch(/^[a-f0-9]{64}$/)
    expect(repository.save).toHaveBeenCalledWith(contract)
    expect(result.revision).toBe(1)
    expect(
      depositAgreementsService.reviseSecurityDepositBeforeConsent
    ).toHaveBeenCalledWith('deposit-agreement-1', draft.deposit)
  })

  it('rejects a deposit change after tenant consent locks the agreement', async () => {
    const { service, depositAgreementsService } = setup()
    depositAgreementsService.reviseSecurityDepositBeforeConsent.mockRejectedValue(
      new ConflictException('COMMERCIAL_DEPOSIT_LOCKED')
    )

    await expect(
      service.saveDraft(
        '507f1f77bcf86cd799439011',
        { ...draft, deposit: 40_000_000 },
        0,
        'admin-1',
        true
      )
    ).rejects.toThrow('COMMERCIAL_DEPOSIT_LOCKED')
  })

  it('fails closed for stale revisions and locked or closed contracts', async () => {
    const { service, contract } = setup()

    await expect(
      service.saveDraft('507f1f77bcf86cd799439011', draft, 1, 'admin-1', true)
    ).rejects.toThrow('CONTRACT_COMMERCIAL_REVISION_STALE')

    contract.contentLockedHash = 'a'.repeat(64)
    await expect(
      service.saveDraft('507f1f77bcf86cd799439011', draft, 0, 'admin-1', true)
    ).rejects.toThrow('CONTRACT_COMMERCIAL_EDITOR_LOCKED')

    contract.contentLockedHash = null
    contract.status = 'active'
    await expect(
      service.saveDraft('507f1f77bcf86cd799439011', draft, 0, 'admin-1', true)
    ).rejects.toThrow(ConflictException)
  })

  it('integrates server preview, optimistic conflict handling, reload, and canonical lock', async () => {
    const { service, contract, repository } = setup()

    await expect(
      service.getEditor(contract._id.toHexString(), 'admin-1', true)
    ).resolves.toEqual(expect.objectContaining({ revision: 0, locked: false }))

    await expect(
      service.validateDraft(contract._id.toHexString(), draft, 'admin-1', true)
    ).resolves.toEqual(expect.objectContaining({ valid: true }))

    const saved = await service.saveDraft(
      contract._id.toHexString(),
      draft,
      0,
      'admin-1',
      true
    )
    expect(saved.revision).toBe(1)
    expect(saved.commercial).toEqual(draft)

    await expect(
      service.saveDraft(
        contract._id.toHexString(),
        { ...draft, monthlyRent: 19_000_000 },
        0,
        'admin-1',
        true
      )
    ).rejects.toThrow('CONTRACT_COMMERCIAL_REVISION_STALE')

    await expect(
      service.getEditor(contract._id.toHexString(), 'admin-1', true)
    ).resolves.toEqual(
      expect.objectContaining({ revision: 1, commercial: draft })
    )

    const contentService = Object.create(
      ContractsService.prototype
    ) as ContractsService
    Reflect.set(contentService, 'contractRepository', repository)
    Reflect.set(contentService, 'kycService', {
      findByUserId: jest.fn().mockResolvedValue(null),
    })
    const locked = await contentService.lockContractContent(
      contract._id.toHexString(),
      'admin-1',
      0,
      true
    )
    expect(locked.status).toBe('awaiting-signature')
    expect(locked.contentLockedHash).toMatch(/^[a-f0-9]{64}$/)
    expect(locked.effectiveCommercial).toEqual(draft)
    expect(locked.effectiveCommercialRevision).toBe(1)
    expect(locked.endDate).toEqual(new Date('2027-10-01T00:00:00.000Z'))

    await expect(
      service.getEditor(contract._id.toHexString(), 'admin-1', true)
    ).resolves.toEqual(expect.objectContaining({ locked: true, revision: 1 }))
    await expect(
      service.saveDraft(
        contract._id.toHexString(),
        { ...draft, monthlyRent: 20_000_000 },
        1,
        'admin-1',
        true
      )
    ).rejects.toThrow('CONTRACT_COMMERCIAL_EDITOR_LOCKED')
  })
})

describe('ContractCommercialEditorService consent and legal checks', () => {
  const contractId = '507f1f77bcf86cd799439022'
  const snapshotDraft: ContractCommercialDraft = {
    monthlyRent: 12_000_000,
    deposit: 24_000_000,
    paymentDay: 5,
    latePenaltyRate: 10,
    terminationNoticeDays: 45,
    durationMonths: 12,
  }

  function build(overrides: Partial<Contract> = {}): {
    service: ContractCommercialEditorService
    repository: { save: jest.Mock }
  } {
    const contract = {
      _id: new ObjectId(contractId),
      monthlyRent: 12_000_000,
      deposit: 24_000_000,
      paymentDay: 5,
      latePenaltyRate: 10,
      terminationNoticeDays: 45,
      durationMonths: 12,
      status: 'draft',
      commercialRevision: 0,
      commercialDraft: null,
      commercialAudit: [],
      customClauses: 'Không nuôi thú cưng.',
      packageSnapshot: {
        packageId: 'pkg-12',
        version: 1,
        durationMonths: 12,
        monthlyRent: 12_000_000,
        depositPolicy: { type: 'MONTHS_OF_RENT', months: 2 },
        resolvedDepositAmount: 24_000_000,
      },
      ...overrides,
    } as unknown as Contract
    const repository = {
      findOne: jest.fn().mockResolvedValue(contract),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    }
    return {
      repository,
      service: new ContractCommercialEditorService(repository as never),
    }
  }

  it('accepts terms equal to the package snapshot', async () => {
    const { service } = build()
    const result = await service.validateDraft(
      contractId,
      { ...snapshotDraft, paymentDay: 10 },
      'admin-1',
      true
    )
    expect(result.valid).toBe(true)
  })

  it.each(['monthlyRent', 'deposit', 'durationMonths'] as const)(
    'rejects an admin change to %s with CONTRACT_CONSENT_REQUIRED',
    async field => {
      const { service, repository } = build()
      const input = { ...snapshotDraft, [field]: snapshotDraft[field] + 1 }
      await expect(
        service.saveDraft(contractId, input, 0, 'admin-1', true)
      ).rejects.toThrow('CONTRACT_CONSENT_REQUIRED')
      expect(repository.save).not.toHaveBeenCalled()
    }
  )

  it('uses terms the tenant already consented to as the baseline', async () => {
    const { service } = build({
      consentedTerms: {
        monthlyRent: 13_000_000,
        deposit: 26_000_000,
        durationMonths: 12,
      },
    })
    const result = await service.validateDraft(
      contractId,
      { ...snapshotDraft, monthlyRent: 13_000_000, deposit: 26_000_000 },
      'admin-1',
      true
    )
    expect(result.valid).toBe(true)
  })

  it('leaves manually created contracts without a snapshot editable', async () => {
    const { service } = build({ packageSnapshot: null })
    const editor = await service.getEditor(contractId, 'admin-1', true)
    expect(editor.consentRequiredFields).toEqual([])
    const result = await service.validateDraft(
      contractId,
      { ...snapshotDraft, monthlyRent: 15_000_000 },
      'admin-1',
      true
    )
    expect(result.valid).toBe(true)
  })

  it('returns the legal citation when the penalty exceeds the cap', async () => {
    const { service } = build()
    const result = await service.validateDraft(
      contractId,
      { ...snapshotDraft, latePenaltyRate: 20.5 },
      'admin-1',
      true
    )
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('Điều 468 Bộ luật Dân sự 2015')
  })

  it('rejects a notice period below the legal minimum', async () => {
    const { service } = build()
    const result = await service.validateDraft(
      contractId,
      { ...snapshotDraft, terminationNoticeDays: 10 },
      'admin-1',
      true
    )
    expect(result.errors.join(' ')).toContain('Điều 172 Luật Nhà ở 2023')
  })

  it('shows custom clauses read-only and refuses to take them from the payload', async () => {
    const { service } = build()
    const editor = await service.getEditor(contractId, 'admin-1', true)
    expect(editor.commercial?.customClauses).toBe('Không nuôi thú cưng.')
    expect(editor.protectedFields).toContain('customClauses')
    expect(editor.consentRequiredFields).toEqual([
      'monthlyRent',
      'deposit',
      'durationMonths',
    ])

    const forged = await service.validateDraft(
      contractId,
      { ...snapshotDraft, customClauses: 'Tự thêm' },
      'admin-1',
      true
    )
    expect(forged.errors).toContain('COMMERCIAL_FIELD_NOT_ALLOWED')
  })

  it('keeps the landlord clauses when the admin saves other terms', async () => {
    const { service, repository } = build()
    await service.saveDraft(
      contractId,
      { ...snapshotDraft, paymentDay: 10 },
      0,
      'admin-1',
      true
    )
    const saved = repository.save.mock.calls[0]?.[0] as Contract
    expect(saved.commercialDraft?.customClauses).toBe('Không nuôi thú cưng.')
  })
})
