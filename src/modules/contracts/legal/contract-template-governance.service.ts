import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash } from 'node:crypto'
import { Repository } from 'typeorm'
import {
  ContractTemplate,
  type ContractTemplateAddendum,
  type ContractTemplateClause,
} from './contract-template.schema'
import {
  ContractTemplateAudit,
  type ContractTemplateAuditAction,
} from './contract-template-audit.schema'
import { getActiveLegalBasis } from './legal-basis.registry'
import type { LegalProfile } from './legal-profile.resolver'

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
}

export type ContractTemplateValidation = {
  templateKey: string
  version: number
  valid: boolean
  errors: string[]
  contentHash: string
}

@Injectable()
export class ContractTemplateGovernanceService {
  constructor(
    @InjectRepository(ContractTemplate)
    private readonly templateRepository: Repository<ContractTemplate>,
    @InjectRepository(ContractTemplateAudit)
    private readonly auditRepository: Repository<ContractTemplateAudit>
  ) {}

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
    this.assertProtectedClausesUnchanged(input.clauses, published)

    const target =
      draft ??
      this.templateRepository.create({
        templateKey,
        version: 0,
        status: 'draft',
        legalProfile: input.legalProfile,
        clauses: input.clauses,
        allowedVariables: input.allowedVariables,
        addenda: input.addenda,
        citationIds: input.citationIds,
        contentHash: this.contentHash(input),
        draftRevision: 1,
        createdBy: actorId,
      })
    if (draft) {
      target.legalProfile = input.legalProfile
      target.clauses = input.clauses
      target.allowedVariables = input.allowedVariables
      target.addenda = input.addenda
      target.citationIds = input.citationIds
      target.contentHash = this.contentHash(input)
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
          clause.citationIds.length === 0
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

  private assertProtectedClausesUnchanged(
    clauses: ContractTemplateClause[],
    published: ContractTemplate | null
  ): void {
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
    if (changed) throw new ConflictException('PROTECTED_LEGAL_CLAUSE_CHANGED')
  }

  private contentHash(
    input: ContractTemplateDraftInput | ContractTemplate
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          legalProfile: input.legalProfile,
          clauses: input.clauses,
          allowedVariables: [...input.allowedVariables].sort(),
          addenda: [...input.addenda].sort((left, right) =>
            left.id.localeCompare(right.id)
          ),
          citationIds: [...input.citationIds].sort(),
        })
      )
      .digest('hex')
  }

  private async recordAudit(input: {
    templateKey: string
    version: number
    action: ContractTemplateAuditAction
    actorId: string
    reason?: string | null
    beforeHash?: string | null
    afterHash?: string | null
  }): Promise<void> {
    await this.auditRepository.save(this.auditRepository.create(input))
  }
}
