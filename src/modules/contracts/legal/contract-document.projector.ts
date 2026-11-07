import { createHash } from 'crypto'
import { vndInWords } from './vnd-in-words'
import {
  LATE_PAYMENT_AGREED_INTEREST_BASIS,
  TERMINATION_NOTICE_BASIS,
  WRONGFUL_TERMINATION_DEPOSIT_BASIS,
} from '../../legal/utils/legal-citations'
import {
  DEFAULT_MOVE_OUT_RESPONSE_DAYS,
  DEPOSIT_REFUND_DUE_TEXT,
} from '../../rental/utils/deposit-refund.constants'
import type { Contract } from '../schemas/contract.schema'
import { resolveEffectiveCommercial } from '../commercial/resolve-effective-commercial'
import { resolveLatePenaltyRate } from '../commercial/resolve-late-penalty-rate'
import {
  CUSTOM_CLAUSES_ANNEX_ID,
  OCCUPANTS_ANNEX_ID,
  UTILITY_RATES_ANNEX_ID,
} from './lease-template.manifest'
import {
  validateDocumentManifest,
  LeaseDocumentManifest,
} from './lease-template.manifest'
import { resolveLegalProfile, LegalProfile } from './legal-profile.resolver'
import type { ContractTemplate } from '../schemas/contract-template.schema'
import type { ContractLayoutProfile } from '../schemas/contract-layout-profile.schema'
import {
  ContractDocumentSectionDto,
  ContractDocumentAnnexDto,
  ContractDocumentViewDto,
  ContractCanonicalArtifactDto,
} from '../dto/contract-view.dto'

export class ContractDocumentProjector {
  /**
   * Chiếu Contract entity thành structured document view DTO
   */
  static projectDocument(
    contract: Contract,
    template?: Pick<
      ContractTemplate,
      | 'legalProfile'
      | 'version'
      | 'templateKey'
      | 'schemaVersion'
      | 'contentHash'
      | 'clauses'
      | 'annexDefinitions'
      | 'citationIds'
    >,
    layout?: Pick<
      ContractLayoutProfile,
      'profileKey' | 'version' | 'blocks' | 'supplementaryClauses'
    >
  ): ContractDocumentViewDto {
    const isLocked = Boolean(
      contract.contentLockedHash && contract.contentLockedAt
    )
    const revision = contract.contentRevision ?? 1
    const configuredProfile = contract.flowProfileRef?.profileId
    const legalProfile: LegalProfile | null = template
      ? template.legalProfile
      : configuredProfile === 'REAL_ESTATE_BUSINESS_STANDARD' ||
          configuredProfile === 'PRIVATE_CIVIL_APARTMENT_LEASE'
        ? configuredProfile
        : resolveLegalProfile({
            landlordType: 'individual',
            operatesRealEstateBusiness: false,
            transactionType: 'civil',
          })

    const sections = template?.clauses.some(clause => clause.content)
      ? this.buildTemplateSections(contract, template)
      : this.buildStructuredSections(contract)
    const annexes = [
      ...(template?.annexDefinitions?.length
        ? this.buildTemplateAnnexes(template.annexDefinitions)
        : this.buildAnnexes()),
      ...this.buildCustomClausesAnnex(contract),
      ...this.buildOccupantsAnnex(contract),
      ...this.buildUtilityRatesAnnex(contract),
    ]

    // Validate manifest
    const manifest: LeaseDocumentManifest = {
      legalProfile: legalProfile ?? 'PRIVATE_CIVIL_APARTMENT_LEASE',
      articles: sections.map(s => ({
        number: s.number,
        heading: s.title,
        contentHash: s.hash,
        protected: s.protected,
      })),
      annexes: annexes.map(a => a.title),
      ...(template?.citationIds ? { citationIds: template.citationIds } : {}),
      ...(template?.schemaVersion !== undefined
        ? { schemaVersion: template.schemaVersion }
        : {}),
      ...(template?.contentHash ? { contentHash: template.contentHash } : {}),
    }

    const validation = validateDocumentManifest(manifest)

    let integrity: 'not-locked' | 'valid' | 'mismatch' | 'unavailable' =
      'not-locked'
    if (isLocked) {
      if (!validation.valid) {
        integrity = 'mismatch'
      } else {
        integrity = 'valid'
      }
    }

    const canonicalArtifact: ContractCanonicalArtifactDto | null =
      contract.artifactRef
        ? {
            artifactId: contract.artifactRef.artifactId,
            revision: contract.artifactRef.revision,
            templateKey: contract.artifactRef.templateKey,
            templateVersion: contract.artifactRef.templateVersion,
            artifactHash: contract.artifactRef.artifactHash,
            ...(contract.artifactRef.canonicalContentHash
              ? {
                  canonicalContentHash:
                    contract.artifactRef.canonicalContentHash,
                }
              : {}),
            ...(contract.artifactRef.rendererVersion
              ? { rendererVersion: contract.artifactRef.rendererVersion }
              : {}),
            ...(contract.artifactRef.sourceSchemaVersion
              ? {
                  sourceSchemaVersion: contract.artifactRef.sourceSchemaVersion,
                }
              : {}),
            ...(contract.artifactRef.byteLength
              ? { byteLength: contract.artifactRef.byteLength }
              : {}),
            ...(contract.artifactRef.amendmentId
              ? { amendmentId: contract.artifactRef.amendmentId }
              : {}),
            contentType: contract.artifactRef.contentType,
          }
        : null

    return {
      mode: isLocked ? 'locked' : 'draft',
      revision,
      lockedAt: contract.contentLockedAt
        ? contract.contentLockedAt.toISOString()
        : null,
      lockedHash: contract.contentLockedHash ?? null,
      contentHash: contract.contentLockedHash ?? null,
      citationIds: template?.citationIds ?? [],
      hashSchemaVersion:
        template?.schemaVersion ?? contract.hashSchemaVersion ?? 1,
      legalProfile,
      templateVersion: contract.artifactRef
        ? `${contract.artifactRef.templateKey}@${contract.artifactRef.templateVersion}`
        : template
          ? `${template.templateKey}@${template.version}`
          : contract.contractTemplateRef
            ? `${contract.contractTemplateRef.key}@${contract.contractTemplateRef.version}`
            : contract.termsRef
              ? `${contract.termsRef.key}@${contract.termsRef.version}`
              : '2026.1-VN-CIVIL',
      sections,
      annexes,
      canonicalArtifact,
      layout: layout
        ? {
            profileKey: layout.profileKey,
            version: layout.version,
            blocks: layout.blocks.map(block => ({
              blockId: block.blockId,
              order: block.order,
              title: block.title,
              visible: block.visible,
            })),
          }
        : null,
      supplementaryClauses: layout
        ? layout.supplementaryClauses.filter(clause => clause.enabled)
        : [],
      integrity,
    }
  }

  /** Lấy số ngày phản hồi từ snapshot gói của hợp đồng (không đọc lại tin đăng); gói cũ dùng mặc định. */
  private static resolveMoveOutResponseDays(contract: Contract): number {
    return (
      contract.packageSnapshot?.moveOutPolicy?.responseDays ??
      DEFAULT_MOVE_OUT_RESPONSE_DAYS
    )
  }

  private static buildTemplateSections(
    contract: Contract,
    template: Pick<ContractTemplate, 'clauses'>
  ): ContractDocumentSectionDto[] {
    const commercial = contract.commercialDraft ?? undefined
    const values: Record<string, string> = {
      property: contract.propertyTitle || 'Căn hộ chung cư',
      propertyAddress: contract.propertyAddress || 'Theo hồ sơ bất động sản',
      propertyArea: contract.propertyArea
        ? `${contract.propertyArea} m²`
        : 'Theo hồ sơ',
      propertyFurniture: contract.propertyFurniture || 'Theo biên bản bàn giao',
      startDate: this.formatTemplateDate(contract.startDate),
      endDate: this.formatTemplateDate(contract.endDate),
      durationMonths: String(
        commercial?.durationMonths ?? contract.durationMonths ?? 12
      ),
      monthlyRent: this.formatTemplateMoney(
        commercial?.monthlyRent ?? contract.monthlyRent
      ),
      deposit: this.formatTemplateMoney(
        commercial?.deposit ?? contract.deposit
      ),
      paymentDay: String(commercial?.paymentDay ?? contract.paymentDay),
      latePenaltyRate: String(
        resolveLatePenaltyRate(contract, {
          renderBranch: 'template',
          source: 'signed',
        })
      ),
      terminationNoticeDays: String(
        commercial?.terminationNoticeDays ?? contract.terminationNoticeDays
      ),
      moveOutResponseDays: String(this.resolveMoveOutResponseDays(contract)),
      landlord: contract.landlordName || 'Bên cho thuê',
      tenant: contract.tenantName || 'Bên thuê',
    }
    return template.clauses.map(clause => ({
      id: clause.id ?? `sec-${clause.number}`,
      number: clause.number,
      title: clause.heading,
      content: this.interpolateTemplate(
        clause.content ?? clause.heading,
        values
      ),
      protected: true,
      hash: clause.contentHash,
      citationIds: clause.citationIds,
    }))
  }

  private static buildOccupantsAnnex(
    contract: Contract
  ): ContractDocumentAnnexDto[] {
    const occupants = resolveEffectiveCommercial(contract).occupants
    if (!occupants?.length) return []
    const lines = occupants.map(
      (person, index) =>
        `${index + 1}. ${person.fullName}, sinh năm ${person.birthYear}, quan hệ với Bên B: ${person.relationship}.`
    )
    return [
      {
        id: OCCUPANTS_ANNEX_ID,
        title: 'Danh sách người ở cùng Bên B',
        description:
          `Ngoài Bên B, những người sau cùng sinh sống tại nhà ở thuê:\n${lines.join('\n')}\n` +
          'Việc thay đổi danh sách này sau khi ký được lập thành phụ lục hợp đồng có xác nhận của hai Bên.',
        required: false,
      },
    ]
  }

  private static buildUtilityRatesAnnex(
    contract: Contract
  ): ContractDocumentAnnexDto[] {
    const rates = resolveEffectiveCommercial(contract).utilityRates
    if (!rates) return []
    const vnd = (value: number): string =>
      `${value.toLocaleString('vi-VN')} đồng`
    const note = rates.note?.trim()
    return [
      {
        id: UTILITY_RATES_ANNEX_ID,
        title: 'Đơn giá điện, nước và phí dịch vụ',
        description:
          `Đơn giá do hai Bên thỏa thuận: điện ${vnd(rates.electricityPerKwh)}/kWh; nước ${vnd(rates.waterPerM3)}/m³; phí dịch vụ ${vnd(rates.serviceFeeMonthly)}/tháng.` +
          `${note ? ` Ghi chú: ${note}` : ''}\n` +
          'Tiền dịch vụ và tiền điện, nước được tính vào lúc bàn giao lại nhà khi hết hợp đồng, theo chỉ số công tơ ghi trong Biên bản nhận nhà và Biên bản trả nhà.',
        required: false,
      },
    ]
  }

  private static buildCustomClausesAnnex(
    contract: Contract
  ): ContractDocumentAnnexDto[] {
    const text = resolveEffectiveCommercial(contract).customClauses?.trim()
    if (!text) return []
    return [
      {
        id: CUSTOM_CLAUSES_ANNEX_ID,
        title: 'Điều khoản bổ sung do chủ nhà cung cấp',
        description:
          `${text}\n\n` +
          'Các điều khoản trên không thay thế hay sửa đổi 12 điều bắt buộc của hợp đồng; ' +
          'nếu có mâu thuẫn thì 12 điều bắt buộc được ưu tiên áp dụng.',
        required: false,
      },
    ]
  }

  private static buildTemplateAnnexes(
    definitions: NonNullable<ContractTemplate['annexDefinitions']>
  ): ContractDocumentAnnexDto[] {
    return definitions.map(definition => ({
      id: definition.id,
      title: definition.title,
      ...(definition.description
        ? { description: definition.description }
        : {}),
      required: definition.required,
    }))
  }

  private static interpolateTemplate(
    content: string,
    values: Record<string, string>
  ): string {
    return content.replace(
      /\{\{([a-zA-Z0-9_]+)\}\}/g,
      (_match, key: string) => values[key] ?? ''
    )
  }

  private static formatTemplateMoney(amount: number): string {
    const words = vndInWords(amount)
    const formatted = `${new Intl.NumberFormat('vi-VN').format(amount)} VNĐ`
    return words ? `${formatted} (bằng chữ: ${words})` : formatted
  }

  private static formatTemplateDate(value?: Date | string | null): string {
    if (!value) return 'Chưa xác định'
    const date = new Date(value)
    return Number.isNaN(date.getTime())
      ? 'Chưa xác định'
      : date.toLocaleDateString('vi-VN')
  }

  private static buildStructuredSections(
    contract: Contract
  ): ContractDocumentSectionDto[] {
    const formatVND = (amount: number): string =>
      `${new Intl.NumberFormat('vi-VN').format(amount)} VNĐ`

    const formatDate = (date?: Date | string | null): string => {
      if (!date) return 'Chưa xác định'
      const d = new Date(date)
      return isNaN(d.getTime())
        ? 'Chưa xác định'
        : d.toLocaleDateString('vi-VN')
    }

    const articlesContent = [
      {
        number: 1,
        title: 'Các thông tin về nhà ở cho thuê',
        content: `1. Loại nhà ở: Căn hộ chung cư cao tầng kết hợp dịch vụ thương mại (thuộc nhà chung cư theo quy định của Luật Nhà ở 2023).
2. Vị trí, địa điểm nhà ở: Căn hộ "${contract.propertyTitle || 'Căn hộ chung cư'}", thuộc tòa nhà chung cư tại địa chỉ: ${contract.propertyAddress || 'Theo hồ sơ bất động sản'}.
3. Hiện trạng về chất lượng nhà ở: Công trình bảo đảm an toàn kết cấu chịu lực, hệ thống điện chiếu sáng, hệ thống cấp thoát nước, thông gió và hệ thống phòng cháy chữa cháy (PCCC) vận hành ổn định, đạt tiêu chuẩn kỹ thuật hiện hành.
4. Diện tích của nhà ở:
  a) Tổng diện tích sàn xây dựng (diện tích tim tường): ${contract.propertyArea ? `${contract.propertyArea} m²` : 'Theo hồ sơ thiết kế'}.
  b) Tổng diện tích sử dụng riêng (diện tích thông thủy): ${contract.propertyArea ? `${contract.propertyArea} m²` : 'Theo thực tế bàn giao'}.
  c) Diện tích sử dụng chung: Bao gồm phần diện tích hành lang, thang máy, lối thoát hiểm, sảnh chung và các công trình tiện ích công cộng của tòa nhà chung cư theo quy định.
5. Công năng sử dụng: Sử dụng hoàn toàn vào mục đích để ở sinh hoạt hộ gia đình hợp pháp, đúng công năng thiết kế được cơ quan có thẩm quyền phê duyệt.
6. Trang thiết bị, tài sản kèm theo: ${contract.propertyFurniture || 'Toàn bộ trang thiết bị nội thất và vật dụng gắn liền căn hộ được liệt kê chi tiết trong Bảng kiểm kê trang thiết bị nội thất (Phụ lục 2) và Biên bản bàn giao hiện trạng (Phụ lục 1)'}.`,
        protected: true,
      },
      {
        number: 2,
        title: 'Giá thuê nhà ở và các chi phí liên quan',
        content: `1. Giá thuê nhà ở: Giá thuê căn hộ cố định là: ${formatVND(contract.monthlyRent || 0)}/tháng (chưa bao gồm thuế giá trị gia tăng nếu có).
2. Giá thuê quy định tại Khoản 1 Điều này chưa bao gồm: Chi phí dịch vụ quản lý vận hành nhà chung cư, chi phí sử dụng điện, nước sinh hoạt, dịch vụ truyền hình, internet, viễn thông và phí trông giữ phương tiện đi lại. Các chi phí này do Bên Thuê trực tiếp thanh toán cho ban quản lý tòa nhà hoặc các đơn vị cung cấp dịch vụ tương ứng theo chỉ số tiêu thụ thực tế và đơn giá quy định.
3. Cam kết ổn định giá thuê: Giá thuê nhà ở được giữ ổn định trong suốt toàn bộ thời hạn hợp đồng. Bên Cho Thuê cam kết không tự ý tăng giá thuê khi chưa có văn bản thỏa thuận và đồng thuận của Bên Thuê.`,
        protected: true,
      },
      {
        number: 3,
        title: 'Phương thức và thời hạn thanh toán',
        content: `1. Phương thức thanh toán: Thanh toán bằng đồng Việt Nam (VNĐ) thông qua hình thức chuyển khoản ngân hàng hoặc thanh toán trực tuyến qua cổng thanh toán số TH-PropTech.
2. Thời hạn thực hiện thanh toán: Tiền thuê nhà được thanh toán định kỳ hàng tháng, Bên Thuê có nghĩa vụ hoàn tất thanh toán trước hoặc đúng ngày ${contract.paymentDay || 5} của mỗi kỳ thanh toán.
3. Chứng từ thanh toán: Mọi giao dịch thanh toán thành công qua hệ thống TH-PropTech đều được lưu vết, cấp biên nhận điện tử và đối soát tự động làm bằng chứng thanh toán hợp lệ giữa hai bên.`,
        protected: true,
      },
      {
        number: 4,
        title: 'Thời hạn cho thuê, thời điểm giao nhận nhà ở và hồ sơ kèm theo',
        content: `1. Thời hạn cho thuê: Thời hạn thuê căn hộ là ${contract.durationMonths || 12} tháng, bắt đầu tính từ ngày ${formatDate(contract.startDate)} và kết thúc vào ngày ${formatDate(contract.endDate)}.
2. Thời điểm bàn giao nhà ở: Ngày ${formatDate(contract.startDate)} sau khi Bên Thuê đã hoàn thành đầy đủ nghĩa vụ thanh toán tiền đặt cọc bảo đảm theo thỏa thuận.
3. Hồ sơ và tài liệu kèm theo hợp đồng:
  a) Phụ lục 1: Biên bản bàn giao hiện trạng căn hộ;
  b) Phụ lục 2: Danh mục kiểm kê trang thiết bị, nội thất;
  c) Phụ lục 3: Nội quy quản lý và sử dụng nhà chung cư;
  d) Phụ lục 4: Thỏa thuận đặt cọc bảo đảm thực hiện hợp đồng.`,
        protected: true,
      },
      {
        number: 5,
        title: 'Sử dụng nhà ở thuê',
        content: `1. Mục đích sử dụng: Bên Thuê cam kết sử dụng căn hộ đúng công năng thiết kế và hoàn toàn vào mục đích để ở sinh hoạt hợp pháp của các cá nhân đã đăng ký.
2. Các hành vi nghiêm cấm:
  a) Tuyệt đối không sử dụng căn hộ vào mục đích kinh doanh, sản xuất, buôn bán hàng hóa trái phép hoặc các hoạt động tôn giáo, hội họp vi phạm pháp luật;
  b) Nghiêm cấm tàng trữ, vận chuyển, sử dụng vũ khí, chất cháy nổ, chất độc hại, ma túy hoặc các loại hàng cấm theo quy định của pháp luật Việt Nam;
  c) Không được tự ý cho thuê lại một phần hoặc toàn bộ căn hộ khi chưa có văn bản đồng ý của Bên Cho Thuê;
  d) Không được tự ý đục phá tường, cơi nới, sửa chữa thay đổi kết cấu chịu lực hoặc làm biến dạng kiến trúc căn hộ.
3. Tuân thủ an ninh trật tự: Bên Thuê có nghĩa vụ thực hiện thủ tục đăng ký tạm trú theo quy định của Luật Cư trú và tuân thủ nghiêm ngặt Nội quy quản lý vận hành tòa nhà, quy định an ninh trật tự và quy chuẩn PCCC của khu chung cư.`,
        protected: true,
      },
      {
        number: 6,
        title: 'Quyền và nghĩa vụ của Bên cho thuê',
        content: `1. Quyền của Bên Cho Thuê (theo Điều 18 Luật Kinh doanh bất động sản 2023):
  a) Yêu cầu Bên Thuê nhận bàn giao nhà ở theo đúng thời hạn đã thỏa thuận tại Điều 4 của Hợp đồng này;
  b) Yêu cầu Bên Thuê thanh toán đủ tiền thuê đúng thời hạn và phương thức cam kết tại Điều 3;
  c) Yêu cầu Bên Thuê bảo quản, sử dụng nhà ở đúng hiện trạng, công năng và các thỏa thuận trong hợp đồng;
  d) Yêu cầu Bên Thuê bồi thường thiệt hại hoặc sửa chữa toàn bộ phần hư hỏng do lỗi của Bên Thuê gây ra;
  đ) Cải tạo, nâng cấp nhà ở khi được Bên Thuê đồng ý bằng văn bản nhưng không được gây ảnh hưởng cản trở quyền sử dụng của Bên Thuê;
  e) Đơn phương chấm dứt hợp đồng theo quy định tại điểm g khoản 2 Điều 18 Luật Kinh doanh bất động sản 2023 khi Bên Thuê chậm trả tiền thuê quá 15 ngày hoặc sử dụng căn hộ sai mục đích;
  g) Yêu cầu Bên Thuê giao lại nhà ở khi hết thời hạn thuê hoặc khi chấm dứt hợp đồng;
  h) Các quyền khác do hai bên thỏa thuận phù hợp với quy định của pháp luật.
2. Nghĩa vụ của Bên Cho Thuê (theo Điều 19 Luật Kinh doanh bất động sản 2023):
  a) Bàn giao nhà ở cho Bên Thuê theo đúng thời hạn, hiện trạng và hướng dẫn Bên Thuê sử dụng nhà ở đúng công năng, thiết kế;
  b) Bảo đảm cho Bên Thuê sử dụng ổn định, trọn vẹn và an toàn căn hộ trong suốt thời hạn thuê;
  c) Bảo trì, sửa chữa lớn các hư hỏng kết cấu công trình, hệ thống hạ tầng kỹ thuật chung không do lỗi của Bên Thuê gây ra;
  d) Không được đơn phương chấm dứt hợp đồng khi Bên Thuê thực hiện đúng các nghĩa vụ theo hợp đồng;
  đ) Bồi thường thiệt hại thực tế do lỗi của mình gây ra;
  e) Thực hiện đầy đủ nghĩa vụ tài chính và nghĩa vụ thuế với Nhà nước theo quy định của pháp luật hiện hành.`,
        protected: true,
      },
      {
        number: 7,
        title: 'Quyền và nghĩa vụ của Bên thuê',
        content: `1. Quyền của Bên Thuê (theo Điều 20 Luật Kinh doanh bất động sản 2023):
  a) Yêu cầu Bên Cho Thuê bàn giao nhà ở theo đúng hiện trạng và danh mục trang thiết bị đã thỏa thuận;
  b) Yêu cầu Bên Cho Thuê cung cấp thông tin đầy đủ, trung thực về căn hộ và tính pháp lý của bất động sản;
  c) Được đổi nhà ở đang thuê với người thuê khác nếu được Bên Cho Thuê chấp thuận bằng văn bản;
  d) Được tiếp tục thuê căn hộ theo các điều kiện đã thỏa thuận trong trường hợp căn hộ thay đổi chủ sở hữu;
  đ) Yêu cầu Bên Cho Thuê kịp thời bảo trì, sửa chữa các hư hỏng lớn thuộc trách nhiệm của Bên Cho Thuê;
  e) Yêu cầu Bên Cho Thuê bồi thường thiệt hại thực tế nếu phát sinh do lỗi của Bên Cho Thuê;
  g) Đơn phương chấm dứt hợp đồng khi Bên Cho Thuê vi phạm nghiêm trọng nghĩa vụ hợp đồng theo quy định tại điểm g khoản 2 Điều 20 Luật Kinh doanh bất động sản 2023.
2. Nghĩa vụ của Bên Thuê (theo Điều 21 Luật Kinh doanh bất động sản 2023):
  a) Bảo quản, sử dụng nhà ở đúng công năng, mục đích và thiết kế đã liệt kê tại Điều 1;
  b) Thanh toán đủ tiền thuê nhà ở theo thời hạn và phương thức thỏa thuận tại Điều 3;
  c) Chi trả đầy đủ các chi phí sinh hoạt phát sinh (điện, nước, internet, phí dịch vụ quản lý tòa nhà) đúng hạn;
  d) Sửa chữa hư hỏng hoặc bồi thường thiệt hại do lỗi của mình gây ra;
  đ) Bàn giao lại nhà ở cho Bên Cho Thuê theo đúng hiện trạng thỏa thuận khi chấm dứt hợp đồng;
  e) Không được tự ý thay đổi, cải tạo, phá dỡ hoặc cho bên thứ ba thuê lại nếu không có sự đồng ý bằng văn bản của Bên Cho Thuê;
  g) Tuân thủ nghiêm ngặt nội quy tòa nhà chung cư, quy chuẩn PCCC và pháp luật về cư trú.`,
        protected: true,
      },
      {
        number: 8,
        title: 'Bàn giao, hoàn trả căn hộ và thủ tục cọc',
        content: `1. Bàn giao căn hộ: Việc bàn giao nhà ở được lập thành Biên bản bàn giao đính kèm Phụ lục 1 của Hợp đồng này, ghi nhận rõ chỉ số công tơ điện, nước và tình trạng thực tế của trang thiết bị tại thời điểm nhận nhà.
2. Tiền đặt cọc bảo đảm: Bên Thuê đặt cọc số tiền ${formatVND(contract.deposit || 0)} nhằm bảo đảm thực hiện nghĩa vụ hợp đồng theo Thỏa thuận đặt cọc số ${contract.depositAgreementCode || 'DA-PENDING'}. Tiền đặt cọc không được dùng để cấn trừ vào tiền thuê hàng tháng.
3. Hoàn trả tiền cọc: Tiền đặt cọc do Bên Cho Thuê giữ và được hoàn trả trực tiếp cho Bên Thuê; nền tảng không nhận, không giữ và không chuyển tiền cọc. Khi hợp đồng chấm dứt hoặc thanh lý, Bên Cho Thuê hoàn trả tiền đặt cọc trong vòng ${DEPOSIT_REFUND_DUE_TEXT} kể từ ngày bảng khấu trừ tiền cọc được Bên Thuê chấp nhận hoặc được xem là đã chấp nhận, sau khi đã khấu trừ các khoản công nợ dịch vụ hoặc chi phí bồi thường hư hại hợp lý (nếu có) có chứng từ.
4. Biên bản trả nhà và bảng khấu trừ cọc: Bên Cho Thuê lập biên bản trả nhà và bảng khấu trừ cọc. Bên Thuê có ${this.resolveMoveOutResponseDays(contract)} ngày kể từ ngày nhận được mỗi văn bản để xác nhận hoặc phản đối; quá thời hạn mà không phản hồi được xem là đồng ý. Mỗi bên có quyền yêu cầu ghi nhận tranh chấp trên hệ thống; nền tảng không phân xử và không bảo đảm khoản tiền hoàn trả. Số ngày tính theo ngày dương lịch.`,
        protected: true,
      },
      {
        number: 9,
        title: 'Trách nhiệm do vi phạm hợp đồng và bồi thường thiệt hại',
        content: `1. Trách nhiệm do vi phạm nghĩa vụ thanh toán: Trường hợp Bên Thuê chậm thanh toán tiền thuê nhà theo thời hạn quy định tại Điều 3, Bên Thuê phải chịu lãi phạt chậm thanh toán tương đương ${resolveLatePenaltyRate(contract, { renderBranch: 'structured', source: 'signed' })}%/năm tính trên số tiền và số ngày chậm trả thực tế theo ${LATE_PAYMENT_AGREED_INTEREST_BASIS}.
2. Đơn phương chấm dứt hợp đồng trước hạn: Bên muốn đơn phương chấm dứt hợp đồng trước hạn phải thông báo bằng văn bản cho bên kia trước ít nhất ${contract.terminationNoticeDays || 30} ngày theo ${TERMINATION_NOTICE_BASIS}.
3. Chế tài vi phạm: Nếu Bên Cho Thuê đơn phương chấm dứt hợp đồng trái quy định thì phải hoàn trả tiền đặt cọc và bồi thường cho Bên Thuê một khoản tiền tương đương số tiền đặt cọc theo ${WRONGFUL_TERMINATION_DEPOSIT_BASIS}. Nếu Bên Thuê đơn phương chấm dứt trái quy định thì không được nhận lại số tiền đặt cọc bảo đảm.`,
        protected: true,
      },
      {
        number: 10,
        title: 'Các trường hợp chấm dứt hợp đồng và sự kiện bất khả kháng',
        content: `1. Các trường hợp chấm dứt hợp đồng:
  a) Hết thời hạn thuê theo quy định tại Điều 4 của Hợp đồng này và hai bên không gia hạn;
  b) Hai bên tự nguyện thỏa thuận chấm dứt hợp đồng bằng văn bản;
  c) Bên Thuê chậm thanh toán tiền thuê nhà quá 15 ngày kể từ ngày đến hạn mà không có lý do chính đáng;
  d) Căn hộ bị hư hỏng nghiêm trọng hoặc bị phá dỡ, thu hồi theo quyết định của cơ quan nhà nước có thẩm quyền;
  đ) Sự kiện bất khả kháng kéo dài quá 30 ngày dẫn đến không thể tiếp tục thực hiện hợp đồng.
2. Sự kiện bất khả kháng: Các sự kiện khách quan không thể lường trước và không thể khắc phục được (thiên tai, dịch bệnh, chiến tranh, chính sách nhà nước thay đổi) được miễn trừ trách nhiệm theo quy định của Bộ luật Dân sự 2015, với điều kiện bên gặp sự cố phải thông báo kịp thời bằng văn bản cho bên kia trong vòng 03 ngày làm việc.`,
        protected: true,
      },
      {
        number: 11,
        title: 'Giải quyết tranh chấp',
        content: `1. Thương lượng hòa giải: Mọi tranh chấp phát sinh từ hoặc liên quan đến Hợp đồng này trước hết sẽ được hai bên ưu tiên giải quyết thông qua thương lượng, hòa giải trên tinh thần thiện chí, tôn trọng và hợp tác.
2. Thẩm quyền Tòa án nhân dân: Trường hợp thương lượng không thành trong vòng 30 (ba mươi) ngày kể từ ngày phát sinh tranh chấp, một trong hai bên có quyền đưa vụ việc ra Tòa án nhân dân có thẩm quyền tại địa phương nơi có bất động sản để giải quyết theo quy định của pháp luật Tố tụng dân sự. Phán quyết có hiệu lực pháp luật của Tòa án là quyết định cuối cùng buộc hai bên phải nghiêm chỉnh thi hành.`,
        protected: true,
      },
      {
        number: 12,
        title: 'Hiệu lực của hợp đồng và điều khoản thi hành',
        content: `1. Hiệu lực pháp lý: Hợp đồng này có hiệu lực kể từ thời điểm cả hai bên (Bên Cho Thuê và Bên Thuê) hoàn tất việc ký kết thông qua chữ ký số từ xa VNPT SmartCA hoặc chữ ký điện tử e-Consent hợp lệ được ghi nhận trên hệ thống TH-PropTech.
2. Giá trị chứng cứ dữ liệu điện tử: Hợp đồng này được lập và lưu trữ dưới dạng thông điệp dữ liệu điện tử, có giá trị pháp lý chứng cứ hoàn toàn tương đương với văn bản giấy truyền thống theo quy định của Luật Giao dịch điện tử số 20/2023/QH15 và Bộ luật Dân sự 2015.
3. Bảo vệ toàn vẹn bằng Blockchain: Toàn bộ nội dung của Hợp đồng này được khóa mã băm toàn vẹn SHA-256 chống chỉnh sửa và được neo lưu trữ vĩnh viễn trên sổ cái Blockchain Hyperledger Fabric phục vụ công tác đối soát và xác thực pháp lý.
4. Cam kết tự nguyện: Hai bên cam kết đã đọc kỹ, hiểu rõ toàn bộ nội dung, quyền và nghĩa vụ quy định trong Hợp đồng này; tự nguyện ký kết và cùng nhau thực hiện nghiêm chỉnh mọi thỏa thuận đã cam kết.`,
        protected: true,
      },
    ]

    return articlesContent.map(item => ({
      id: `sec-${item.number}`,
      number: item.number,
      title: item.title,
      content: item.content,
      protected: item.protected,
      hash: createHash('sha256')
        .update(item.title + item.content)
        .digest('hex'),
    }))
  }

  private static buildAnnexes(): ContractDocumentAnnexDto[] {
    return [
      {
        id: 'annex-1',
        title: 'Phụ lục 1: Biên bản bàn giao hiện trạng căn hộ',
        description:
          'Chi tiết tình trạng tường, sàn, hệ thống điện, nước tại thời điểm bàn giao',
        required: true,
      },
      {
        id: 'annex-2',
        title: 'Phụ lục 2: Danh mục trang thiết bị, nội thất',
        description:
          'Bảng kiểm kê thiết bị bàn giao kèm số lượng và tình trạng hoạt động',
        required: true,
      },
      {
        id: 'annex-3',
        title: 'Phụ lục 3: Nội quy quản lý và sử dụng nhà chung cư',
        description:
          'Quy định giờ giấc, an ninh, phòng cháy chữa cháy và vệ sinh chung',
        required: true,
      },
      {
        id: 'annex-4',
        title: 'Phụ lục 4: Thỏa thuận đặt cọc bảo đảm thực hiện hợp đồng',
        description: 'Biên nhận tiền cọc bảo đảm hợp đồng thuê',
        required: true,
      },
    ]
  }
}
