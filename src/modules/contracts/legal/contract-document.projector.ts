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

    return {
      mode: isLocked ? 'locked' : 'draft',
      revision,
      lockedAt: contract.contentLockedAt
        ? contract.contentLockedAt.toISOString()
        : null,
      lockedHash: contract.contentLockedHash ?? null,
      hashSchemaVersion: contract.hashSchemaVersion ?? 1,
      legalProfile,
      templateVersion: '2026.1-VN-CIVIL',
      sections,
      annexes,
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
        title: 'Điều 1. Đối tượng hợp đồng và căn hộ cho thuê',
        content: `Bên Cho Thuê đồng ý cho Bên Thuê thuê toàn quyền sử dụng căn hộ "${contract.propertyTitle || 'Căn hộ chung cư'}", địa chỉ tại ${contract.propertyAddress || 'Theo hồ sơ bất động sản'}. Diện tích sử dụng: ${contract.propertyArea ? `${contract.propertyArea} m²` : 'Theo thực tế bàn giao'}. Hiện trạng nội thất và trang thiết bị bàn giao: ${contract.propertyFurniture || 'Cơ bản theo biên bản bàn giao'}.`,
        protected: true,
      },
      {
        number: 2,
        title: 'Điều 2. Mục đích sử dụng',
        content:
          'Bên Thuê cam kết sử dụng căn hộ hoàn toàn vào mục đích để ở sinh hoạt hợp pháp, tuân thủ đúng quy chế an ninh trật tự, quy chuẩn phòng cháy chữa cháy (PCCC) và không sử dụng căn hộ vào bất kỳ hoạt động kinh doanh, thương mại, hoặc hành vi bị pháp luật cấm.',
        protected: true,
      },
      {
        number: 3,
        title: 'Điều 3. Thời hạn thuê và thời điểm nhận bàn giao',
        content: `Thời hạn thuê là ${contract.durationMonths || 12} tháng, bắt đầu từ ngày ${formatDate(contract.startDate)} đến hết ngày ${formatDate(contract.endDate)}. Thời điểm bàn giao căn hộ được hai bên thống nhất vào ngày ${formatDate(contract.startDate)} sau khi Bên Thuê hoàn tất đặt cọc theo thỏa thuận.`,
        protected: true,
      },
      {
        number: 4,
        title: 'Điều 4. Giá thuê và phương thức thanh toán',
        content: `Giá thuê căn hộ cố định là ${formatVND(contract.monthlyRent || 0)}/tháng (chưa bao gồm các loại phí dịch vụ, điện, nước, internet, gửi xe do đơn vị quản lý vận hành thu). Tiền thuê được thanh toán định kỳ vào ngày ${contract.paymentDay || 5} hàng tháng thông qua cổng thanh toán số hoặc chuyển khoản ngân hàng.`,
        protected: true,
      },
      {
        number: 5,
        title: 'Điều 5. Tiền đặt cọc và xử lý tiền cọc',
        content: `Bên Thuê đặt cọc cho Bên Cho Thuê số tiền ${formatVND(contract.deposit || 0)} nhằm bảo đảm thực hiện nghĩa vụ hợp đồng. Tiền cọc được thanh toán qua Thỏa thuận đặt cọc số ${contract.depositAgreementCode || 'DA-PENDING'}. Bên Cho Thuê có nghĩa vụ hoàn trả 100% tiền cọc cho Bên Thuê trong vòng 07 ngày làm việc kể từ ngày thanh lý hợp đồng sau khi khấu trừ các chi phí thiệt hại hợp lý (nếu có).`,
        protected: true,
      },
      {
        number: 6,
        title: 'Điều 6. Quyền và nghĩa vụ của Bên cho thuê',
        content:
          'Bên Cho Thuê có nghĩa vụ bàn giao căn hộ đúng thời hạn, bảo đảm quyền sử dụng trọn vẹn và ổn định cho Bên Thuê; hỗ trợ thủ tục đăng ký tạm trú theo quy định; có quyền đơn phương chấm dứt hợp đồng nếu Bên Thuê chậm đóng tiền thuê quá 15 ngày hoặc sử dụng căn hộ sai mục đích.',
        protected: true,
      },
      {
        number: 7,
        title: 'Điều 7. Quyền và nghĩa vụ của Bên thuê',
        content:
          'Bên Thuê có nghĩa vụ thanh toán tiền thuê và chi phí sinh hoạt đúng hạn; bảo quản tài sản, trang thiết bị trong căn hộ; tuân thủ nội quy tòa nhà chung cư; không được tự ý sửa chữa kết cấu, cơi nới hoặc cho bên thứ ba thuê lại nếu không có văn bản chấp thuận của Bên Cho Thuê.',
        protected: true,
      },
      {
        number: 8,
        title: 'Điều 8. Bàn giao và hoàn trả căn hộ',
        content:
          'Việc bàn giao căn hộ được lập thành Biên bản bàn giao đính kèm Phụ lục hợp đồng. Khi kết thúc thời hạn thuê hoặc thanh lý hợp đồng, Bên Thuê có nghĩa vụ hoàn trả lại căn hộ trong tình trạng sạch sẽ, nguyên vẹn như lúc nhận bàn giao (trừ hao mòn tự nhiên).',
        protected: true,
      },
      {
        number: 9,
        title: 'Điều 9. Đơn phương chấm dứt hợp đồng và phạt vi phạm',
        content: `Bên muốn đơn phương chấm dứt hợp đồng trước hạn phải thông báo trước bằng văn bản ít nhất ${contract.terminationNoticeDays || 30} ngày. Bên vi phạm nghĩa vụ thanh toán sẽ chịu lãi phạt quá hạn tương đương ${contract.latePenaltyRate || 10}%/năm tính trên số tiền chậm trả. Trường hợp đơn phương chấm dứt trái thỏa thuận sẽ chịu phạt cọc theo quy định pháp luật.`,
        protected: true,
      },
      {
        number: 10,
        title: 'Điều 10. Trường hợp bất khả kháng và giải quyết tranh chấp',
        content:
          'Các trường hợp bất khả kháng (thiên tai, dịch bệnh, quyết định thu hồi của cơ quan nhà nước có thẩm quyền) được miễn trừ trách nhiệm theo quy định của Bộ luật Dân sự. Mọi tranh chấp phát sinh sẽ được hai bên ưu tiên giải quyết qua thương lượng, hòa giải; nếu không đạt được thỏa thuận sẽ đưa ra Tòa án nhân dân có thẩm quyền giải quyết.',
        protected: true,
      },
      {
        number: 11,
        title: 'Điều 11. Hiệu lực hợp đồng và cam kết của các bên',
        content: `Hợp đồng này có hiệu lực kể từ thời điểm cả hai bên hoàn tất phương thức ký được ghi nhận trong hồ sơ hợp đồng. Trường hợp sử dụng VNPT SmartCA, mỗi chữ ký phải gắn với chứng thư số và đúng mã băm của bản PDF canonical; xác nhận eKYC/OTP chỉ là bước xác thực hỗ trợ, không thay thế chữ ký số. Dữ liệu mã băm toàn vẹn nội dung hợp đồng được neo lưu trữ trên sổ cái Blockchain Hyperledger Fabric khi giao dịch ledger được xác nhận. Hai bên cam kết tự nguyện, hiểu rõ các quyền và nghĩa vụ theo quy định của Bộ luật Dân sự 2015 và Luật Nhà ở 2023.`,
        protected: true,
      },
      {
        number: 12,
        title: 'Điều 12. Điều khoản thi hành và các phụ lục đính kèm',
        content:
          'Hợp đồng này được lập dưới dạng dữ liệu điện tử có giá trị chứng cứ pháp lý giữa hai bên. Các phụ lục đính kèm là một phần không thể tách rời của hợp đồng.',
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
