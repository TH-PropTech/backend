import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  OnApplicationBootstrap,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { LegalTermsDocument } from './schemas/legal-terms-document.schema'
import { computeCanonicalTermsHash } from './legal-terms.canonical'
import { SaveDraftDto } from './dto/save-draft.dto'
import { PublishTermsDto } from './dto/publish-terms.dto'
import {
  PublicLegalTermsResponse,
  AdminLegalTermsStateResponse,
} from './dto/legal-terms-response.dto'

export const RENTAL_TERMS_KEY = 'rental-service-terms'

const DEFAULT_RENTAL_TERMS_FIXTURE = {
  key: RENTAL_TERMS_KEY,
  title: 'Điều khoản Dịch vụ Thuê Căn hộ Chung cư',
  summary:
    'Quy định chi tiết về quy trình thuê căn hộ, quyền và nghĩa vụ các bên, thủ tục đặt cọc, cơ chế giải quyết tranh chấp và xác thực tính toàn vẹn trên sổ cái Blockchain theo quy định của pháp luật Việt Nam.',
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
      body: 'Tiền đặt cọc được thỏa thuận tự nguyện theo Điều 328 Bộ luật Dân sự 2015. Bên nhận cọc từ chối thực hiện hợp đồng phải trả lại cọc và khoản tiền tương đương giá trị cọc theo luật định. Tiền cọc được giữ an toàn trên tài khoản chỉ định hoặc hệ thống ký quỹ cho đến khi hợp đồng thuê chính thức có hiệu lực và được các bên nghiệm thu bàn giao căn hộ.',
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
      body: 'Để bảo đảm tính toàn vẹn và chống chối bỏ, các sự kiện quan trọng gồm thỏa thuận cọc và văn bản hợp đồng hoàn tất ký số sẽ được trích xuất mã băm mật mã học (SHA-256) và ghi nhận bất biến lên sổ cái Hyperledger Fabric. Khách hàng và cơ quan chức năng có thể tra cứu mã băm đối soát bất cứ lúc nào qua cổng thông tin xác minh của hệ thống.',
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

  constructor(
    @InjectRepository(LegalTermsDocument)
    private readonly repository: Repository<LegalTermsDocument>
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedInitialTermsIfEmpty()
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

      const doc = new LegalTermsDocument()
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

      await this.repository.save(doc)
      this.logger.log(`Seeded canonical published legal terms v${version}`)
    }
  }

  /**
   * Get active published terms (latest version)
   */
  async getCurrentPublishedTerms(): Promise<PublicLegalTermsResponse> {
    const doc = await this.repository.findOne({
      where: { key: RENTAL_TERMS_KEY, status: 'published' },
      order: { version: 'DESC' },
    })

    if (!doc) {
      throw new NotFoundException(
        'Chưa có điều khoản dịch vụ nào được công bố.'
      )
    }

    return this.toPublicResponse(doc)
  }

  /**
   * Get specific historical published version
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
   * Admin: Get current state (published + draft)
   */
  async getAdminState(): Promise<AdminLegalTermsStateResponse> {
    const published = await this.repository.findOne({
      where: { key: RENTAL_TERMS_KEY, status: 'published' },
      order: { version: 'DESC' },
    })

    const draft = await this.repository.findOne({
      where: { key: RENTAL_TERMS_KEY, status: 'draft' },
    })

    return {
      published: published ? this.toPublicResponse(published) : null,
      draft: draft
        ? {
            key: draft.key,
            title: draft.title,
            summary: draft.summary,
            sections: draft.sections,
            draftRevision: draft.draftRevision,
            updatedBy: draft.updatedBy,
            updatedAt: draft.updatedAt,
          }
        : null,
    }
  }

  /**
   * Admin: Save draft with optimistic concurrency check
   */
  async saveDraft(
    dto: SaveDraftDto,
    actorId: string
  ): Promise<LegalTermsDocument> {
    let draft = await this.repository.findOne({
      where: { key: RENTAL_TERMS_KEY, status: 'draft' },
    })

    if (draft) {
      if (draft.draftRevision !== dto.expectedRevision) {
        throw new ConflictException('TERMS_DRAFT_STALE')
      }
      draft.title = dto.title
      draft.summary = dto.summary
      draft.sections = dto.sections
      draft.draftRevision += 1
      draft.updatedBy = actorId
    } else {
      draft = new LegalTermsDocument()
      draft.key = RENTAL_TERMS_KEY
      draft.version = 0
      draft.title = dto.title
      draft.summary = dto.summary
      draft.sections = dto.sections
      draft.contentHash = ''
      draft.status = 'draft'
      draft.draftRevision = 1
      draft.createdBy = actorId
      draft.updatedBy = actorId
    }

    return this.repository.save(draft)
  }

  /**
   * Admin: Publish draft as a new immutable version
   */
  async publishDraft(
    dto: PublishTermsDto,
    actorId: string
  ): Promise<PublicLegalTermsResponse> {
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

    const latestPublished = await this.repository.findOne({
      where: { key: RENTAL_TERMS_KEY, status: 'published' },
      order: { version: 'DESC' },
    })

    const nextVersion = (latestPublished?.version ?? 0) + 1
    const contentHash = computeCanonicalTermsHash({
      key: RENTAL_TERMS_KEY,
      version: nextVersion,
      title: draft.title,
      summary: draft.summary,
      sections: draft.sections,
    })

    const newPublished = new LegalTermsDocument()
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

    const saved = await this.repository.save(newPublished)

    // Reset or delete draft so a new draft cycle begins
    await this.repository.remove(draft)

    return this.toPublicResponse(saved)
  }

  private toPublicResponse(doc: LegalTermsDocument): PublicLegalTermsResponse {
    return {
      key: doc.key,
      version: doc.version,
      title: doc.title,
      summary: doc.summary,
      sections: doc.sections || [],
      contentHash: doc.contentHash,
      publishedAt: doc.publishedAt || null,
    }
  }
}
