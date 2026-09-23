import { createHash } from 'crypto'
import type { Contract } from '../schemas/contract.schema'
import {
  validateDocumentManifest,
  LeaseDocumentManifest,
} from './lease-template.manifest'
import { resolveLegalProfile, LegalProfile } from './legal-profile.resolver'
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
  static projectDocument(contract: Contract): ContractDocumentViewDto {
    const isLocked = Boolean(
      contract.contentLockedHash && contract.contentLockedAt
    )
    const revision = contract.contentRevision ?? 1
    const legalProfile: LegalProfile = resolveLegalProfile({
      landlordType: 'individual',
      operatesRealEstateBusiness: false,
    })

    const sections = this.buildStructuredSections(contract)
    const annexes = this.buildAnnexes()

    // Validate manifest
    const manifest: LeaseDocumentManifest = {
      legalProfile,
      articles: sections.map(s => ({
        number: s.number,
        heading: s.title,
        contentHash: s.hash,
        protected: s.protected,
      })),
      annexes: annexes.map(a => a.title),
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
            contentType: contract.artifactRef.contentType,
          }
        : null

    return {
      mode: isLocked ? 'locked' : 'draft',
      revision,
      lockedAt: contract.contentLockedAt
        ? contract.contentLockedAt.toISOString()
        : null,
      lockedHash:
        contract.artifactRef?.artifactHash ??
        contract.contentLockedHash ??
        null,
      hashSchemaVersion: contract.hashSchemaVersion ?? 1,
      legalProfile,
      templateVersion: contract.artifactRef
        ? `${contract.artifactRef.templateKey}@${contract.artifactRef.templateVersion}`
        : '2026.1-VN-CIVIL',
      sections,
      annexes,
      canonicalArtifact,
      integrity,
    }
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
3. Hoàn trả tiền cọc: Khi hợp đồng chấm dứt hoặc thanh lý, Bên Cho Thuê có nghĩa vụ hoàn trả 100% tiền đặt cọc cho Bên Thuê trong vòng 07 (bảy) ngày làm việc kể từ ngày nhận lại căn hộ và ký Biên bản thanh lý, sau khi đã khấu trừ các khoản công nợ dịch vụ hoặc chi phí bồi thường hư hại hợp lý (nếu có).`,
        protected: true,
      },
      {
        number: 9,
        title: 'Trách nhiệm do vi phạm hợp đồng và bồi thường thiệt hại',
        content: `1. Trách nhiệm do vi phạm nghĩa vụ thanh toán: Trường hợp Bên Thuê chậm thanh toán tiền thuê nhà theo thời hạn quy định tại Điều 3, Bên Thuê phải chịu lãi phạt chậm thanh toán tương đương ${contract.latePenaltyRate || 10}%/năm tính trên số tiền và số ngày chậm trả thực tế theo Khoản 1 Điều 468 Bộ luật Dân sự 2015.
2. Đơn phương chấm dứt hợp đồng trước hạn: Bên muốn đơn phương chấm dứt hợp đồng trước hạn phải thông báo bằng văn bản cho bên kia trước ít nhất ${contract.terminationNoticeDays || 30} ngày theo Khoản 3 Điều 130 Luật Nhà ở 2023.
3. Chế tài vi phạm: Nếu Bên Cho Thuê đơn phương chấm dứt hợp đồng trái quy định thì phải hoàn trả lại tiền đặt cọc và bồi thường cho Bên Thuê một khoản tiền tương đương 01 tháng tiền thuê. Nếu Bên Thuê đơn phương chấm dứt trái quy định thì không được nhận lại số tiền đặt cọc bảo đảm.`,
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
