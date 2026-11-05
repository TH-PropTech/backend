import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ConfigAuditService } from '../../activity-log/services/config-audit.service'
import { RentalFlowConfig } from '../schemas/rental-flow-config.schema'
import type {
  PublishHandoverTemplateDto,
  SaveHandoverTemplateDraftDto,
} from '../dto/handover-template.dto'
import {
  computeHandoverTemplateHash,
  DEFAULT_HANDOVER_TEMPLATE,
  MOVE_IN_HANDOVER_TEMPLATE_KEY,
  normalizeHandoverTemplateContent,
  type HandoverTemplateContent,
  type HandoverTemplateView,
} from '../utils/handover-template.util'

const TEMPLATE_NAME = 'Mẫu biên bản bàn giao khi vào ở'
const TEMPLATE_DESCRIPTION =
  'Danh mục đồ nạp sẵn và các mục kiểm tra cho bước Nhận nhà.'

function toView(row: RentalFlowConfig): HandoverTemplateView {
  const content = row.handoverTemplate ?? DEFAULT_HANDOVER_TEMPLATE
  return {
    key: row.key,
    status: row.status,
    version: row.version,
    draftRevision: row.draftRevision,
    contentHash: row.contentHash,
    publishedAt: row.publishedAt ?? null,
    inventoryDefaults: content.inventoryDefaults,
    checklist: content.checklist,
  }
}

@Injectable()
export class HandoverTemplateService implements OnModuleInit {
  constructor(
    @InjectRepository(RentalFlowConfig)
    private readonly repo: Repository<RentalFlowConfig>,
    private readonly configAudit: ConfigAuditService
  ) {}

  /** Seed bản mặc định (v1) để bước Nhận nhà luôn có mẫu khi admin chưa soạn. */
  async onModuleInit(): Promise<void> {
    if (await this.latestPublishedRow()) return
    await this.repo.save(
      this.repo.create({
        kind: 'handover-template',
        key: MOVE_IN_HANDOVER_TEMPLATE_KEY,
        version: 1,
        status: 'published',
        name: TEMPLATE_NAME,
        description: TEMPLATE_DESCRIPTION,
        handoverTemplate: DEFAULT_HANDOVER_TEMPLATE,
        contentHash: computeHandoverTemplateHash(DEFAULT_HANDOVER_TEMPLATE, 1),
        draftRevision: 1,
        createdBy: 'system',
        publishedBy: 'system',
        publishedAt: new Date(),
      })
    )
  }

  async getPublished(): Promise<HandoverTemplateView | null> {
    const row = await this.latestPublishedRow()
    return row ? toView(row) : null
  }

  async getAdminState(): Promise<{
    published: HandoverTemplateView | null
    draft: HandoverTemplateView | null
  }> {
    const [published, draft] = await Promise.all([
      this.latestPublishedRow(),
      this.draftRow(),
    ])
    return {
      published: published ? toView(published) : null,
      draft: draft ? toView(draft) : null,
    }
  }

  async saveDraft(
    dto: SaveHandoverTemplateDraftDto,
    actorId: string
  ): Promise<HandoverTemplateView> {
    const content = normalizeHandoverTemplateContent(dto)
    const existing = await this.draftRow()
    let draft: RentalFlowConfig
    if (existing) {
      if (existing.draftRevision !== dto.expectedRevision) {
        throw new ConflictException('HANDOVER_TEMPLATE_REVISION_STALE')
      }
      existing.handoverTemplate = content
      existing.draftRevision += 1
      existing.updatedBy = actorId
      draft = existing
    } else {
      draft = this.repo.create({
        kind: 'handover-template',
        key: MOVE_IN_HANDOVER_TEMPLATE_KEY,
        version: null,
        status: 'draft',
        name: TEMPLATE_NAME,
        description: TEMPLATE_DESCRIPTION,
        handoverTemplate: content,
        contentHash: null,
        draftRevision: 1,
        createdBy: actorId,
        updatedBy: actorId,
      })
    }
    const saved = await this.repo.save(draft)
    await this.configAudit.append({
      scope: 'rental-flow',
      action: 'HANDOVER_TEMPLATE_DRAFT_SAVED',
      actorId,
      targetType: 'handover-template',
      key: MOVE_IN_HANDOVER_TEMPLATE_KEY,
      version: null,
      details: { draftRevision: saved.draftRevision },
    })
    return toView(saved)
  }

  async publish(
    dto: PublishHandoverTemplateDto,
    actorId: string
  ): Promise<HandoverTemplateView> {
    const draft = await this.draftRow()
    if (!draft) throw new NotFoundException('HANDOVER_TEMPLATE_DRAFT_NOT_FOUND')
    if (draft.draftRevision !== dto.expectedRevision) {
      throw new ConflictException('HANDOVER_TEMPLATE_REVISION_STALE')
    }
    const content: HandoverTemplateContent =
      draft.handoverTemplate ?? DEFAULT_HANDOVER_TEMPLATE
    const latest = await this.latestPublishedRow()
    const version = (latest?.version ?? 0) + 1
    const contentHash = computeHandoverTemplateHash(content, version)
    const published = await this.repo.save(
      this.repo.create({
        kind: 'handover-template',
        key: MOVE_IN_HANDOVER_TEMPLATE_KEY,
        version,
        status: 'published',
        name: TEMPLATE_NAME,
        description: TEMPLATE_DESCRIPTION,
        handoverTemplate: content,
        contentHash,
        draftRevision: draft.draftRevision,
        createdBy: draft.createdBy ?? actorId,
        publishedBy: actorId,
        publishedAt: new Date(),
      })
    )
    // Bản đã phát hành là bất biến; nháp được xóa để lần sửa sau bắt đầu từ bản mới nhất.
    await this.repo.remove(draft)
    await this.configAudit.append({
      scope: 'rental-flow',
      action: 'HANDOVER_TEMPLATE_PUBLISHED',
      actorId,
      targetType: 'handover-template',
      key: MOVE_IN_HANDOVER_TEMPLATE_KEY,
      version,
      details: { reason: dto.reason, contentHash },
    })
    return toView(published)
  }

  private latestPublishedRow(): Promise<RentalFlowConfig | null> {
    return this.repo.findOne({
      where: {
        kind: 'handover-template',
        key: MOVE_IN_HANDOVER_TEMPLATE_KEY,
        status: 'published',
      },
      order: { version: 'DESC' },
    })
  }

  private draftRow(): Promise<RentalFlowConfig | null> {
    return this.repo.findOne({
      where: {
        kind: 'handover-template',
        key: MOVE_IN_HANDOVER_TEMPLATE_KEY,
        status: 'draft',
      },
    })
  }
}
