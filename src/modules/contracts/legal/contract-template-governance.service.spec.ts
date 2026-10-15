import type { ActivityLog } from '../../activity-log/schemas/activity-log.schema'
import type { Repository } from 'typeorm'
import {
  CONTRACT_TEMPLATE_ADDENDUM_ALLOWLIST,
  CONTRACT_TEMPLATE_VARIABLE_ALLOWLIST,
  ContractTemplateGovernanceService,
  type ContractTemplateDraftInput,
} from './contract-template-governance.service'
import { ContractTemplate } from '../schemas/contract-template.schema'
import { ConfigAuditService } from '../../activity-log/services/config-audit.service'
import { ConfigAudit } from '../../activity-log/schemas/config-audit.schema'

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
    audits: ConfigAudit[]
    getPublished: () => ContractTemplate | null
  } {
    let draft: ContractTemplate | null = null
    const published = new Map<string, ContractTemplate>()
    const audits: ConfigAudit[] = []
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
      create: jest.fn((value: Partial<ConfigAudit>) =>
        Object.assign(new ConfigAudit(), value)
      ),
      save: jest.fn((value: ConfigAudit) => {
        audits.push(value)
        return Promise.resolve(value)
      }),
      find: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          audits.filter(
            audit =>
              audit.scope === where.scope &&
              audit.key === where.key &&
              (typeof where.version !== 'number' ||
                audit.version === where.version)
          )
        )
      ),
    }
    return {
      service: new ContractTemplateGovernanceService(
        templateRepository as unknown as Repository<ContractTemplate>,
        new ConfigAuditService(
          auditRepository as unknown as Repository<ActivityLog>
        )
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

  it('upgrades an untouched bootstrap template to the next version when the seed changes', async () => {
    const { service } = context()
    await service.seedReviewedTemplatesIfMissing()
    const first = await service.getPublishedVersion(
      'VN_INDIVIDUAL_RESIDENTIAL_LEASE'
    )
    first.reviewReference = 'PROP-321-LEGAL-REVIEW-OLD'

    await service.seedReviewedTemplatesIfMissing()

    const latest = await service.getPublishedVersion(
      'VN_INDIVIDUAL_RESIDENTIAL_LEASE'
    )
    expect(latest.version).toBe(2)
    expect(latest.createdBy).toBe('system-legal-bootstrap')
    expect(latest.clauses[0]?.content).toContain('{{property}}')
  })

  it('never upgrades a template that an admin published', async () => {
    const { service } = context()
    await service.seedReviewedTemplatesIfMissing()
    const first = await service.getPublishedVersion(
      'VN_INDIVIDUAL_RESIDENTIAL_LEASE'
    )
    first.reviewReference = 'PROP-321-LEGAL-REVIEW-OLD'
    first.publishedBy = 'admin-1'

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

  it('records a protected-change denial with deniedField and beforeHash', async () => {
    const { service, audits } = context()
    await service.saveDraft(templateKey, input, 'admin-1', 0)
    const published = await service.publishDraft(templateKey, 'admin-1')
    const changedClauses = input.clauses.map(clause =>
      clause.number === 1 ? { ...clause, contentHash: 'b'.repeat(64) } : clause
    )
    await expect(
      service.saveDraft(
        templateKey,
        { ...input, clauses: changedClauses },
        'admin-9',
        0
      )
    ).rejects.toThrow('PROTECTED_LEGAL_CLAUSE_CHANGED')

    expect(audits[0]).toEqual(
      expect.objectContaining({
        scope: 'contract-template',
        key: templateKey,
        version: 0,
        action: 'draft-created',
        actorId: 'admin-1',
      })
    )
    expect(audits[audits.length - 1]).toEqual(
      expect.objectContaining({
        scope: 'contract-template',
        key: templateKey,
        version: published.version,
        action: 'protected-change-denied',
        actorId: 'admin-9',
        details: { deniedField: 'clauses' },
        beforeHash: published.contentHash,
      })
    )
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
      {} as unknown as ConfigAuditService
    )

    const latest = await service.listLatestPublished()

    expect(templateRepository.find).toHaveBeenCalledWith({
      where: { status: 'published', kind: { $in: ['template', null] } },
    })
    expect(latest.map(t => `${t.templateKey}@${t.version}`)).toEqual([
      'VN_INDIVIDUAL@3',
      'VN_RE@1',
    ])
  })
})

describe('ContractTemplateGovernanceService kind scoping (G-LAY)', () => {
  type Stored = Record<string, unknown> & { kind?: string | null }
  const matches = (row: Stored, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, expected]) => {
      const actual = row[key] ?? null
      if (expected && typeof expected === 'object' && '$in' in expected) {
        return (expected as { $in: unknown[] }).$in.includes(actual)
      }
      return actual === expected
    })
  function build(stored: Stored[]): {
    service: ContractTemplateGovernanceService
    find: jest.Mock
    findOne: jest.Mock
  } {
    const find = jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(stored.filter(row => matches(row, where)))
    )
    const findOne = jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(stored.find(row => matches(row, where)) ?? null)
    )
    const service = new ContractTemplateGovernanceService(
      { find, findOne } as unknown as Repository<ContractTemplate>,
      {} as unknown as ConfigAuditService
    )
    return { service, find, findOne }
  }

  it('lists only template rows (kind template or legacy without kind), never layout rows', async () => {
    const { service } = build([
      {
        templateKey: 'VN_RE',
        version: 2,
        status: 'published',
        kind: 'template',
      },
      { templateKey: 'VN_RE', version: 1, status: 'published' },
      // Layout đã published cùng trạng thái: không được xuất hiện trong governance template.
      {
        kind: 'layout',
        profileKey: 'standard',
        templateKey: 'VN_RE',
        version: 7,
        status: 'published',
      },
    ])

    const latest = await service.listLatestPublished()

    expect(latest.map(t => `${t.templateKey}@${t.version}`)).toEqual([
      'VN_RE@2',
    ])
  })

  it('does not resolve a published version from a layout row sharing the templateKey', async () => {
    const { service, findOne } = build([
      {
        kind: 'layout',
        profileKey: 'standard',
        templateKey: 'VN_RE',
        version: 1,
        status: 'published',
      },
    ])

    await expect(service.getPublishedVersion('VN_RE', 1)).rejects.toThrow(
      'CONTRACT_TEMPLATE_NOT_FOUND'
    )
    expect(findOne).toHaveBeenCalledWith({
      where: {
        templateKey: 'VN_RE',
        version: 1,
        status: 'published',
        kind: { $in: ['template', null] },
      },
    })
  })
})

describe('ContractTemplateGovernanceService audit behaviour (characterization)', () => {
  const legacyRows = [
    {
      templateKey: 'VN_RE',
      version: 1,
      action: 'draft-created',
      actorId: 'admin-1',
      afterHash: 'h1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      templateKey: 'VN_RE',
      version: 1,
      action: 'protected-change-denied',
      actorId: 'admin-2',
      beforeHash: 'h0',
      deniedField: 'clauses',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    },
    {
      templateKey: 'VN_RE',
      version: 2,
      action: 'legal-release-published',
      actorId: 'system-legal-bootstrap',
      reason: 'seed',
      reviewReference: 'REV-1',
      metadata: { a: 'b' },
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
    },
  ]

  const storedRows = [
    {
      scope: 'contract-template',
      key: 'VN_RE',
      version: 1,
      action: 'draft-created',
      actorId: 'admin-1',
      afterHash: 'h1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      scope: 'contract-template',
      key: 'VN_RE',
      version: 1,
      action: 'protected-change-denied',
      actorId: 'admin-2',
      beforeHash: 'h0',
      details: { deniedField: 'clauses' },
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    },
    {
      scope: 'contract-template',
      key: 'VN_RE',
      version: 2,
      action: 'legal-release-published',
      actorId: 'system-legal-bootstrap',
      reason: 'seed',
      details: { reviewReference: 'REV-1', metadata: { a: 'b' } },
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
    },
  ]

  function build(): {
    service: ContractTemplateGovernanceService
    find: jest.Mock
  } {
    const find = jest.fn().mockResolvedValue(storedRows)
    const service = new ContractTemplateGovernanceService(
      {} as unknown as Repository<ContractTemplate>,
      new ConfigAuditService({ find } as unknown as Repository<ActivityLog>)
    )
    return { service, find }
  }

  it('reads history by templateKey ordered by createdAt ASC, without paging', async () => {
    const { service, find } = build()

    const result = await service.getAuditHistory('VN_RE')

    expect(find).toHaveBeenCalledTimes(1)
    expect(find).toHaveBeenCalledWith({
      where: { kind: 'config-audit', scope: 'contract-template', key: 'VN_RE' },
      order: { createdAt: 'ASC' },
    })
    expect(result).toEqual(legacyRows)
  })

  it('narrows history by version when given and keeps the legacy JSON field names', async () => {
    const { service, find } = build()

    const result = await service.getAuditHistory('VN_RE', 2)

    expect(find).toHaveBeenCalledWith({
      where: {
        kind: 'config-audit',
        scope: 'contract-template',
        key: 'VN_RE',
        version: 2,
      },
      order: { createdAt: 'ASC' },
    })
    expect(JSON.parse(JSON.stringify(result))).toEqual(
      JSON.parse(JSON.stringify(legacyRows))
    )
    expect(result[1]).not.toHaveProperty('scope')
    expect(result[1]).not.toHaveProperty('key')
  })
})
