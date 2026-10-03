import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import {
  ContractTemplate,
  type ContractTemplateAnnexDefinition,
  type ContractTemplateAddendum,
  type ContractTemplateClause,
} from './contract-template.schema'
import {
  ContractTemplateAudit,
  type ContractTemplateAuditAction,
} from './contract-template-audit.schema'
import { getActiveLegalBasis } from './legal-basis.registry'
import type { LegalProfile } from './legal-profile.resolver'
import {
  CONTRACT_TEMPLATE_SCHEMA_VERSION,
  hashCanonicalTemplateBody,
  hashText,
  normalizeTemplateClauses,
} from './contract-template.canonical'
import { buildReviewedLeaseTemplateSeed } from './lease-template.seed'

export const CONTRACT_TEMPLATE_VARIABLE_ALLOWLIST = Object.freeze([
  'landlord',
  'tenant',
  'property',
  'propertyAddress',
  'startDate',
  'endDate',
  'durationMonths',
  'monthlyRent',
  'deposit',
  'paymentDay',
  'latePenaltyRate',
  'terminationNoticeDays',
])

export const CONTRACT_TEMPLATE_ADDENDUM_ALLOWLIST = Object.freeze([
  'HANDOVER_RECORD',
  'INVENTORY_LIST',
  'BUILDING_RULES',
  'DEPOSIT_RECEIPT',
])

const REQUIRED_TEMPLATE_VARIABLES = new Set(
  CONTRACT_TEMPLATE_VARIABLE_ALLOWLIST
)

export type ContractTemplateDraftInput = {
  legalProfile: LegalProfile
  clauses: ContractTemplateClause[]
  allowedVariables: string[]
  addenda: ContractTemplateAddendum[]
  citationIds: string[]
  annexDefinitions?: ContractTemplateAnnexDefinition[]
  schemaVersion?: number
  effectiveFrom?: Date | string | null
  referenceOnly?: boolean
  expectedRevision?: number
}

export type ContractTemplateLegalReleaseInput = Omit<
  ContractTemplateDraftInput,
  'schemaVersion' | 'referenceOnly'
> & {
  schemaVersion: number
  referenceOnly: boolean
  reviewReference: string
}

export type ContractTemplateValidation = {
  templateKey: string
  version: number
  valid: boolean
  errors: string[]
  contentHash: string
}

@Injectable()
export class ContractTemplateGovernanceService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ContractTemplateGovernanceService.name)

  constructor(
    @InjectRepository(ContractTemplate)
    private readonly templateRepository: Repository<ContractTemplate>,
    @InjectRepository(ContractTemplateAudit)
    private readonly auditRepository: Repository<ContractTemplateAudit>
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedReviewedTemplatesIfMissing()
  }

  /**
   * MongoDB is schemaless for these additive fields, so legal baselines are
   * seeded idempotently at bootstrap instead of through a SQL-style migration.
   * Existing published rows are never overwritten; legacy rows are surfaced for
   * an explicit reviewed legal release.
   */
  async seedReviewedTemplatesIfMissing(): Promise<void> {
    const profiles = [
      ['VN_RE_BUSINESS_ND96_APPENDIX_II', 'REAL_ESTATE_BUSINESS_STANDARD'],
      ['VN_INDIVIDUAL_RESIDENTIAL_LEASE', 'PRIVATE_CIVIL_APARTMENT_LEASE'],
    ] as const

    for (const [templateKey, legalProfile] of profiles) {
      const existing = await this.latestPublished(templateKey)
      if (existing) {
        if (
          existing.schemaVersion < CONTRACT_TEMPLATE_SCHEMA_VERSION ||
          !existing.annexDefinitions?.length ||
          existing.clauses.some(clause => !clause.content)
        ) {
          this.logger.warn(
            `Legacy published template ${templateKey}@${existing.version} requires an explicit legal release`
          )
        }
        continue
      }

      const seed = buildReviewedLeaseTemplateSeed(legalProfile)
      const template = this.templateRepository.create({
        templateKey,
        version: 1,
        status: 'published',
        legalProfile: seed.legalProfile,
        clauses: seed.clauses,
        schemaVersion: seed.schemaVersion,
        effectiveFrom: new Date(),
        referenceOnly: seed.referenceOnly,
        reviewStatus: 'published',
        reviewReference: seed.reviewReference,
        annexDefinitions: seed.annexDefinitions,
        allowedVariables: seed.allowedVariables,
        addenda: seed.addenda,
        citationIds: seed.citationIds,
        contentHash: hashCanonicalTemplateBody({
          legalProfile: seed.legalProfile,
          schemaVersion: seed.schemaVersion,
          clauses: seed.clauses,
          annexDefinitions: seed.annexDefinitions,
          citationIds: seed.citationIds,
        }),
        createdBy: 'system-legal-bootstrap',
        publishedBy: 'system-legal-bootstrap',
        publishedAt: new Date(),
        draftRevision: 1,
      })
      const saved = await this.templateRepository.save(template)
      await this.recordAudit({
        templateKey,
        version: saved.version,
        action: 'legal-release-published',
        actorId: 'system-legal-bootstrap',
        reason: 'mongodb-bootstrap-seed',
        reviewReference: seed.reviewReference,
        afterHash: saved.contentHash,
      })
      this.logger.log(`Seeded canonical lease template ${templateKey}@1`)
    }
  }

  async saveDraft(
    templateKey: string,
    input: ContractTemplateDraftInput,
    actorId: string,
    expectedRevision: number
  ): Promise<ContractTemplate> {
    const draft = await this.templateRepository.findOne({
      where: { templateKey, status: 'draft' },
    })
    if (draft && draft.draftRevision !== expectedRevision) {
      throw new ConflictException('CONTRACT_TEMPLATE_DRAFT_STALE')
    }

    const published = await this.latestPublished(templateKey)
    const clauses = input.clauses
      ? normalizeTemplateClauses(input.clauses)
      : (published?.clauses ?? [])
    await this.assertProtectedClausesUnchanged(
      clauses,
      published,
      actorId,
      templateKey
    )
    const annexDefinitions =
      input.annexDefinitions ??
      published?.annexDefinitions ??
      this.deriveAnnexDefinitions(input.addenda)
    const normalizedInput = {
      ...input,
      clauses,
      annexDefinitions,
      schemaVersion: input.schemaVersion ?? published?.schemaVersion ?? 1,
    }

    const target =
      draft ??
      this.templateRepository.create({
        templateKey,
        version: 0,
        status: 'draft',
        legalProfile: input.legalProfile,
        clauses,
        allowedVariables: input.allowedVariables,
        addenda: input.addenda,
        citationIds: input.citationIds,
        annexDefinitions,
        schemaVersion: normalizedInput.schemaVersion,
        effectiveFrom: this.toDate(input.effectiveFrom),
        referenceOnly: input.referenceOnly ?? false,
        reviewStatus: 'draft',
        contentHash: this.contentHash(normalizedInput),
        draftRevision: 1,
        createdBy: actorId,
      })
    if (draft) {
      target.legalProfile = input.legalProfile
      target.clauses = clauses
      target.allowedVariables = input.allowedVariables
      target.addenda = input.addenda
      target.citationIds = input.citationIds
      target.annexDefinitions = annexDefinitions
      target.schemaVersion = normalizedInput.schemaVersion
      target.effectiveFrom = this.toDate(input.effectiveFrom)
      target.referenceOnly =
        input.referenceOnly ?? target.referenceOnly ?? false
      target.contentHash = this.contentHash(normalizedInput)
      target.draftRevision += 1
      target.updatedBy = actorId
    }
    const saved = await this.templateRepository.save(target)
    await this.recordAudit({
      templateKey,
      version: saved.version,
      action: draft ? 'draft-updated' : 'draft-created',
      actorId,
      afterHash: saved.contentHash,
    })
    return saved
  }

  async validateDraft(
    templateKey: string
  ): Promise<ContractTemplateValidation> {
    const draft = await this.templateRepository.findOne({
      where: { templateKey, status: 'draft' },
    })
    if (!draft) throw new NotFoundException('CONTRACT_TEMPLATE_DRAFT_NOT_FOUND')
    return this.validationResult(draft)
  }

  async publishDraft(
    templateKey: string,
    actorId: string,
    reason?: string
  ): Promise<ContractTemplate> {
    const draft = await this.templateRepository.findOne({
      where: { templateKey, status: 'draft' },
    })
    if (!draft) throw new NotFoundException('CONTRACT_TEMPLATE_DRAFT_NOT_FOUND')
    const validation = this.validationResult(draft)
    if (!validation.valid) {
      throw new ConflictException(validation.errors.join(','))
    }
    const latest = await this.latestPublished(templateKey)
    const published = this.templateRepository.create({
      templateKey: draft.templateKey,
      version: (latest?.version ?? 0) + 1,
      status: 'published',
      legalProfile: draft.legalProfile,
      clauses: draft.clauses,
      schemaVersion: draft.schemaVersion ?? 1,
      effectiveFrom: draft.effectiveFrom ?? new Date(),
      referenceOnly: draft.referenceOnly ?? false,
      reviewStatus: 'published',
      reviewReference: draft.reviewReference ?? null,
      annexDefinitions: draft.annexDefinitions ?? null,
      allowedVariables: draft.allowedVariables,
      addenda: draft.addenda,
      citationIds: draft.citationIds,
      contentHash: validation.contentHash,
      createdBy: draft.createdBy,
      publishedBy: actorId,
      publishedAt: new Date(),
      draftRevision: 1,
    })
    const saved = await this.templateRepository.save(published)
    await this.recordAudit({
      templateKey,
      version: saved.version,
      action: 'validated',
      actorId,
      afterHash: saved.contentHash,
    })
    await this.recordAudit({
      templateKey,
      version: saved.version,
      action: 'published',
      actorId,
      reason: reason ?? null,
      afterHash: saved.contentHash,
    })
    await this.templateRepository.remove(draft)
    return saved
  }

  async publishLegalRelease(
    templateKey: string,
    input: ContractTemplateLegalReleaseInput,
    actorId: string,
    reason: string
  ): Promise<ContractTemplate> {
    if (!input.reviewReference.trim()) {
      throw new ConflictException('LEGAL_CITATION_REVIEW_REQUIRED')
    }
    const candidate = this.templateRepository.create({
      templateKey,
      version: ((await this.latestPublished(templateKey))?.version ?? 0) + 1,
      status: 'published',
      legalProfile: input.legalProfile,
      clauses: normalizeTemplateClauses(input.clauses ?? []),
      schemaVersion: input.schemaVersion,
      effectiveFrom: this.toDate(input.effectiveFrom) ?? new Date(),
      referenceOnly: input.referenceOnly,
      reviewStatus: 'published',
      reviewReference: input.reviewReference,
      annexDefinitions: input.annexDefinitions ?? null,
      allowedVariables: input.allowedVariables,
      addenda: input.addenda,
      citationIds: input.citationIds,
      contentHash: this.contentHash(input),
      createdBy: actorId,
      publishedBy: actorId,
      publishedAt: new Date(),
      draftRevision: 1,
    })
    const validation = this.validationResult(candidate)
    if (!validation.valid)
      throw new ConflictException(validation.errors.join(','))
    const saved = await this.templateRepository.save(candidate)
    await this.recordAudit({
      templateKey,
      version: saved.version,
      action: 'legal-release-published',
      actorId,
      reason,
      reviewReference: input.reviewReference,
      afterHash: saved.contentHash,
    })
    return saved
  }

  async getPublishedVersion(
    templateKey: string,
    version?: number
  ): Promise<ContractTemplate> {
    const template = version
      ? await this.templateRepository.findOne({
          where: { templateKey, version, status: 'published' },
        })
      : await this.latestPublished(templateKey)
    if (!template) throw new NotFoundException('CONTRACT_TEMPLATE_NOT_FOUND')
    return template
  }

  /** PROP-399: phiên bản published mới nhất của mỗi templateKey (nguồn của governance manifest). */
  async listLatestPublished(): Promise<ContractTemplate[]> {
    const published = await this.templateRepository.find({
      where: { status: 'published' },
    })
    const latest = new Map<string, ContractTemplate>()
    for (const template of published) {
      const current = latest.get(template.templateKey)
      if (!current || template.version > current.version) {
        latest.set(template.templateKey, template)
      }
    }
    return [...latest.values()].sort((a, b) =>
      a.templateKey.localeCompare(b.templateKey)
    )
  }

  async getAuditHistory(
    templateKey: string,
    version?: number
  ): Promise<ContractTemplateAudit[]> {
    return this.auditRepository.find({
      where: version ? { templateKey, version } : { templateKey },
      order: { createdAt: 'ASC' },
    })
  }

  private async latestPublished(
    templateKey: string
  ): Promise<ContractTemplate | null> {
    return this.templateRepository.findOne({
      where: { templateKey, status: 'published' },
      order: { version: 'DESC' },
    })
  }

  private validationResult(
    template: ContractTemplate
  ): ContractTemplateValidation {
    const errors: string[] = []
    const clauseNumbers = template.clauses.map(clause => clause.number)
    if (
      template.clauses.length !== 12 ||
      new Set(clauseNumbers).size !== 12 ||
      clauseNumbers.some(number => number < 1 || number > 12) ||
      template.clauses.some((clause, index) => clause.number !== index + 1)
    ) {
      errors.push('LEASE_ARTICLE_STRUCTURE_INVALID')
    }
    if (
      template.clauses.some(
        clause =>
          !clause.protected ||
          !clause.heading.trim() ||
          !/^[a-f0-9]{64}$/i.test(clause.contentHash) ||
          clause.citationIds.length === 0 ||
          (template.schemaVersion >= CONTRACT_TEMPLATE_SCHEMA_VERSION &&
            (!clause.content?.trim() ||
              clause.contentHash !==
                hashText(`${clause.heading.trim()}\n${clause.content.trim()}`)))
      )
    ) {
      errors.push('PROTECTED_LEGAL_CLAUSE_INVALID')
    }
    const unknownVariables = template.allowedVariables.filter(
      variable => !REQUIRED_TEMPLATE_VARIABLES.has(variable)
    )
    if (unknownVariables.length > 0)
      errors.push('TEMPLATE_VARIABLE_NOT_ALLOWED')
    if (
      [...REQUIRED_TEMPLATE_VARIABLES].some(
        variable => !template.allowedVariables.includes(variable)
      )
    ) {
      errors.push('TEMPLATE_REQUIRED_VARIABLE_MISSING')
    }
    if (
      template.addenda.some(
        addendum =>
          !CONTRACT_TEMPLATE_ADDENDUM_ALLOWLIST.includes(addendum.id) ||
          !addendum.title.trim() ||
          addendum.content.length > 10_000
      )
    ) {
      errors.push('TEMPLATE_ADDENDUM_NOT_ALLOWED')
    }
    const annexDefinitions = template.annexDefinitions ?? []
    if (annexDefinitions.length === 0) errors.push('LEASE_ANNEX_REQUIRED')
    if (
      annexDefinitions.some(annex => !annex.id.trim() || !annex.title.trim())
    ) {
      errors.push('LEASE_ANNEX_DEFINITION_INVALID')
    }
    try {
      const citationIds = [
        ...template.citationIds,
        ...template.clauses.flatMap(clause => clause.citationIds),
      ]
      getActiveLegalBasis([...new Set(citationIds)])
    } catch {
      errors.push('LEGAL_CITATION_REVIEW_REQUIRED')
    }
    return {
      templateKey: template.templateKey,
      version: template.version,
      valid: errors.length === 0,
      errors,
      contentHash: this.contentHash(template),
    }
  }

  private async assertProtectedClausesUnchanged(
    clauses: ContractTemplateClause[],
    published: ContractTemplate | null,
    actorId: string,
    templateKey: string
  ): Promise<void> {
    if (!published) return
    const publishedByNumber = new Map(
      published.clauses.map(clause => [clause.number, clause])
    )
    const changed = clauses.some(clause => {
      const baseline = publishedByNumber.get(clause.number)
      return (
        !baseline ||
        baseline.contentHash !== clause.contentHash ||
        baseline.heading !== clause.heading ||
        baseline.protected !== clause.protected
      )
    })
    if (changed) {
      await this.recordAudit({
        templateKey,
        version: published.version,
        action: 'protected-change-denied',
        actorId,
        deniedField: 'clauses',
        beforeHash: published.contentHash,
      })
      throw new ConflictException('PROTECTED_LEGAL_CLAUSE_CHANGED')
    }
  }

  private contentHash(
    input: ContractTemplateDraftInput | ContractTemplate
  ): string {
    const clauses = normalizeTemplateClauses(input.clauses ?? [])
    return hashCanonicalTemplateBody({
      legalProfile: input.legalProfile,
      schemaVersion: input.schemaVersion ?? 1,
      clauses,
      annexDefinitions: input.annexDefinitions ?? [],
      citationIds: [...input.citationIds].sort(),
    })
  }

  private deriveAnnexDefinitions(
    addenda: ContractTemplateAddendum[]
  ): ContractTemplateAnnexDefinition[] {
    return addenda.map(addendum => ({
      id: addendum.id,
      title: addendum.title,
      description: addendum.content,
      required: addendum.enabled,
    }))
  }

  private toDate(value: Date | string | null | undefined): Date | null {
    if (!value) return null
    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }

  private async recordAudit(input: {
    templateKey: string
    version: number
    action: ContractTemplateAuditAction
    actorId: string
    reason?: string | null
    beforeHash?: string | null
    afterHash?: string | null
    reviewReference?: string | null
    deniedField?: string | null
    metadata?: Record<string, string> | null
  }): Promise<void> {
    await this.auditRepository.save(this.auditRepository.create(input))
  }
}
