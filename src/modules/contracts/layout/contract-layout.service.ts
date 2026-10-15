import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash } from 'node:crypto'
import { Repository } from 'typeorm'
import type { LegalProfile } from '../legal/legal-profile.resolver'
import { ConfigAuditService } from '../../activity-log/services/config-audit.service'
import type { ContractLayoutAuditAction } from '../schemas/contract-layout-audit.schema'
import type {
  ContractLayoutBlock,
  ContractLayoutDisclosure,
  ContractLayoutProfile,
  ContractLayoutSupplementaryClause,
} from '../schemas/contract-layout-profile.schema'
import { ContractTemplate } from '../schemas/contract-template.schema'
import { ContractTemplateKindRepository } from '../utils/contract-template-kind.repository'
import { toContractLayoutProfile } from './contract-layout.mapper'
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

/**
 * Layout không bắt buộc có mẫu: `templateKey` null nghĩa là layout chung theo legalProfile.
 * Trường entity khai báo `string` cho mẫu, nên ép kiểu ở đúng một chỗ.
 */
function layoutTemplateKey(key: string | null | undefined): string {
  return (key ?? null) as unknown as string
}

@Injectable()
export class ContractLayoutService {
  /** G-LAY: layout nằm trong `contract_templates` (kind='layout'); facade cộng `kind` vào mọi truy vấn. */
  private readonly profiles: ContractTemplateKindRepository

  constructor(
    @InjectRepository(ContractTemplate)
    templateRepository: Repository<ContractTemplate>,
    private readonly auditService: ConfigAuditService
  ) {
    this.profiles = new ContractTemplateKindRepository(
      templateRepository,
      'layout'
    )
  }

  async saveDraft(
    profileKey: string,
    input: ContractLayoutDraftInput,
    actorId: string,
    expectedRevision: number
  ): Promise<ContractLayoutProfile> {
    const draft = await this.profiles.findOne({
      where: { profileKey, status: 'draft' },
    })
    if (draft && draft.draftRevision !== expectedRevision) {
      throw new ConflictException('CONTRACT_LAYOUT_DRAFT_STALE')
    }
    const contentHash = this.contentHash(input)
    const target =
      draft ??
      this.profiles.create({
        profileKey,
        version: 0,
        status: 'draft',
        legalProfile: input.legalProfile,
        templateKey: layoutTemplateKey(input.templateKey),
        blocks: input.blocks,
        supplementaryClauses: this.sanitizeClauses(input.supplementaryClauses),
        disclosures: input.disclosures ?? [],
        contentHash,
        draftRevision: 1,
        createdBy: actorId,
      })
    if (draft) {
      target.legalProfile = input.legalProfile
      target.templateKey = layoutTemplateKey(input.templateKey)
      target.blocks = input.blocks
      target.supplementaryClauses = this.sanitizeClauses(
        input.supplementaryClauses
      )
      target.disclosures = input.disclosures ?? []
      target.contentHash = contentHash
      target.draftRevision += 1
      target.updatedBy = actorId
    }
    const saved = await this.profiles.save(target)
    await this.recordAudit({
      profileKey,
      version: saved.version,
      action: draft ? 'draft-updated' : 'draft-created',
      actorId,
      afterHash: saved.contentHash,
    })
    return toContractLayoutProfile(saved)
  }

  async validateDraft(profileKey: string): Promise<ContractLayoutValidation> {
    const draft = await this.getDraft(profileKey)
    return this.validate(toContractLayoutProfile(draft))
  }

  async previewDraft(profileKey: string): Promise<ContractLayoutProfile> {
    const draft = toContractLayoutProfile(await this.getDraft(profileKey))
    return { ...draft, supplementaryClauses: [...draft.supplementaryClauses] }
  }

  async publishDraft(
    profileKey: string,
    actorId: string,
    reason?: string
  ): Promise<ContractLayoutProfile> {
    const draft = await this.getDraft(profileKey)
    const validation = this.validate(toContractLayoutProfile(draft))
    if (!validation.valid)
      throw new ConflictException(validation.errors.join(','))
    const latest = await this.profiles.findOne({
      where: { profileKey, status: 'published' },
      order: { version: 'DESC' },
    })
    // Bản published là dòng MỚI: không mang `_id` của draft (nếu mang, save sẽ ghi đè
    // chính draft rồi remove(draft) xóa luôn bản published).
    const { _id: _draftId, ...draftFields } = draft
    void _draftId
    const published = this.profiles.create({
      ...draftFields,
      version: (latest?.version ?? 0) + 1,
      status: 'published',
      contentHash: validation.contentHash,
      draftRevision: 1,
      publishedBy: actorId,
      publishedAt: new Date(),
    })
    const saved = await this.profiles.save(published)
    await this.recordAudit({
      profileKey,
      version: saved.version,
      action: 'published',
      actorId,
      reason: reason ?? null,
      afterHash: saved.contentHash,
    })
    await this.profiles.remove(draft)
    return toContractLayoutProfile(saved)
  }

  async archive(
    profileKey: string,
    version: number,
    actorId: string,
    reason: string
  ): Promise<ContractLayoutProfile> {
    const profile = await this.profiles.findOne({
      where: { profileKey, version, status: 'published' },
    })
    if (!profile) throw new NotFoundException('CONTRACT_LAYOUT_NOT_FOUND')
    profile.status = 'archived'
    const saved = await this.profiles.save(profile)
    await this.recordAudit({
      profileKey,
      version,
      action: 'archived',
      actorId,
      reason,
      beforeHash: saved.contentHash,
      afterHash: saved.contentHash,
    })
    return toContractLayoutProfile(saved)
  }

  /** PROP-399: phiên bản published mới nhất của mỗi profileKey (nguồn của governance manifest). */
  async listLatestPublished(): Promise<ContractLayoutProfile[]> {
    const published = await this.profiles.find({
      where: { status: 'published' },
    })
    const latest = new Map<string, ContractTemplate>()
    for (const profile of published) {
      const key = profile.profileKey ?? ''
      const current = latest.get(key)
      if (!current || profile.version > current.version) {
        latest.set(key, profile)
      }
    }
    return [...latest.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, profile]) => toContractLayoutProfile(profile))
  }

  async findPublishedForContract(
    legalProfile: LegalProfile,
    templateKey: string | null
  ): Promise<ContractLayoutProfile | null> {
    const candidates = await this.profiles.find({
      where: { legalProfile, status: 'published' },
      order: { version: 'DESC' },
    })
    const found =
      candidates.find(profile => profile.templateKey === templateKey) ??
      candidates.find(profile => !profile.templateKey) ??
      null
    return found ? toContractLayoutProfile(found) : null
  }

  private async getDraft(profileKey: string): Promise<ContractTemplate> {
    const draft = await this.profiles.findOne({
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

  private async recordAudit(input: {
    profileKey: string
    version: number
    action: ContractLayoutAuditAction
    actorId: string
    reason?: string | null
    beforeHash?: string | null
    afterHash?: string | null
    deniedField?: string | null
  }): Promise<void> {
    const { profileKey, deniedField, ...rest } = input
    await this.auditService.append({
      scope: 'contract-layout',
      key: profileKey,
      ...rest,
      ...(deniedField !== undefined ? { details: { deniedField } } : {}),
    })
  }
}
