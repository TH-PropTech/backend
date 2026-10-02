import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash } from 'node:crypto'
import { Repository } from 'typeorm'
import type { LegalProfile } from '../legal/legal-profile.resolver'
import { ContractLayoutAudit } from './contract-layout-audit.schema'
import {
  ContractLayoutProfile,
  type ContractLayoutBlock,
  type ContractLayoutDisclosure,
  type ContractLayoutSupplementaryClause,
} from './contract-layout-profile.schema'
import { validateContractLayout } from './contract-layout.validator'

export type ContractLayoutDraftInput = {
  legalProfile: LegalProfile
  templateKey?: string | null
  blocks: ContractLayoutBlock[]
  supplementaryClauses: ContractLayoutSupplementaryClause[]
  disclosures?: ContractLayoutDisclosure[]
}

export type ContractLayoutValidation = {
  valid: boolean
  errors: string[]
  contentHash: string
}

@Injectable()
export class ContractLayoutService {
  constructor(
    @InjectRepository(ContractLayoutProfile)
    private readonly profileRepository: Repository<ContractLayoutProfile>,
    @InjectRepository(ContractLayoutAudit)
    private readonly auditRepository: Repository<ContractLayoutAudit>
  ) {}

  async saveDraft(
    profileKey: string,
    input: ContractLayoutDraftInput,
    actorId: string,
    expectedRevision: number
  ): Promise<ContractLayoutProfile> {
    const draft = await this.profileRepository.findOne({
      where: { profileKey, status: 'draft' },
    })
    if (draft && draft.draftRevision !== expectedRevision) {
      throw new ConflictException('CONTRACT_LAYOUT_DRAFT_STALE')
    }
    const contentHash = this.contentHash(input)
    const target =
      draft ??
      this.profileRepository.create({
        profileKey,
        version: 0,
        status: 'draft',
        legalProfile: input.legalProfile,
        templateKey: input.templateKey ?? null,
        blocks: input.blocks,
        supplementaryClauses: this.sanitizeClauses(input.supplementaryClauses),
        disclosures: input.disclosures ?? [],
        contentHash,
        draftRevision: 1,
        createdBy: actorId,
      })
    if (draft) {
      target.legalProfile = input.legalProfile
      target.templateKey = input.templateKey ?? null
      target.blocks = input.blocks
      target.supplementaryClauses = this.sanitizeClauses(
        input.supplementaryClauses
      )
      target.disclosures = input.disclosures ?? []
      target.contentHash = contentHash
      target.draftRevision += 1
      target.updatedBy = actorId
    }
    const saved = await this.profileRepository.save(target)
    await this.recordAudit({
      profileKey,
      version: saved.version,
      action: draft ? 'draft-updated' : 'draft-created',
      actorId,
      afterHash: saved.contentHash,
    })
    return saved
  }

  async validateDraft(profileKey: string): Promise<ContractLayoutValidation> {
    const draft = await this.getDraft(profileKey)
    return this.validate(draft)
  }

  async previewDraft(profileKey: string): Promise<ContractLayoutProfile> {
    const draft = await this.getDraft(profileKey)
    return { ...draft, supplementaryClauses: [...draft.supplementaryClauses] }
  }

  async publishDraft(
    profileKey: string,
    actorId: string,
    reason?: string
  ): Promise<ContractLayoutProfile> {
    const draft = await this.getDraft(profileKey)
    const validation = this.validate(draft)
    if (!validation.valid)
      throw new ConflictException(validation.errors.join(','))
    const latest = await this.profileRepository.findOne({
      where: { profileKey, status: 'published' },
      order: { version: 'DESC' },
    })
    const published = this.profileRepository.create({
      ...draft,
      version: (latest?.version ?? 0) + 1,
      status: 'published',
      contentHash: validation.contentHash,
      draftRevision: 1,
      publishedBy: actorId,
      publishedAt: new Date(),
    })
    const saved = await this.profileRepository.save(published)
    await this.recordAudit({
      profileKey,
      version: saved.version,
      action: 'published',
      actorId,
      reason: reason ?? null,
      afterHash: saved.contentHash,
    })
    await this.profileRepository.remove(draft)
    return saved
  }

  async archive(
    profileKey: string,
    version: number,
    actorId: string,
    reason: string
  ): Promise<ContractLayoutProfile> {
    const profile = await this.profileRepository.findOne({
      where: { profileKey, version, status: 'published' },
    })
    if (!profile) throw new NotFoundException('CONTRACT_LAYOUT_NOT_FOUND')
    profile.status = 'archived'
    const saved = await this.profileRepository.save(profile)
    await this.recordAudit({
      profileKey,
      version,
      action: 'archived',
      actorId,
      reason,
      beforeHash: saved.contentHash,
      afterHash: saved.contentHash,
    })
    return saved
  }

  async findPublishedForContract(
    legalProfile: LegalProfile,
    templateKey: string | null
  ): Promise<ContractLayoutProfile | null> {
    const candidates = await this.profileRepository.find({
      where: { legalProfile, status: 'published' },
      order: { version: 'DESC' },
    })
    return (
      candidates.find(profile => profile.templateKey === templateKey) ??
      candidates.find(profile => !profile.templateKey) ??
      null
    )
  }

  private async getDraft(profileKey: string): Promise<ContractLayoutProfile> {
    const draft = await this.profileRepository.findOne({
      where: { profileKey, status: 'draft' },
    })
    if (!draft) throw new NotFoundException('CONTRACT_LAYOUT_DRAFT_NOT_FOUND')
    return draft
  }

  private validate(profile: ContractLayoutProfile): ContractLayoutValidation {
    try {
      validateContractLayout(profile.blocks, profile.supplementaryClauses)
      return { valid: true, errors: [], contentHash: this.contentHash(profile) }
    } catch (error) {
      return {
        valid: false,
        errors: [
          error instanceof Error ? error.message : 'CONTRACT_LAYOUT_INVALID',
        ],
        contentHash: this.contentHash(profile),
      }
    }
  }

  private contentHash(
    input: ContractLayoutDraftInput | ContractLayoutProfile
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          legalProfile: input.legalProfile,
          templateKey: input.templateKey ?? null,
          blocks: input.blocks,
          supplementaryClauses: this.sanitizeClauses(
            input.supplementaryClauses
          ),
          disclosures: input.disclosures ?? [],
        })
      )
      .digest('hex')
  }

  private sanitizeClauses(
    clauses: readonly ContractLayoutSupplementaryClause[]
  ): ContractLayoutSupplementaryClause[] {
    return clauses.map(clause => ({
      ...clause,
      content: clause.content.replace(
        /<script\b[^>]*>[\s\S]*?<\/script>/gi,
        ''
      ),
    }))
  }

  private async recordAudit(
    input: Omit<ContractLayoutAudit, '_id' | 'createdAt'>
  ): Promise<void> {
    await this.auditRepository.save(this.auditRepository.create(input))
  }
}
