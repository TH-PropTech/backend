import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { RentalFlowProfile } from '../schemas/rental-flow-profile.schema'
import { RentalFlowAudit } from '../schemas/rental-flow-audit.schema'
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
    @InjectRepository(RentalFlowProfile)
    private readonly profileRepo: Repository<RentalFlowProfile>,
    @InjectRepository(RentalFlowAudit)
    private readonly auditRepo: Repository<RentalFlowAudit>
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSeedProfile()
  }

  async ensureSeedProfile(): Promise<RentalFlowProfile> {
    const existing = await this.profileRepo.findOne({
      where: {
        profileId: SAFE_DEFAULT_FLOW_PROFILE_ID,
        status: 'published',
        version: 1,
      },
    })

    if (existing) {
      return existing
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
      profileId: SAFE_DEFAULT_FLOW_PROFILE_ID,
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

    return this.profileRepo.save(seedProfile)
  }

  async listProfiles(): Promise<RentalFlowProfile[]> {
    return this.profileRepo.find({
      order: { createdAt: 'DESC' },
    })
  }

  async getProfile(profileId: string): Promise<{
    draft: RentalFlowProfile | null
    publishedVersions: RentalFlowProfile[]
  }> {
    const [draft, publishedVersions] = await Promise.all([
      this.profileRepo.findOne({
        where: { profileId, status: 'draft' },
      }),
      this.profileRepo.find({
        where: { profileId, status: 'published' },
        order: { version: 'DESC' },
      }),
    ])

    if (!draft && publishedVersions.length === 0) {
      throw new NotFoundException(`Không tìm thấy profile có mã [${profileId}]`)
    }

    return { draft, publishedVersions }
  }

  async getDraft(profileId: string): Promise<RentalFlowProfile> {
    let draft = await this.profileRepo.findOne({
      where: { profileId, status: 'draft' },
    })

    if (!draft) {
      // Nếu chưa có draft, lấy version published mới nhất để khởi tạo draft
      const latestPublished = await this.profileRepo.findOne({
        where: { profileId, status: 'published' },
        order: { version: 'DESC' },
      })

      if (!latestPublished) {
        throw new NotFoundException(
          `Không tìm thấy profile có mã [${profileId}]`
        )
      }

      draft = this.profileRepo.create({
        profileId,
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

      await this.profileRepo.save(draft)
    }

    return draft
  }

  async saveDraft(
    profileId: string,
    dto: SaveFlowProfileDraftDto,
    actorId: string
  ): Promise<RentalFlowProfile> {
    validateFlowProfileSteps(dto.steps)

    let draft = await this.profileRepo.findOne({
      where: { profileId, status: 'draft' },
    })

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
      draft = this.profileRepo.create({
        profileId,
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
    }

    const saved = await this.profileRepo.save(draft)

    await this.auditRepo.save(
      this.auditRepo.create({
        action: 'DRAFT_SAVED',
        actorId,
        targetType: 'profile',
        targetId: profileId,
        version: null,
        details: {
          draftRevision: saved.draftRevision,
          classification: saved.changeClassification,
        },
      })
    )

    return saved
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
  ): Promise<RentalFlowProfile> {
    const draft = await this.getDraft(profileId)

    if (draft.draftRevision !== dto.expectedRevision) {
      throw new ConflictException(
        'FLOW_CONFIG_DRAFT_STALE: Phiên bản nháp đã thay đổi. Vui lòng tải lại trước khi xuất bản.'
      )
    }

    validateFlowProfileSteps(draft.steps)

    // Lấy số phiên bản published cao nhất hiện tại
    const latestPublished = await this.profileRepo.findOne({
      where: { profileId, status: 'published' },
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
      profileId,
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

    const savedPublished = await this.profileRepo.save(publishedRecord)

    // Cập nhật draftRevision của draft để sẵn sàng cho lần sửa tiếp theo
    draft.draftRevision += 1
    draft.updatedBy = actorId
    await this.profileRepo.save(draft)

    await this.auditRepo.save(
      this.auditRepo.create({
        action: 'PROFILE_PUBLISHED',
        actorId,
        targetType: 'profile',
        targetId: profileId,
        version: newVersion,
        details: {
          contentHash,
          classification: savedPublished.changeClassification,
        },
      })
    )

    this.logger.log(
      `Profile [${profileId}] v${newVersion} published successfully (hash: ${contentHash.slice(0, 12)}...)`
    )

    return savedPublished
  }

  async restoreVersionAsDraft(
    profileId: string,
    version: number,
    actorId: string
  ): Promise<RentalFlowProfile> {
    const targetVersion = await this.profileRepo.findOne({
      where: { profileId, status: 'published', version },
    })

    if (!targetVersion) {
      throw new NotFoundException(
        `Không tìm thấy phiên bản published [v${version}] của profile [${profileId}]`
      )
    }

    const draft = await this.getDraft(profileId)
    draft.name = targetVersion.name
    draft.description = targetVersion.description
    draft.changeClassification = targetVersion.changeClassification
    draft.steps = targetVersion.steps
    draft.draftRevision += 1
    draft.updatedBy = actorId

    const saved = await this.profileRepo.save(draft)

    await this.auditRepo.save(
      this.auditRepo.create({
        action: 'PROFILE_RESTORED',
        actorId,
        targetType: 'profile',
        targetId: profileId,
        version,
        details: {
          restoredFromVersion: version,
          newDraftRevision: saved.draftRevision,
        },
      })
    )

    return saved
  }

  async restoreVersion(
    profileId: string,
    version: number,
    actorId: string
  ): Promise<RentalFlowProfile> {
    return this.restoreVersionAsDraft(profileId, version, actorId)
  }

  async getPublishedProfile(
    profileId: string,
    version: number
  ): Promise<RentalFlowProfile | null> {
    return this.profileRepo.findOne({
      where: { profileId, status: 'published', version },
    })
  }
}
