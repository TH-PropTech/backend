import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import {
  LegalDocument,
  type TermsLegalDocument,
} from '../schemas/legal-document.schema'
import type {
  LegalTermsReviewStatus,
  LegalTermsSection,
} from '../schemas/legal-terms-document.schema'
import { LegalDocumentScope } from '../utils/legal-document.scope'
import { computeCanonicalTermsHash } from '../utils/legal-terms.canonical'
import { LegalSourcesService } from './legal-sources.service'
import { SaveDraftDto } from '../dto/save-draft.dto'
import { PublishTermsDto } from '../dto/publish-terms.dto'
import { RequestChangesDto, ReviewTransitionDto } from '../dto/review-terms.dto'
import {
  PublicLegalTermsResponse,
  AdminLegalTermsStateResponse,
  TermsReviewResultResponse,
} from '../dto/legal-terms-response.dto'

export const RENTAL_TERMS_KEY = 'rental-service-terms'

const DUPLICATE_KEY_CODE = 11000

/** Sai lệch đồng hồ cho phép khi đặt `effectiveFrom` trong quá khứ gần. */
const EFFECTIVE_FROM_SKEW_MS = 60_000
const EFFECTIVE_FROM_MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000

/** Cụm từ của seed v1 cũ (nền tảng từng mô tả ký quỹ tiền cọc, nay đã bỏ). */
const STALE_ESCROW_PHRASE = 'hệ thống ký quỹ'

/** Vi phạm `legal_documents_terms_key_version_published_unique` (migration 032). */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY_CODE
  )
}

/** Bỏ trường `undefined` (Mongo `$set` sẽ ghi null) khỏi điều khoản. */
function cleanSections(
  sections: ReadonlyArray<LegalTermsSection>
): LegalTermsSection[] {
  return sections.map(s => ({
    id: s.id,
    heading: s.heading,
    body: s.body,
    order: s.order,
    ...(s.sourceKeys ? { sourceKeys: [...s.sourceKeys] } : {}),
  }))
}

/** Trường duyệt cần xóa khi bản nháp quay về 'editing' do lưu mới. */
const CLEAR_REVIEW_FIELDS = {
  submittedBy: '',
  submittedAt: '',
  reviewedBy: '',
  reviewedAt: '',
  reviewNote: '',
}

/** Khớp trạng thái 'editing' kể cả bản nháp cũ chưa có `reviewStatus`. */
const EDITING_MATCH = { $in: ['editing', null] }

export const DEFAULT_RENTAL_TERMS_FIXTURE = {
  key: RENTAL_TERMS_KEY,
  title: 'Điều khoản Dịch vụ Thuê Căn hộ Chung cư',
  summary:
    'Quy định chi tiết về quy trình thuê căn hộ (ký hợp đồng điện tử trước, thanh toán tiền cọc sau), quyền và nghĩa vụ các bên, thủ tục đặt cọc, cơ chế giải quyết tranh chấp và xác thực tính toàn vẹn trên sổ cái Blockchain theo quy định của pháp luật Việt Nam.',
  sections: [
    {
      id: 'sec-legal-basis',
      heading: '1. Căn cứ pháp lý và phạm vi áp dụng',
      body: 'Hệ thống vận hành tuân thủ Luật Nhà ở 2023 (Luật số 27/2023/QH15), Luật Kinh doanh Bất động sản 2023 (Luật số 29/2023/QH15), Bộ luật Dân sự 2015 (Luật số 91/2015/QH13) và Luật Giao dịch điện tử 2023. Quy chế này điều chỉnh mọi giao dịch tìm kiếm, đặt lịch, nộp hồ sơ thuê, ký hợp đồng điện tử và thanh toán tiền thuê căn hộ trên nền tảng TH-PropTech.',
      order: 1,
    },
    {
      id: 'sec-deposit-rules',
      heading: '2. Quy định đặt cọc và bảo đảm thực hiện hợp đồng',
      body: 'Tiền đặt cọc được thỏa thuận tự nguyện theo Điều 328 Bộ luật Dân sự 2015. Bên nhận cọc từ chối thực hiện hợp đồng phải trả lại cọc và khoản tiền tương đương giá trị cọc theo luật định. Các bên ký hợp đồng thuê điện tử trước; sau khi cả hai bên đã ký, Khách thuê thanh toán tiền cọc. Tiền cọc được chuyển trực tiếp cho Bên cho thuê qua ví nhận tiền đã liên kết; nền tảng TH-PropTech không giữ hộ tiền cọc. Hợp đồng thuê có hiệu lực khi cả hai bên đã ký và tiền cọc đã được thanh toán.',
      order: 2,
    },
    {
      id: 'sec-rights-obligations',
      heading: '3. Quyền và nghĩa vụ của Khách thuê và Bên cho thuê',
      body: 'Khách thuê có quyền nhận bàn giao căn hộ đúng hiện trạng cam kết, đăng ký cư trú theo quy định pháp luật và tiếp tục thực hiện hợp đồng khi căn hộ chuyển nhượng quyền sở hữu (Điều 173 Luật Nhà ở 2023). Khách thuê có nghĩa vụ thanh toán tiền thuê đúng chu kỳ, sử dụng căn hộ đúng mục đích để ở và bồi thường thiệt hại nếu làm hư hỏng trang thiết bị.',
      order: 3,
    },
    {
      id: 'sec-blockchain-verification',
      heading: '4. Xác thực điện tử và ghi nhận sổ cái Hyperledger Fabric',
      body: 'Để bảo đảm tính toàn vẹn và chống chối bỏ, các sự kiện quan trọng gồm văn bản hợp đồng hoàn tất ký số và xác nhận thanh toán tiền cọc sẽ được trích xuất mã băm mật mã học (SHA-256) và ghi nhận bất biến lên sổ cái Hyperledger Fabric. Khách hàng và cơ quan chức năng có thể tra cứu mã băm đối soát bất cứ lúc nào qua cổng thông tin xác minh của hệ thống.',
      order: 4,
    },
    {
      id: 'sec-public-service-guide',
      heading:
        '5. Hướng dẫn đăng ký tạm trú trên Cổng Dịch vụ công (TTHC 1.004194)',
      body: 'Sau khi hợp đồng thuê có hiệu lực, khách thuê có thể sử dụng bản sao hợp đồng đã khóa nội dung cùng chứng cứ ký điện tử trên hệ thống để thực hiện thủ tục Đăng ký tạm trú / Thường trú trực tuyến trên Cổng Dịch vụ công Quốc gia hoặc ứng dụng VNeID theo quy định của Luật Cư trú.',
      order: 5,
    },
  ],
}

@Injectable()
export class LegalTermsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LegalTermsService.name)

  /** Điều khoản (kind='terms'): facade lọc và gắn kind (G-LEG). */
  private readonly repository: LegalDocumentScope<TermsLegalDocument>

  constructor(
    @InjectRepository(LegalDocument)
    documents: Repository<LegalDocument>,
    private readonly legalSourcesService: LegalSourcesService,
    @Optional() private readonly configService?: ConfigService
  ) {
    this.repository = new LegalDocumentScope<TermsLegalDocument>(
      documents,
      'terms'
    )
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.seedInitialTermsIfEmpty()
    await this.reconcileStaleSeedTerms()
  }

  private get allowSelfApproval(): boolean {
    return (
      this.configService?.get<boolean>('legalTerms.allowSelfApproval') === true
    )
  }

  /**
   * Seed default version 1 published terms if no terms exist
   */
  async seedInitialTermsIfEmpty(): Promise<void> {
    const existingPublished = await this.repository.findOne({
      where: { key: RENTAL_TERMS_KEY, status: 'published' },
    })

    if (!existingPublished) {
      const version = 1
      const contentHash = computeCanonicalTermsHash({
        key: DEFAULT_RENTAL_TERMS_FIXTURE.key,
        version,
        title: DEFAULT_RENTAL_TERMS_FIXTURE.title,
        summary: DEFAULT_RENTAL_TERMS_FIXTURE.summary,
        sections: DEFAULT_RENTAL_TERMS_FIXTURE.sections,
      })

      const doc = this.repository.create()
      doc.key = DEFAULT_RENTAL_TERMS_FIXTURE.key
      doc.version = version
      doc.title = DEFAULT_RENTAL_TERMS_FIXTURE.title
      doc.summary = DEFAULT_RENTAL_TERMS_FIXTURE.summary
      doc.sections = DEFAULT_RENTAL_TERMS_FIXTURE.sections
      doc.contentHash = contentHash
      doc.status = 'published'
      doc.draftRevision = 1
      doc.createdBy = 'system'
      doc.publishedBy = 'system'
      doc.publishedAt = new Date()

      try {
        await this.repository.save(doc)
      } catch (error) {
        // Backend khác dùng chung DB vừa seed cùng version: coi như đã có.
        if (!isDuplicateKeyError(error)) throw error
        this.logger.warn(`Legal terms v${version} already seeded concurrently`)
        return
      }
      this.logger.log(`Seeded canonical published legal terms v${version}`)
    }
  }

  /**
   * DB cũ giữ v1 (bất biến) còn mô tả ký quỹ: tạo MỘT bản nháp đã sửa để admin
   * chỉ cần duyệt và công bố. Không đụng bản đã công bố; idempotent.
   */
  async reconcileStaleSeedTerms(): Promise<void> {
    const draft = await this.repository.findOne({
      where: { key: RENTAL_TERMS_KEY, status: 'draft' },
    })
    if (draft) return

    const [latest] = await this.listPublished()
    if (!latest || latest.publishedBy !== 'system') return
    const stale = (latest.sections ?? []).some(s =>
      s.body.includes(STALE_ESCROW_PHRASE)
    )
    if (!stale) return

    const doc = this.repository.create()
    doc.key = RENTAL_TERMS_KEY
    doc.version = 0
    doc.title = DEFAULT_RENTAL_TERMS_FIXTURE.title
    doc.summary = DEFAULT_RENTAL_TERMS_FIXTURE.summary
    doc.sections = cleanSections(DEFAULT_RENTAL_TERMS_FIXTURE.sections)
    doc.contentHash = ''
    doc.status = 'draft'
    doc.draftRevision = 1
    doc.reviewStatus = 'editing'
    doc.createdBy = 'system'
    doc.updatedBy = 'system'
    await this.repository.save(doc)
    this.logger.log(
      `Created corrected draft of legal terms (published v${latest.version} still mentions escrow); awaiting admin review`
    )
  }

  /** Mọi bản đã công bố, version cao nhất trước. */
  private listPublished(): Promise<TermsLegalDocument[]> {
    return this.repository.find({
      where: { key: RENTAL_TERMS_KEY, status: 'published' },
      order: { version: 'DESC' },
    })
  }

  /** Bản có hiệu lực: `effectiveFrom` vắng/null (legacy) hoặc đã tới hạn. */
  private static isEffective(doc: TermsLegalDocument, now: Date): boolean {
    return !doc.effectiveFrom || doc.effectiveFrom.getTime() <= now.getTime()
  }

  /**
   * Get active published terms (highest version already in effect)
   */
  async getCurrentPublishedTerms(): Promise<PublicLegalTermsResponse> {
    const now = new Date()
    const doc = (await this.listPublished()).find(d =>
      LegalTermsService.isEffective(d, now)
    )

    if (!doc) {
      throw new NotFoundException(
        'Chưa có điều khoản dịch vụ nào được công bố.'
      )
    }

    return this.toPublicResponse(doc)
  }

  /**
   * Get specific historical published version (kể cả bản đã lên lịch)
   */
  async getPublishedVersion(
    version: number
  ): Promise<PublicLegalTermsResponse> {
    const doc = await this.repository.findOne({
      where: { key: RENTAL_TERMS_KEY, version, status: 'published' },
    })

    if (!doc) {
      throw new NotFoundException(
        `Không tìm thấy phiên bản điều khoản dịch vụ v${version}.`
      )
    }

    return this.toPublicResponse(doc)
  }

  /**
   * Admin: Get current state (effective + scheduled + draft)
   */
  async getAdminState(): Promise<AdminLegalTermsStateResponse> {
    const now = new Date()
    const published = await this.listPublished()
    const current = published.find(d => LegalTermsService.isEffective(d, now))
    const scheduled = published.find(
      d => !LegalTermsService.isEffective(d, now)
    )

    const draft = await this.repository.findOne({
      where: { key: RENTAL_TERMS_KEY, status: 'draft' },
    })

    return {
      published: current ? this.toPublicResponse(current) : null,
      scheduled: scheduled ? this.toPublicResponse(scheduled) : null,
      draft: draft
        ? {
            key: draft.key,
            title: draft.title,
            summary: draft.summary,
            sections: draft.sections,
            draftRevision: draft.draftRevision,
            updatedBy: draft.updatedBy,
            updatedAt: draft.updatedAt,
            reviewStatus: draft.reviewStatus ?? 'editing',
            submittedBy: draft.submittedBy,
            submittedAt: draft.submittedAt,
            reviewedBy: draft.reviewedBy,
            reviewedAt: draft.reviewedAt,
            reviewNote: draft.reviewNote,
          }
        : null,
    }
  }

  /**
   * Admin: Save draft with optimistic concurrency check. Mọi lần lưu đưa
   * bản nháp về 'editing' và xóa dấu vết gửi duyệt/duyệt.
   */
  async saveDraft(
    dto: SaveDraftDto,
    actorId: string
  ): Promise<TermsLegalDocument> {
    await this.assertSourceKeysExist(dto.sections)
    const sections = cleanSections(dto.sections)

    const draft = await this.repository.findOne({
      where: { key: RENTAL_TERMS_KEY, status: 'draft' },
    })

    if (draft) {
      if (draft.draftRevision !== dto.expectedRevision) {
        throw new ConflictException('TERMS_DRAFT_STALE')
      }
      const nextRevision = draft.draftRevision + 1
      const updatedAt = new Date()
      const matched = await this.repository.updateAtomic(
        {
          _id: draft._id,
          status: 'draft',
          draftRevision: dto.expectedRevision,
        },
        {
          $set: {
            title: dto.title,
            summary: dto.summary,
            sections,
            draftRevision: nextRevision,
            updatedBy: actorId,
            updatedAt,
            reviewStatus: 'editing',
          },
          $unset: CLEAR_REVIEW_FIELDS,
        }
      )
      if (!matched) throw new ConflictException('TERMS_DRAFT_STALE')

      Object.assign(draft, {
        title: dto.title,
        summary: dto.summary,
        sections,
        draftRevision: nextRevision,
        updatedBy: actorId,
        updatedAt,
        reviewStatus: 'editing' as const,
      })
      for (const field of Object.keys(CLEAR_REVIEW_FIELDS)) {
        delete (draft as unknown as Record<string, unknown>)[field]
      }
      return draft
    }

    const created = this.repository.create()
    created.key = RENTAL_TERMS_KEY
    created.version = 0
    created.title = dto.title
    created.summary = dto.summary
    created.sections = sections
    created.contentHash = ''
    created.status = 'draft'
    created.draftRevision = 1
    created.reviewStatus = 'editing'
    created.createdBy = actorId
    created.updatedBy = actorId
    return this.repository.save(created)
  }

  /** Mỗi `sourceKeys` gắn vào điều khoản phải trỏ tới Nguồn pháp lý đang có. */
  private async assertSourceKeysExist(
    sections: SaveDraftDto['sections']
  ): Promise<void> {
    const requested = [...new Set(sections.flatMap(s => s.sourceKeys ?? []))]
    if (!requested.length) return
    const existing = new Set(
      await this.legalSourcesService.findExistingKeys(requested)
    )
    const unknown = requested.filter(key => !existing.has(key))
    if (unknown.length) {
      throw new BadRequestException(
        `UNKNOWN_LEGAL_SOURCE_KEYS: ${unknown.join(', ')}`
      )
    }
  }

  /**
   * Nạp bản nháp và kiểm revision + trạng thái duyệt kỳ vọng.
   * 404 không có nháp; 409 STALE sai revision; 409 INVALID_REVIEW_STATE sai trạng thái.
   */
  private async loadDraftForTransition(
    expectedRevision: number,
    expected: LegalTermsReviewStatus
  ): Promise<TermsLegalDocument> {
    const draft = await this.repository.findOne({
      where: { key: RENTAL_TERMS_KEY, status: 'draft' },
    })
    if (!draft) {
      throw new NotFoundException('Không tìm thấy bản nháp điều khoản.')
    }
    if (draft.draftRevision !== expectedRevision) {
      throw new ConflictException('TERMS_DRAFT_STALE')
    }
    if ((draft.reviewStatus ?? 'editing') !== expected) {
      throw new ConflictException('TERMS_INVALID_REVIEW_STATE')
    }
    return draft
  }

  /** Chuyển trạng thái bằng cập nhật có điều kiện (status + revision + trạng thái duyệt). */
  private async transition(
    draft: TermsLegalDocument,
    from: LegalTermsReviewStatus,
    set: Record<string, unknown>,
    unset: Record<string, ''> = {}
  ): Promise<TermsReviewResultResponse> {
    const matched = await this.repository.updateAtomic(
      {
        _id: draft._id,
        status: 'draft',
        draftRevision: draft.draftRevision,
        reviewStatus: from === 'editing' ? EDITING_MATCH : from,
      },
      {
        $set: set,
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      }
    )
    // Có người lưu/chuyển trạng thái xen vào giữa lúc đọc và ghi.
    if (!matched) throw new ConflictException('TERMS_DRAFT_STALE')
    return {
      success: true,
      draftRevision: draft.draftRevision,
      reviewStatus: set['reviewStatus'] as LegalTermsReviewStatus,
    }
  }

  /** Admin: gửi bản nháp đi duyệt (editing -> in_review). */
  async submitForReview(
    dto: ReviewTransitionDto,
    actorId: string
  ): Promise<TermsReviewResultResponse> {
    const draft = await this.loadDraftForTransition(
      dto.expectedRevision,
      'editing'
    )
    return this.transition(
      draft,
      'editing',
      {
        reviewStatus: 'in_review',
        submittedBy: actorId,
        submittedAt: new Date(),
      },
      { reviewedBy: '', reviewedAt: '', reviewNote: '' }
    )
  }

  /** Admin: duyệt (in_review -> approved); người duyệt khác người sửa cuối trừ khi bật cờ. */
  async approveDraft(
    dto: ReviewTransitionDto,
    actorId: string
  ): Promise<TermsReviewResultResponse> {
    const draft = await this.loadDraftForTransition(
      dto.expectedRevision,
      'in_review'
    )
    const lastEditor = draft.updatedBy ?? draft.createdBy
    if (!this.allowSelfApproval && lastEditor === actorId) {
      throw new ForbiddenException('TERMS_SELF_APPROVAL_FORBIDDEN')
    }
    return this.transition(draft, 'in_review', {
      reviewStatus: 'approved',
      reviewedBy: actorId,
      reviewedAt: new Date(),
    })
  }

  /** Admin: trả về sửa (in_review -> editing) kèm ghi chú. */
  async requestChanges(
    dto: RequestChangesDto,
    actorId: string
  ): Promise<TermsReviewResultResponse> {
    const draft = await this.loadDraftForTransition(
      dto.expectedRevision,
      'in_review'
    )
    return this.transition(draft, 'in_review', {
      reviewStatus: 'editing',
      reviewNote: dto.note.trim(),
      reviewedBy: actorId,
      reviewedAt: new Date(),
    })
  }

  /** Kiểm `effectiveFrom`: parse được, không sớm hơn now-1 phút, không quá 1 năm. */
  private parseEffectiveFrom(raw: string | undefined): Date | undefined {
    if (raw === undefined) return undefined
    const date = new Date(raw)
    const time = date.getTime()
    const now = Date.now()
    if (
      Number.isNaN(time) ||
      time < now - EFFECTIVE_FROM_SKEW_MS ||
      time > now + EFFECTIVE_FROM_MAX_AHEAD_MS
    ) {
      throw new BadRequestException('TERMS_EFFECTIVE_FROM_INVALID')
    }
    return date
  }

  /**
   * Admin: Publish draft as a new immutable version
   */
  async publishDraft(
    dto: PublishTermsDto,
    actorId: string
  ): Promise<PublicLegalTermsResponse> {
    const effectiveFrom = this.parseEffectiveFrom(dto.effectiveFrom)

    const draft = await this.repository.findOne({
      where: { key: RENTAL_TERMS_KEY, status: 'draft' },
    })

    if (!draft) {
      throw new NotFoundException(
        'Không tìm thấy bản nháp điều khoản để xuất bản.'
      )
    }

    if (draft.draftRevision !== dto.expectedRevision) {
      throw new ConflictException('TERMS_DRAFT_STALE')
    }

    if (draft.reviewStatus !== 'approved') {
      throw new ConflictException('TERMS_NOT_APPROVED')
    }

    const [latestPublished] = await this.listPublished()

    // Có thể còn bản đang lên lịch: số version cao hơn thắng khi tới hạn hiệu lực.
    const nextVersion = (latestPublished?.version ?? 0) + 1
    const contentHash = computeCanonicalTermsHash({
      key: RENTAL_TERMS_KEY,
      version: nextVersion,
      title: draft.title,
      summary: draft.summary,
      sections: draft.sections,
    })

    const newPublished = this.repository.create()
    newPublished.key = RENTAL_TERMS_KEY
    newPublished.version = nextVersion
    newPublished.title = draft.title
    newPublished.summary = draft.summary
    newPublished.sections = draft.sections
    newPublished.contentHash = contentHash
    newPublished.status = 'published'
    newPublished.draftRevision = 1
    newPublished.createdBy = draft.createdBy || actorId
    newPublished.publishedBy = actorId
    newPublished.publishedAt = new Date()
    if (effectiveFrom) newPublished.effectiveFrom = effectiveFrom

    let saved: TermsLegalDocument
    try {
      saved = await this.repository.save(newPublished)
    } catch (error) {
      // Lần publish đồng thời đã chiếm version này; giữ bản nháp để thử lại.
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('TERMS_VERSION_CONFLICT')
      }
      throw error
    }

    // Reset or delete draft so a new draft cycle begins
    await this.repository.remove(draft)

    return this.toPublicResponse(saved)
  }

  private toPublicResponse(doc: TermsLegalDocument): PublicLegalTermsResponse {
    return {
      key: doc.key,
      version: doc.version,
      title: doc.title,
      summary: doc.summary,
      sections: doc.sections || [],
      contentHash: doc.contentHash,
      publishedAt: doc.publishedAt || null,
      effectiveFrom: doc.effectiveFrom ?? null,
    }
  }
}
