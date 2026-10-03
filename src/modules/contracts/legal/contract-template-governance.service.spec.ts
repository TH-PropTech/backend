import type { Repository } from 'typeorm'
import {
  CONTRACT_TEMPLATE_ADDENDUM_ALLOWLIST,
  CONTRACT_TEMPLATE_VARIABLE_ALLOWLIST,
  ContractTemplateGovernanceService,
  type ContractTemplateDraftInput,
} from './contract-template-governance.service'
import { ContractTemplate } from './contract-template.schema'
import { ContractTemplateAudit } from './contract-template-audit.schema'

describe('ContractTemplateGovernanceService', () => {
  const templateKey = 'VN_INDIVIDUAL_RESIDENTIAL_LEASE'
  const clauses = Array.from({ length: 12 }, (_, index) => ({
    number: index + 1,
    heading: `Clause ${index + 1}`,
    contentHash: 'a'.repeat(64),
    citationIds: ['DECREE_96_2024_APPENDIX_II_RESIDENTIAL_LEASE'],
    protected: true,
  }))
  const input: ContractTemplateDraftInput = {
    legalProfile: 'PRIVATE_CIVIL_APARTMENT_LEASE',
    clauses,
    allowedVariables: [...CONTRACT_TEMPLATE_VARIABLE_ALLOWLIST],
    addenda: [
      {
        id: CONTRACT_TEMPLATE_ADDENDUM_ALLOWLIST[0] ?? 'HANDOVER_RECORD',
        title: 'Handover',
        content: 'Plain text handover addendum',
        enabled: true,
      },
    ],
    citationIds: ['DECREE_96_2024_APPENDIX_II_RESIDENTIAL_LEASE'],
  }

  function context(): {
    service: ContractTemplateGovernanceService
    audits: ContractTemplateAudit[]
    getPublished: () => ContractTemplate | null
  } {
    let draft: ContractTemplate | null = null
    const published = new Map<string, ContractTemplate>()
    const audits: ContractTemplateAudit[] = []
    const templateRepository = {
      findOne: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        if (where.status === 'draft') return Promise.resolve(draft)
        if (where.status === 'published') {
          return Promise.resolve(
            published.get(String(where.templateKey)) ?? null
          )
        }
        return Promise.resolve(null)
      }),
      create: jest.fn((value: Partial<ContractTemplate>) =>
        Object.assign(new ContractTemplate(), value)
      ),
      save: jest.fn((value: ContractTemplate) => {
        if (value.status === 'draft') draft = value
        if (value.status === 'published')
          published.set(value.templateKey, value)
        return Promise.resolve(value)
      }),
      remove: jest.fn((value: ContractTemplate) => {
        if (draft === value) draft = null
        return Promise.resolve(value)
      }),
    }
    const auditRepository = {
      create: jest.fn((value: Partial<ContractTemplateAudit>) =>
        Object.assign(new ContractTemplateAudit(), value)
      ),
      save: jest.fn((value: ContractTemplateAudit) => {
        audits.push(value)
        return Promise.resolve(value)
      }),
      find: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          audits.filter(audit =>
            typeof where.version === 'number'
              ? audit.version === where.version
              : audit.templateKey === where.templateKey
          )
        )
      ),
    }
    return {
      service: new ContractTemplateGovernanceService(
        templateRepository as unknown as Repository<ContractTemplate>,
        auditRepository as unknown as Repository<ContractTemplateAudit>
      ),
      audits,
      getPublished: () => published.get(templateKey) ?? null,
    }
  }

  it('rejects incomplete variables and unsafe addenda during validation', async () => {
    const { service } = context()
    await service.saveDraft(
      templateKey,
      {
        ...input,
        allowedVariables: input.allowedVariables.filter(
          variable => variable !== 'deposit'
        ),
        addenda: [
          {
            id: 'CUSTOM_HTML',
            title: 'Unsafe',
            content: '<script>alert(1)</script>',
            enabled: true,
          },
        ],
      },
      'admin-1',
      0
    )

    const validation = await service.validateDraft(templateKey)
    expect(validation.valid).toBe(false)
    expect(validation.errors).toEqual(
      expect.arrayContaining([
        'TEMPLATE_REQUIRED_VARIABLE_MISSING',
        'TEMPLATE_ADDENDUM_NOT_ALLOWED',
      ])
    )
  })

  it('seeds missing MongoDB template documents idempotently without overwriting published rows', async () => {
    const { service } = context()
    await service.seedReviewedTemplatesIfMissing()

    const firstBusiness = await service.getPublishedVersion(
      'VN_RE_BUSINESS_ND96_APPENDIX_II'
    )
    expect(firstBusiness.schemaVersion).toBe(2)
    expect(firstBusiness.clauses).toHaveLength(12)
    expect(firstBusiness.annexDefinitions).toHaveLength(4)

    await service.seedReviewedTemplatesIfMissing()
    await expect(
      service.getPublishedVersion('VN_INDIVIDUAL_RESIDENTIAL_LEASE')
    ).resolves.toEqual(expect.objectContaining({ version: 1 }))
  })

  it('publishes a validated immutable revision and retains audit history', async () => {
    const { service, audits, getPublished } = context()
    await service.saveDraft(templateKey, input, 'admin-1', 0)

    const published = await service.publishDraft(
      templateKey,
      'admin-1',
      'initial legal review'
    )
    expect(published.status).toBe('published')
    expect(published.version).toBe(1)
    expect(published.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(getPublished()).toEqual(published)
    expect(audits.map(audit => audit.action)).toEqual([
      'draft-created',
      'validated',
      'published',
    ])

    await expect(service.getPublishedVersion(templateKey, 1)).resolves.toBe(
      published
    )
    await expect(service.getAuditHistory(templateKey, 1)).resolves.toHaveLength(
      2
    )
  })

  it('blocks stale draft writes and protected-clause mutations after publication', async () => {
    const { service } = context()
    await service.saveDraft(templateKey, input, 'admin-1', 0)
    await expect(
      service.saveDraft(templateKey, input, 'admin-1', 0)
    ).rejects.toThrow('CONTRACT_TEMPLATE_DRAFT_STALE')
    await service.publishDraft(templateKey, 'admin-1')

    const changedClauses = input.clauses.map(clause =>
      clause.number === 1 ? { ...clause, contentHash: 'b'.repeat(64) } : clause
    )
    await expect(
      service.saveDraft(
        templateKey,
        { ...input, clauses: changedClauses },
        'admin-1',
        0
      )
    ).rejects.toThrow('PROTECTED_LEGAL_CLAUSE_CHANGED')
  })
})

describe('ContractTemplateGovernanceService.listLatestPublished (PROP-399 governance source)', () => {
  it('returns only the highest published version per templateKey, ordered by key', async () => {
    const rows = [
      { templateKey: 'VN_RE', version: 1, status: 'published' },
      { templateKey: 'VN_INDIVIDUAL', version: 1, status: 'published' },
      { templateKey: 'VN_INDIVIDUAL', version: 3, status: 'published' },
      { templateKey: 'VN_INDIVIDUAL', version: 2, status: 'published' },
    ] as ContractTemplate[]
    const templateRepository = {
      find: jest.fn().mockResolvedValue(rows),
    }
    const service = new ContractTemplateGovernanceService(
      templateRepository as unknown as Repository<ContractTemplate>,
      {} as unknown as Repository<ContractTemplateAudit>
    )

    const latest = await service.listLatestPublished()

    expect(templateRepository.find).toHaveBeenCalledWith({
      where: { status: 'published' },
    })
    expect(latest.map(t => `${t.templateKey}@${t.version}`)).toEqual([
      'VN_INDIVIDUAL@3',
      'VN_RE@1',
    ])
  })
})
