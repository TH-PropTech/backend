import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { RentalFlowConfig } from '../schemas/rental-flow-config.schema'
import {
  asProfileRow,
  toProfileView,
  type ProfileConfigRow,
  type RentalFlowProfileView,
} from '../utils/rental-flow-config.mapper'
import { ConfigAuditService } from '../../activity-log/services/config-audit.service'
import {
  DEFAULT_FLOW_PROFILE_STEPS,
  SAFE_DEFAULT_FLOW_PROFILE_ID,
} from '../utils/default-flow-profile'
import { computeCanonicalFlowProfileHash } from '../utils/rental-flow-hash.util'
import { validateFlowProfileSteps } from '../utils/rental-flow-validator.util'
import type { SaveFlowProfileDraftDto } from '../dto/save-flow-profile-draft.dto'
import type { PublishFlowProfileDto } from '../dto/publish-flow-profile.dto'

@Injectable()
export class RentalFlowProfilesService implements OnModuleInit {
  private readonly logger = new Logger(RentalFlowProfilesService.name)

  constructor(
    @InjectRepository(RentalFlowConfig)
    private readonly profileRepo: Repository<RentalFlowConfig>,
    private readonly configAudit: ConfigAuditService
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSeedProfile()
  }

  async ensureSeedProfile(): Promise<RentalFlowProfileView> {
    const existing = await this.profileRepo.findOne({
      where: {
        kind: 'profile',
        key: SAFE_DEFAULT_FLOW_PROFILE_ID,
        status: 'published',
        version: 1,
      },
    })

    if (existing) {
      return toProfileView(existing)
    }

    this.logger.log(
      'Seeding initial published Flow Profile v1 (safe-default-profile)...'
    )

    const seedHash = computeCanonicalFlowProfileHash({
      profileId: SAFE_DEFAULT_FLOW_PROFILE_ID,
      name: 'Quy chuẩn Luồng thuê Mặc định (Nghị định 96/2024)',
      version: 1,
      steps: DEFAULT_FLOW_PROFILE_STEPS,
    })

    const seedProfile = this.profileRepo.create({
      kind: 'profile',
      key: SAFE_DEFAULT_FLOW_PROFILE_ID,
      name: 'Quy chuẩn Luồng thuê Mặc định (Nghị định 96/2024)',
      description:
        'Cấu hình tiêu chuẩn theo Luật Nhà ở 2023 và Phụ lục II Nghị định 96/2024/NĐ-CP.',
      status: 'published',
      version: 1,
      draftRevision: 1,
      contentHash: seedHash,
      schemaVersion: 1,
      changeClassification: 'PRESENTATION',
      steps: DEFAULT_FLOW_PROFILE_STEPS,
      createdBy: 'system',
      publishedBy: 'system',
      publishedAt: new Date(),
    })

    return toProfileView(await this.profileRepo.save(seedProfile))
  }

  async listProfiles(): Promise<RentalFlowProfileView[]> {
    const rows = await this.profileRepo.find({
      where: { kind: 'profile' },
      order: { createdAt: 'DESC' },
    })
    return rows.map(toProfileView)
  }

  async getProfile(profileId: string): Promise<{
    draft: RentalFlowProfileView | null
    publishedVersions: RentalFlowProfileView[]
  }> {
    const [draft, publishedVersions] = await Promise.all([
      this.profileRepo.findOne({
        where: { kind: 'profile', key: profileId, status: 'draft' },
      }),
      this.profileRepo.find({
        where: { kind: 'profile', key: profileId, status: 'published' },
        order: { version: 'DESC' },
      }),
    ])

    if (!draft && publishedVersions.length === 0) {
      throw new NotFoundException(`Không tìm thấy profile có mã [${profileId}]`)
    }

    return {
      draft: draft ? toProfileView(draft) : null,
      publishedVersions: publishedVersions.map(toProfileView),
    }
  }

  async getDraft(profileId: string): Promise<RentalFlowProfileView> {
    return toProfileView(await this.getDraftRow(profileId))
  }

  private async getDraftRow(profileId: string): Promise<ProfileConfigRow> {
    const found = await this.profileRepo.findOne({
      where: { kind: 'profile', key: profileId, status: 'draft' },
    })
    let draft = found ? asProfileRow(found) : null

    if (!draft) {
      // Nếu chưa có draft, lấy version published mới nhất để khởi tạo draft
      const latestRow = await this.profileRepo.findOne({
        where: { kind: 'profile', key: profileId, status: 'published' },
        order: { version: 'DESC' },
      })

      if (!latestRow) {
        throw new NotFoundException(
          `Không tìm thấy profile có mã [${profileId}]`
        )
      }
      const latestPublished = asProfileRow(latestRow)

      draft = asProfileRow(
        this.profileRepo.create({
          kind: 'profile',
          key: profileId,
          name: latestPublished.name,
          description: latestPublished.description,
          status: 'draft',
          version: null,
          draftRevision: (latestPublished.draftRevision || 1) + 1,
          contentHash: null,
          schemaVersion: latestPublished.schemaVersion || 1,
          changeClassification: latestPublished.changeClassification,
          steps: latestPublished.steps,
          createdBy: 'system',
        })
      )

      await this.profileRepo.save(draft)
    }

    return draft
  }

  async saveDraft(
    profileId: string,
    dto: SaveFlowProfileDraftDto,
    actorId: string
  ): Promise<RentalFlowProfileView> {
    validateFlowProfileSteps(dto.steps)

    const existingDraft = await this.profileRepo.findOne({
      where: { kind: 'profile', key: profileId, status: 'draft' },
    })
    let draft = existingDraft ? asProfileRow(existingDraft) : null

    if (draft) {
      if (draft.draftRevision !== dto.expectedRevision) {
        throw new ConflictException(
          'FLOW_CONFIG_DRAFT_STALE: Bản nháp đã được cập nhật bởi phiên khác. Vui lòng tải lại trang.'
        )
      }
      draft.name = dto.name
      draft.description = dto.description ?? draft.description
      draft.changeClassification = dto.changeClassification
      draft.steps = dto.steps
      draft.draftRevision += 1
      draft.updatedBy = actorId
    } else {
      draft = asProfileRow(
        this.profileRepo.create({
          kind: 'profile',
          key: profileId,
          name: dto.name,
          description: dto.description ?? '',
          status: 'draft',
          version: null,
          draftRevision: 1,
          contentHash: null,
          schemaVersion: 1,
          changeClassification: dto.changeClassification,
          steps: dto.steps,
          createdBy: actorId,
          updatedBy: actorId,
        })
      )
    }

    const saved = asProfileRow(await this.profileRepo.save(draft))

    await this.configAudit.append({
      scope: 'rental-flow',
      action: 'DRAFT_SAVED',
      actorId,
      targetType: 'profile',
      key: profileId,
      version: null,
      details: {
        draftRevision: saved.draftRevision,
        classification: saved.changeClassification,
      },
    })

    return toProfileView(saved)
  }

  async validateDraft(profileId: string): Promise<{
    valid: boolean
    classification: string
    warnings: string[]
  }> {
    const draft = await this.getDraft(profileId)
    validateFlowProfileSteps(draft.steps)

    const warnings: string[] = []
    if (draft.steps.step1.maxOccupants > 8) {
      warnings.push(
        'Số người ở tối đa lớn hơn 8 có thể vượt quy chuẩn mật độ của căn hộ tiêu chuẩn.'
      )
    }

    return {
      valid: true,
      classification: draft.changeClassification,
      warnings,
    }
  }

  async publish(
    profileId: string,
    dto: PublishFlowProfileDto,
    actorId: string
  ): Promise<RentalFlowProfileView> {
    const draft = await this.getDraftRow(profileId)

    if (draft.draftRevision !== dto.expectedRevision) {
      throw new ConflictException(
        'FLOW_CONFIG_DRAFT_STALE: Phiên bản nháp đã thay đổi. Vui lòng tải lại trước khi xuất bản.'
      )
    }

    validateFlowProfileSteps(draft.steps)

    // Lấy số phiên bản published cao nhất hiện tại
    const latestPublished = await this.profileRepo.findOne({
      where: { kind: 'profile', key: profileId, status: 'published' },
      order: { version: 'DESC' },
    })

    const newVersion = (latestPublished?.version ?? 0) + 1

    const contentHash = computeCanonicalFlowProfileHash({
      profileId,
      name: draft.name,
      version: newVersion,
      steps: draft.steps,
    })

    const publishedRecord = this.profileRepo.create({
      kind: 'profile',
      key: profileId,
      name: draft.name,
      description: draft.description,
      status: 'published',
      version: newVersion,
      draftRevision: draft.draftRevision,
      contentHash,
      schemaVersion: draft.schemaVersion,
      changeClassification: draft.changeClassification,
      steps: draft.steps,
      createdBy: draft.createdBy ?? null,
      publishedBy: actorId,
      publishedAt: new Date(),
    })

    const savedPublished = asProfileRow(
      await this.profileRepo.save(publishedRecord)
    )

    // Cập nhật draftRevision của draft để sẵn sàng cho lần sửa tiếp theo
    draft.draftRevision += 1
    draft.updatedBy = actorId
    await this.profileRepo.save(draft)

    await this.configAudit.append({
      scope: 'rental-flow',
      action: 'PROFILE_PUBLISHED',
      actorId,
      targetType: 'profile',
      key: profileId,
      version: newVersion,
      details: {
        contentHash,
        classification: savedPublished.changeClassification,
      },
    })

    this.logger.log(
      `Profile [${profileId}] v${newVersion} published successfully (hash: ${contentHash.slice(0, 12)}...)`
    )

    return toProfileView(savedPublished)
  }

  async restoreVersionAsDraft(
    profileId: string,
    version: number,
    actorId: string
  ): Promise<RentalFlowProfileView> {
    const targetRow = await this.profileRepo.findOne({
      where: { kind: 'profile', key: profileId, status: 'published', version },
    })

    if (!targetRow) {
      throw new NotFoundException(
        `Không tìm thấy phiên bản published [v${version}] của profile [${profileId}]`
      )
    }

    const targetVersion = asProfileRow(targetRow)
    const draft = await this.getDraftRow(profileId)
    draft.name = targetVersion.name
    draft.description = targetVersion.description
    draft.changeClassification = targetVersion.changeClassification
    draft.steps = targetVersion.steps
    draft.draftRevision += 1
    draft.updatedBy = actorId

    const saved = asProfileRow(await this.profileRepo.save(draft))

    await this.configAudit.append({
      scope: 'rental-flow',
      action: 'PROFILE_RESTORED',
      actorId,
      targetType: 'profile',
      key: profileId,
      version,
      details: {
        restoredFromVersion: version,
        newDraftRevision: saved.draftRevision,
      },
    })

    return toProfileView(saved)
  }

  async restoreVersion(
    profileId: string,
    version: number,
    actorId: string
  ): Promise<RentalFlowProfileView> {
    return this.restoreVersionAsDraft(profileId, version, actorId)
  }

  async getPublishedProfile(
    profileId: string,
    version: number
  ): Promise<RentalFlowProfileView | null> {
    const row = await this.profileRepo.findOne({
      where: { kind: 'profile', key: profileId, status: 'published', version },
    })
    return row ? toProfileView(row) : null
  }
}
