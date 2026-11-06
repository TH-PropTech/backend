import { DEPOSIT_REFUND_DUE_TEXT } from '../../rental/utils/deposit-refund.constants'
import type {
  LegalSourceContent,
  PlatformRegulationContent,
} from './legal-sources.types'

/**
 * Dữ liệu seed ban đầu, port nguyên văn từ frontend
 * `features/contracts/model/legal-governance-data.ts` (commit abb4124,
 * link đã xác minh ở frontend#83). Chỉ dùng khi collection rỗng.
 */
export const SEED_LEGAL_SOURCES: Record<
  string,
  LegalSourceContent & { id: string }
> = {
  '1.004194': {
    id: '1.004194',
    code: 'TTHC 1.004194',
    title: 'Đăng ký tạm trú / Thường trú tại chỗ ở hợp pháp do thuê',
    subtitle: 'Thủ tục hành chính cấp Xã/Phường theo quy định Bộ Công an',
    agency: 'Công an Xã / Phường / Thị trấn nơi có căn hộ cho thuê',
    duration: '03 ngày làm việc (kể từ khi nhận đủ hồ sơ hợp lệ)',
    fee: '10.000 - 20.000 VNĐ khi nộp trực tuyến qua Cổng DVC / Miễn phí đối với một số đối tượng ưu tiên',
    externalUrl:
      'https://dichvucong.gov.vn/thu-tuc-hanh-chinh/019d2bf7-770b-734d-b7fb-5e1995f194f4',
    icon: 'residence',
    description:
      'Công dân khi đến sinh sống tại chỗ ở hợp pháp do thuê, mượn, ở nhờ có trách nhiệm đăng ký tạm trú với cơ quan đăng ký cư trú theo quy định của Luật Cư trú trong thời hạn 30 ngày.',
    dossierItems: [
      {
        title: 'Tờ khai thay đổi thông tin cư trú (Mẫu CT01)',
        detail:
          'Khai trực tuyến trên Cổng DVC Bộ Công an hoặc ứng dụng VNeID (định danh mức 2).',
      },
      {
        title: 'Hợp đồng thuê nhà điện tử đã khóa SHA-256',
        detail:
          'Trích xuất file PDF hợp đồng có chữ ký số SmartCA / e-Consent và mã hash neo Blockchain từ hệ thống TH-PropTech.',
        isPropTechExport: true,
      },
      {
        title: 'Giấy tờ chứng minh chỗ ở hợp pháp',
        detail:
          'Giấy chứng nhận quyền sở hữu nhà (sổ hồng) của Chủ nhà hoặc văn bản đồng ý cho thuê của chủ hộ.',
      },
      {
        title: 'Giấy tờ tùy thân của người thuê',
        detail:
          'Căn cước công dân (CCCD) gắn chip hoặc Tài khoản định danh điện tử VNeID mức độ 2.',
      },
    ],
    steps: [
      {
        step: 1,
        title: 'Trích xuất Hợp đồng & Mã hash từ TH-PropTech',
        detail:
          'Trên trang Không gian hợp đồng, tải về bản thể hiện điện tử PDF (đã có đủ chữ ký số và mã băm SHA-256 bất biến).',
      },
      {
        step: 2,
        title: 'Đăng nhập Cổng DVC Bộ Công an / VNeID',
        detail:
          'Truy cập dichvucong.bocongan.gov.vn hoặc app VNeID bằng tài khoản Định danh điện tử Cấp 2 của công dân.',
      },
      {
        step: 3,
        title: 'Nộp hồ sơ trực tuyến TTHC 1.004194',
        detail:
          'Tìm thủ tục "Đăng ký tạm trú", chọn Công an xã/phường nơi có căn hộ, đính kèm file hợp đồng PDF và gửi hồ sơ.',
      },
      {
        step: 4,
        title: 'Nhận Thông báo kết quả xác nhận cư trú (CT07/CT08)',
        detail:
          'Sau tối đa 03 ngày làm việc, kết quả được trả về điện tử trong tài khoản DVC / VNeID hoặc nhận trực tiếp tại Công an phường.',
      },
    ],
    legalGrounds: [
      {
        title: 'Luật Cư trú số 68/2020/QH14',
        article: 'Điều 27, Điều 28 (Điều kiện và hồ sơ đăng ký tạm trú)',
      },
      {
        title: 'Thông tư số 55/2021/TT-BCA & 56/2021/TT-BCA',
        article:
          'Quy định chi tiết thi hành Luật Cư trú và các biểu mẫu CT01-CT08',
      },
    ],
    notes: [
      'Hợp đồng thuê ký số điện tử trên sàn TH-PropTech có giá trị pháp lý tương đương văn bản giấy theo Luật Giao dịch điện tử 2023.',
      'Cơ quan công an tiếp nhận file PDF đính kèm qua Cổng DVC trực tuyến mà không bắt buộc nộp bản cứng nếu đã có chứng thực/ký số.',
    ],
  },
  '1.004195': {
    id: '1.004195',
    code: 'TTHC 1.004195',
    title: 'Xóa đăng ký tạm trú khi chấm dứt hợp đồng thuê nhà',
    subtitle: 'Thủ tục hoàn tất nghĩa vụ cư trú khi kết thúc thời hạn thuê',
    agency: 'Công an Xã / Phường / Thị trấn nơi đã đăng ký tạm trú',
    duration: '01 ngày làm việc',
    fee: 'Miễn lệ phí',
    externalUrl: 'https://dichvucong.bocongan.gov.vn/',
    icon: 'residence',
    description:
      'Người đã đăng ký tạm trú nhưng chấm dứt việc thuê nhà, chuyển đi nơi khác hoặc hợp đồng thuê hết hạn mà không gia hạn phải thực hiện thủ tục xóa đăng ký tạm trú.',
    dossierItems: [
      {
        title: 'Tờ khai thay đổi thông tin cư trú (Mẫu CT01)',
        detail: 'Khai báo lý do chấm dứt thuê chỗ ở và đề nghị xóa tạm trú.',
      },
      {
        title: 'Biên bản thanh lý hợp đồng thuê nhà',
        detail:
          'Văn bản điện tử thanh lý hợp đồng trích xuất từ TH-PropTech có xác nhận 2 bên.',
        isPropTechExport: true,
      },
    ],
    steps: [
      {
        step: 1,
        title: 'Thanh lý hợp đồng trên TH-PropTech',
        detail:
          'Hoàn tất ký biên bản thanh lý và nghiệm thu hoàn trả tiền đặt cọc trên sàn.',
      },
      {
        step: 2,
        title: 'Nộp hồ sơ trực tuyến TTHC 1.004195',
        detail:
          'Đăng nhập Cổng DVC Bộ Công an, chọn thủ tục Xóa đăng ký tạm trú và đính kèm biên bản thanh lý.',
      },
      {
        step: 3,
        title: 'Cập nhật trạng thái cơ sở dữ liệu dân cư',
        detail:
          'Cơ quan đăng ký cư trú kiểm tra và xóa thông tin tạm trú trên hệ thống CSDL Quốc gia về dân cư.',
      },
    ],
    legalGrounds: [
      {
        title: 'Luật Cư trú số 68/2020/QH14',
        article: 'Điều 29 (Xóa đăng ký tạm trú)',
      },
    ],
    notes: [
      'Chủ nhà có quyền yêu cầu xóa đăng ký tạm trú của người thuê sau khi hợp đồng thuê nhà chấm dứt.',
    ],
  },
  '1.004192': {
    id: '1.004192',
    code: 'TTHC 1.004192',
    title: 'Thông báo lưu trú cho khách thuê ngắn hạn & Căn hộ dịch vụ',
    subtitle: 'Khai báo lưu trú trực tuyến qua ứng dụng VNeID / Cổng DVC BCA',
    agency: 'Công an Xã / Phường / Thị trấn nơi có căn hộ lưu trú',
    duration:
      'Thực hiện ngay trước 23h00 cùng ngày (hoặc trước 08h00 ngày hôm sau nếu đến sau 23h00)',
    fee: 'Miễn lệ phí',
    externalUrl: 'https://dichvucong.bocongan.gov.vn/',
    icon: 'residence',
    description:
      'Áp dụng cho chủ căn hộ dịch vụ, homestay hoặc căn hộ cho thuê lưu trú ngắn hạn khi có người đến lưu trú qua đêm.',
    dossierItems: [
      {
        title: 'Thông tin nhân thân khách lưu trú',
        detail:
          'Họ tên, số định danh cá nhân / CCCD, ngày tháng năm sinh, quốc tịch.',
      },
      {
        title: 'Mã số đặt phòng & Hợp đồng lưu trú ngắn hạn',
        detail: 'Thông tin hợp đồng lưu trú điện tử trích xuất từ TH-PropTech.',
        isPropTechExport: true,
      },
    ],
    steps: [
      {
        step: 1,
        title: 'Quét mã QR CCCD khách hàng trên VNeID / TH-PropTech',
        detail:
          'Ghi nhận thông tin khách lưu trú ngay khi nhận phòng (Check-in).',
      },
      {
        step: 2,
        title: 'Gửi thông báo lưu trú trực tuyến',
        detail:
          'Gửi thông tin trực tiếp tới Công an phường/xã qua phần mềm ASM hoặc ứng dụng VNeID.',
      },
    ],
    legalGrounds: [
      {
        title: 'Luật Cư trú số 68/2020/QH14',
        article: 'Điều 30 (Thông báo lưu trú)',
      },
    ],
    notes: [
      'Không khai báo lưu trú cho khách thuê ngắn hạn có thể bị xử phạt hành chính từ 500.000 đến 2.000.000 VNĐ theo Nghị định 144/2021/NĐ-CP.',
    ],
  },
  '1.004190': {
    id: '1.004190',
    code: 'TTHC 1.004190',
    title: 'Cấp Giấy xác nhận thông tin về cư trú (Mẫu CT07)',
    subtitle:
      'Chứng minh nơi cư trú hợp pháp phục vụ giao kết dân sự và con cái học tập',
    agency: 'Công an Xã / Phường / Thị trấn',
    duration: '01 ngày làm việc (trực tuyến) hoặc 03 ngày làm việc (trực tiếp)',
    fee: 'Theo quy định DVC trực tuyến (Thường miễn phí hoặc 10.000 VNĐ)',
    externalUrl: 'https://dichvucong.bocongan.gov.vn/',
    icon: 'residence',
    description:
      'Văn bản xác nhận của cơ quan công an về thời gian, địa điểm đăng ký thường trú hoặc tạm trú của công dân tại địa chỉ căn hộ thuê.',
    dossierItems: [
      {
        title: 'Tờ khai CT01 đề nghị cấp CT07',
        detail: 'Kê khai trực tuyến trên Cổng DVC Bộ Công an.',
      },
    ],
    steps: [
      {
        step: 1,
        title: 'Nộp hồ sơ trực tuyến',
        detail:
          'Đăng nhập Cổng DVC, chọn hình thức nhận kết quả điện tử bản ký số.',
      },
      {
        step: 2,
        title: 'Tải văn bản CT07 điện tử',
        detail:
          'Nhận file PDF có mã QR xác thực để nộp cho trường học hoặc cơ quan thuế.',
      },
    ],
    legalGrounds: [
      {
        title: 'Thông tư số 56/2021/TT-BCA',
        article: 'Điều 17 (Biểu mẫu CT07 xác nhận thông tin cư trú)',
      },
    ],
    notes: [
      'Giấy CT07 có giá trị sử dụng 01 năm kể từ ngày cấp đối với người có nơi thường trú, tạm trú.',
    ],
  },
  '1.007689': {
    id: '1.007689',
    code: 'TTHC 1.007689',
    title: 'Khai thuế đối với cá nhân cho thuê tài sản',
    subtitle: 'Thủ tục kê khai thuế thu nhập cá nhân (TNCN) & GTGT ngành thuế',
    agency: 'Chi cục Thuế khu vực / Thuế cơ sở nơi có căn hộ cho thuê',
    duration: 'Theo kỳ tính thuế (theo từng lần phát sinh hoặc theo quý/năm)',
    fee: 'Miễn phí thủ tục kê khai (Nộp thuế 10% nếu tổng doanh thu cho thuê > 100 triệu VNĐ/năm)',
    externalUrl:
      'https://dichvucong.gov.vn/thu-tuc-hanh-chinh/019d2bfc-2d93-73ec-ba2f-8d6aef8f7950',
    icon: 'tax',
    description:
      'Cá nhân có hoạt động cho thuê căn hộ chung cư, nhà ở có phát sinh tổng doanh thu trên 100 triệu đồng/năm thuộc diện kê khai và nộp thuế GTGT (5%) và thuế TNCN (5%) theo quy định.',
    dossierItems: [
      {
        title: 'Tờ khai thuế đối với hoạt động cho thuê tài sản (Mẫu 01/TTS)',
        detail:
          'Kê khai trực tuyến qua Cổng Dịch vụ công Thuế (thuedientu.gdt.gov.vn) hoặc app eTax Mobile.',
      },
      {
        title: 'Bảng kê chi tiết hợp đồng cho thuê (Mẫu 01-1/BK-TTS)',
        detail:
          'Liệt kê thông tin căn hộ, diện tích, giá thuê hàng tháng và thời hạn hợp đồng.',
      },
      {
        title: 'Bản sao Hợp đồng thuê nhà điện tử',
        detail:
          'Trích xuất file PDF hợp đồng có đủ chứng chỉ chữ ký số từ TH-PropTech.',
        isPropTechExport: true,
      },
      {
        title: 'Bản sao CCCD / Mã số thuế cá nhân của Chủ nhà',
        detail: 'Thông tin mã số thuế cá nhân đã được xác thực trên hệ thống.',
      },
    ],
    steps: [
      {
        step: 1,
        title: 'Tải Bảng kê & Hợp đồng từ TH-PropTech',
        detail:
          'Xuất dữ liệu hợp đồng điện tử và sao kê giao dịch tiền thuê hàng tháng.',
      },
      {
        step: 2,
        title:
          'Đăng nhập Cổng Thuế điện tử (eTax Mobile / thuedientu.gdt.gov.vn)',
        detail:
          'Sử dụng tài khoản thuế cá nhân hoặc liên kết qua VNeID mức độ 2.',
      },
      {
        step: 3,
        title: 'Điền mẫu 01/TTS & Đính kèm hồ sơ',
        detail:
          'Nhập doanh thu kỳ tính thuế, đính kèm file hợp đồng PDF và bấm nộp tờ khai điện tử.',
      },
      {
        step: 4,
        title: 'Nhận thông báo chấp nhận và nộp thuế qua ngân hàng',
        detail:
          'Chi cục Thuế gửi Thông báo chấp nhận hồ sơ và mã định danh khoản nộp (ID khoản nộp) để thanh toán trực tuyến.',
      },
    ],
    legalGrounds: [
      {
        title: 'Thông tư số 40/2021/TT-BTC & 100/2021/TT-BTC',
        article:
          'Hướng dẫn thuế GTGT, TNCN đối với hộ kinh doanh, cá nhân kinh doanh cho thuê BĐS',
      },
      {
        title: 'Luật Quản lý thuế số 38/2019/QH14',
        article:
          'Quy định về khai thuế điện tử và nghĩa vụ nộp thuế của cá nhân',
      },
    ],
    notes: [
      'Doanh thu từ 100 triệu đồng/năm trở xuống thuộc diện MIỄN thuế GTGT và thuế TNCN.',
      'Hồ sơ khai thuế có thể nộp theo từng lần phát sinh hoặc theo quý.',
    ],
  },
  '1.008211': {
    id: '1.008211',
    code: 'TTHC 1.008211',
    title: 'Đăng ký biến động & Xác thực giao dịch Bất động sản',
    subtitle:
      'Thủ tục xác nhận quyền sở hữu và giao dịch tài sản gắn liền với đất',
    agency: 'Văn phòng Đăng ký Đất đai / Chi nhánh Văn phòng Đăng ký Đất đai',
    duration: '03 - 10 ngày làm việc tùy tính chất giao dịch',
    fee: 'Theo biểu mức thu phí thẩm định và lệ phí cấp chứng nhận cấp tỉnh',
    externalUrl: 'https://dichvucong.gov.vn/',
    icon: 'law',
    description:
      'Thủ tục xác thực tính pháp lý của giấy chứng nhận quyền sở hữu nhà ở (Sổ hồng) trước khi đưa bất động sản vào giao dịch thương mại trên sàn TH-PropTech.',
    dossierItems: [
      {
        title: 'Giấy chứng nhận quyền sở hữu nhà ở (Sổ hồng)',
        detail: 'Bản quét màu có đối chiếu mã vạch và thông tin số thửa/số tờ.',
      },
      {
        title: 'Bản trích lục bản đồ địa chính căn hộ',
        detail:
          'Sơ đồ mặt bằng căn hộ do chủ đầu tư hoặc văn phòng đăng ký cấp.',
      },
    ],
    steps: [
      {
        step: 1,
        title: 'Đối soát cơ sở dữ liệu nhà đất quốc gia',
        detail:
          'Kiểm tra tình trạng thế chấp ngân hàng hoặc tranh chấp pháp lý.',
      },
      {
        step: 2,
        title: 'Cấp dấu xác thực tích xanh Verified trên TH-PropTech',
        detail:
          'Căn hộ đạt tiêu chuẩn pháp lý sẽ được cấp huy hiệu niêm yết an toàn.',
      },
    ],
    legalGrounds: [
      {
        title: 'Luật Đất đai số 31/2024/QH15',
        article: 'Điều 133, 134 (Đăng ký biến động đất đai và tài sản)',
      },
    ],
    notes: [
      'Chủ nhà niêm yết trên TH-PropTech bắt buộc phải vượt qua bước kiểm tra quyền sở hữu hợp pháp.',
    ],
  },
  'housing-law-2023': {
    id: 'housing-law-2023',
    code: 'Luật Nhà ở 2023',
    title: 'Luật Nhà ở số 27/2023/QH15',
    subtitle:
      'Quy chuẩn toàn diện về sở hữu, quản lý vận hành và giao dịch cho thuê nhà ở',
    agency: 'Quốc hội nước CHXHCN Việt Nam',
    duration: 'Có hiệu lực thi hành từ ngày 01/08/2024',
    fee: 'Văn bản Luật Quốc gia',
    externalUrl:
      'https://vanban.chinhphu.vn/default.aspx?pageid=27160&docid=209627',
    icon: 'law',
    description:
      'Quy định điều kiện của nhà ở tham gia giao dịch (Điều 160), trình tự ký kết hợp đồng thuê nhà ở (Điều 163), quyền đơn phương chấm dứt hợp đồng khi vi phạm (Điều 164), và quy chế quản lý vận hành nhà chung cư.',
    dossierItems: [
      {
        title: 'Điều kiện nhà ở cho thuê (Điều 160)',
        detail:
          'Có giấy chứng nhận quyền sở hữu, không thuộc diện tranh chấp, khiếu nại, không bị kê biên để thi hành án, và bảo đảm an toàn PCCC.',
      },
    ],
    steps: [
      {
        step: 1,
        title: 'Thỏa thuận tự nguyện & Giao kết bằng văn bản',
        detail:
          'Hợp đồng thuê nhà ở do các bên thỏa thuận và phải được lập thành văn bản theo khung chuẩn quy định.',
      },
      {
        step: 2,
        title: 'Ký kết hợp đồng điện tử',
        detail:
          'Được phép ký kết thông qua phương tiện điện tử có xác thực danh tính.',
      },
    ],
    legalGrounds: [
      {
        title: 'Luật Nhà ở số 27/2023/QH15',
        article: 'Điều 160, 161, 162, 163, 164, 165',
      },
    ],
    notes: [
      'Hợp đồng thuê nhà ở không bắt buộc phải công chứng, chứng thực trừ trường hợp các bên có nhu cầu.',
      'Bên cho thuê có quyền đơn phương chấm dứt hợp đồng nếu bên thuê không trả tiền nhà từ 03 tháng trở lên mà không có lý do chính đáng.',
    ],
  },
  're-business-law-2023': {
    id: 're-business-law-2023',
    code: 'Luật KDBĐS 2023',
    title: 'Luật Kinh doanh Bất động sản số 29/2023/QH15',
    subtitle: 'Quy chuẩn kinh doanh dịch vụ sàn giao dịch BĐS và hợp đồng mẫu',
    agency: 'Quốc hội nước CHXHCN Việt Nam',
    duration: 'Có hiệu lực thi hành từ ngày 01/08/2024',
    fee: 'Văn bản Luật Quốc gia',
    externalUrl:
      'https://vanban.chinhphu.vn/default.aspx?pageid=27160&docid=209624',
    icon: 'law',
    description:
      'Quy định về nguyên tắc công khai, minh bạch thông tin bất động sản đưa vào kinh doanh (Điều 6), hợp đồng kinh doanh BĐS (Điều 44-47), và trách nhiệm của sàn giao dịch BĐS công nghệ.',
    dossierItems: [
      {
        title: 'Nội dung hợp đồng kinh doanh BĐS (Điều 45)',
        detail:
          'Bắt buộc bao gồm thông tin tài sản, giá cả, thời hạn, quyền và nghĩa vụ, bồi thường thiệt hại và giải quyết tranh chấp.',
      },
    ],
    steps: [
      {
        step: 1,
        title: 'Công khai thông tin minh bạch',
        detail:
          'Đưa đầy đủ hồ sơ pháp lý căn hộ lên nền tảng trước khi cho thuê.',
      },
      {
        step: 2,
        title: 'Giao dịch qua sàn chuẩn hóa',
        detail: 'Thực hiện ký kết theo mẫu hợp đồng do Chính phủ quy định.',
      },
    ],
    legalGrounds: [
      {
        title: 'Luật Kinh doanh Bất động sản 29/2023/QH15',
        article: 'Điều 6, Điều 44, 45, 46, 47',
      },
    ],
    notes: [
      'Doanh nghiệp và sàn giao dịch BĐS phải tuân thủ nghiêm ngặt khung mẫu hợp đồng được quy định tại Nghị định 96/2024/NĐ-CP.',
    ],
  },
  'nd96-2024': {
    id: 'nd96-2024',
    code: 'Nghị định 96/2024/NĐ-CP',
    title: 'Quy định chi tiết Luật Kinh doanh Bất động sản 2023',
    subtitle:
      'Mẫu Hợp đồng thuê nhà ở thương mại chuẩn 12 điều khoản (Phụ lục II)',
    agency: 'Chính phủ / Bộ Xây dựng',
    duration: 'Có hiệu lực thi hành từ ngày 01/08/2024',
    fee: 'Văn bản quy phạm pháp luật công khai',
    externalUrl:
      'https://vanban.chinhphu.vn/default.aspx?pageid=27160&docid=210798',
    icon: 'decree',
    description:
      'Nghị định số 96/2024/NĐ-CP ban hành khung mẫu Hợp đồng thuê nhà ở thương mại tại Phụ lục II gồm đầy đủ 12 điều khoản pháp lý bắt buộc, áp dụng cho mọi giao dịch thuê nhà ở có tổ chức.',
    dossierItems: [
      {
        title: 'Cấu trúc 12 Điều khoản chuẩn hóa',
        detail:
          'Bao gồm: Thông tin BĐS, Giá thuê & Thanh toán, Thời hạn thuê, Quyền & Nghĩa vụ hai bên, Đặt cọc, Chấm dứt & Bồi thường, Giải quyết tranh chấp.',
        isPropTechExport: true,
      },
    ],
    steps: [
      {
        step: 1,
        title: 'Khởi tạo từ mẫu chuẩn Phụ lục II',
        detail:
          'Hệ thống TH-PropTech tự động chiếu dữ liệu căn hộ và gói thuê vào 12 điều khoản chuẩn Nghị định 96.',
      },
      {
        step: 2,
        title: 'Khóa bất biến & Neo Blockchain',
        detail:
          'Tạo mã băm SHA-256 bảo toàn toàn vẹn nội dung hợp đồng trước khi ký số.',
      },
    ],
    legalGrounds: [
      {
        title: 'Nghị định số 96/2024/NĐ-CP',
        article: 'Điều 14, Điều 15 và Phụ lục II',
      },
    ],
    notes: [
      'Toàn bộ hợp đồng trên sàn TH-PropTech tuân thủ 100% cấu trúc mẫu Phụ lục II Nghị định 96/2024/NĐ-CP.',
    ],
  },
  'civil-code-2015': {
    id: 'civil-code-2015',
    code: 'Bộ luật Dân sự 2015',
    title: 'Bộ luật Dân sự số 91/2015/QH13',
    subtitle: 'Nền tảng giao dịch dân sự, đặt cọc và hợp đồng thuê tài sản',
    agency: 'Quốc hội nước CHXHCN Việt Nam',
    duration: 'Có hiệu lực từ ngày 01/01/2017',
    fee: 'Văn bản Luật Quốc gia',
    externalUrl:
      'https://vanban.chinhphu.vn/default.aspx?pageid=27160&docid=183188',
    icon: 'law',
    description:
      'Quy định về nguyên tắc tự do, tự nguyện giao kết hợp đồng (Điều 3), hình thức giao kết điện tử (Điều 119), biện pháp bảo đảm đặt cọc (Điều 328), và hợp đồng thuê tài sản (Điều 472-482).',
    dossierItems: [
      {
        title: 'Quy định về Đặt cọc (Điều 328)',
        detail:
          'Đặt cọc là việc một bên giao cho bên kia một khoản tiền để bảo đảm giao kết hoặc thực hiện hợp đồng. Nếu bên nhận cọc từ chối giao kết phải trả lại tiền cọc và khoản tiền tương đương tiền cọc (trừ thỏa thuận khác).',
      },
    ],
    steps: [
      {
        step: 1,
        title: 'Ký kết thỏa thuận đặt cọc & Hợp đồng',
        detail:
          'Bảo đảm quyền lợi song phương và cơ chế xử lý tiền cọc khi vi phạm hợp đồng.',
      },
    ],
    legalGrounds: [
      {
        title: 'Bộ luật Dân sự số 91/2015/QH13',
        article: 'Điều 119, 328, 472, 473, 474, 475, 480',
      },
    ],
    notes: [
      'Giao kết điện tử thông qua chữ ký số có giá trị pháp lý như giao kết bằng văn bản theo Điều 119.',
    ],
  },
  'e-transactions-law-2023': {
    id: 'e-transactions-law-2023',
    code: 'Luật GDĐT 2023',
    title: 'Luật Giao dịch điện tử số 20/2023/QH15',
    subtitle:
      'Giá trị pháp lý của chữ ký số, Smart Contract và thông điệp dữ liệu',
    agency: 'Quốc hội nước CHXHCN Việt Nam',
    duration: 'Có hiệu lực thi hành từ ngày 01/07/2024',
    fee: 'Văn bản Luật Quốc gia',
    externalUrl:
      'https://vanban.chinhphu.vn/default.aspx?pageid=27160&docid=208421',
    icon: 'digital',
    description:
      'Quy định về giá trị pháp lý của thông điệp dữ liệu có giá trị như văn bản gốc (Điều 9-10), giá trị chứng cứ của thông điệp dữ liệu (Điều 11), chữ ký điện tử an toàn / chữ ký số chuyên dùng (Điều 22-24).',
    dossierItems: [
      {
        title: 'Giá trị chứng cứ của Hợp đồng điện tử (Điều 11)',
        detail:
          'Thông điệp dữ liệu lưu trữ bảo đảm tính toàn vẹn (thông qua mã băm SHA-256 và Blockchain) có giá trị chứng cứ đầy đủ trước tòa án.',
      },
    ],
    steps: [
      {
        step: 1,
        title: 'Tạo mã băm SHA-256 nội dung hợp đồng',
        detail: 'Đảm bảo nội dung không bị sửa đổi sau khi các bên ký kết.',
      },
      {
        step: 2,
        title: 'Ký số e-Consent / Chữ ký số SmartCA',
        detail: 'Gắn định danh người ký và dấu thời gian Timestamp bất biến.',
      },
    ],
    legalGrounds: [
      {
        title: 'Luật Giao dịch điện tử số 20/2023/QH15',
        article: 'Điều 9, 10, 11, 22, 23, 24, 25',
      },
    ],
    notes: [
      'Hợp đồng ký số trên sàn TH-PropTech có giá trị chứng cứ pháp lý cao nhất và được pháp luật thừa nhận bảo hộ vô điều kiện.',
    ],
  },
  'residence-law-2020': {
    id: 'residence-law-2020',
    code: 'Luật Cư trú 2020',
    title: 'Luật Cư trú số 68/2020/QH14',
    subtitle:
      'Quy định quyền và nghĩa vụ cư trú, đăng ký tạm trú, lưu trú của công dân',
    agency: 'Quốc hội nước CHXHCN Việt Nam',
    duration: 'Có hiệu lực từ ngày 01/07/2021',
    fee: 'Văn bản Luật Quốc gia',
    externalUrl:
      'https://vanban.chinhphu.vn/default.aspx?pageid=27160&docid=202609',
    icon: 'residence',
    description:
      'Bãi bỏ hoàn toàn sổ hộ khẩu / sổ tạm trú giấy, chuyển đổi sang quản lý cư trú bằng công nghệ số trên Cơ sở dữ liệu quốc gia về dân cư và VNeID.',
    dossierItems: [
      {
        title: 'Nghĩa vụ đăng ký tạm trú trong 30 ngày (Điều 27)',
        detail:
          'Công dân đến sinh sống tại chỗ ở hợp pháp ngoài phạm vi đơn vị hành chính cấp xã nơi đã đăng ký thường trú từ 30 ngày trở lên phải đăng ký tạm trú.',
      },
    ],
    steps: [
      {
        step: 1,
        title: 'Khai báo trực tuyến qua VNeID',
        detail:
          'Thực hiện thủ tục 100% online không cần đến trực tiếp trụ sở công an.',
      },
    ],
    legalGrounds: [
      {
        title: 'Luật Cư trú số 68/2020/QH14',
        article: 'Điều 27, 28, 29, 30',
      },
    ],
    notes: [
      'Hành vi không đăng ký tạm trú đúng thời hạn có thể bị phạt tiền từ 500.000 đến 1.000.000 VNĐ theo Điều 9 Nghị định 144/2021/NĐ-CP.',
    ],
  },
  'circular-55-56-bca': {
    id: 'circular-55-56-bca',
    code: 'TT 55 & 56/2021/TT-BCA',
    title: 'Thông tư 55/2021/TT-BCA & 56/2021/TT-BCA',
    subtitle:
      'Hướng dẫn chi tiết thi hành Luật Cư trú và ban hành biểu mẫu CT01 - CT08',
    agency: 'Bộ Công an',
    duration: 'Có hiệu lực từ ngày 01/07/2021',
    fee: 'Văn bản Thông tư Bộ',
    externalUrl:
      'https://vanban.chinhphu.vn/default.aspx?pageid=27160&docid=209185',
    icon: 'residence',
    description:
      'Quy định biểu mẫu Tờ khai thay đổi thông tin cư trú (CT01), Giấy xác nhận thông tin về cư trú (CT07), Thông báo kết quả giải quyết cư trú (CT08).',
    dossierItems: [
      {
        title: 'Biểu mẫu CT01 điện tử',
        detail:
          'Mẫu biểu tiêu chuẩn áp dụng thống nhất trên Cổng DVC Bộ Công an.',
      },
    ],
    steps: [
      {
        step: 1,
        title: 'Kê khai mẫu CT01',
        detail:
          'Điền thông tin nơi đăng ký cư trú mới và ý kiến đồng ý của chủ hộ.',
      },
    ],
    legalGrounds: [
      {
        title: 'Thông tư số 56/2021/TT-BCA',
        article: 'Các điều khoản về biểu mẫu cư trú',
      },
    ],
    notes: [
      'Hệ thống TH-PropTech hỗ trợ tự động điền thông tin hợp đồng vào mẫu CT01.',
    ],
  },
  'tax-law-2019': {
    id: 'tax-law-2019',
    code: 'Luật Thuế & TT 40/2021',
    title: 'Luật Quản lý thuế số 38/2019/QH14 & Thông tư 40/2021/TT-BTC',
    subtitle:
      'Chính sách thuế GTGT và Thuế TNCN đối với hoạt động cho thuê nhà ở',
    agency: 'Quốc hội & Bộ Tài chính',
    duration: 'Áp dụng thường xuyên',
    fee: 'Văn bản Pháp luật Thuế',
    externalUrl:
      'https://vanban.chinhphu.vn/default.aspx?pageid=27160&docid=197312',
    icon: 'tax',
    description:
      'Quy định mức thuế suất: 5% thuế GTGT và 5% thuế TNCN (tổng 10%) tính trên doanh thu đối với cá nhân cho thuê BĐS có doanh thu vượt 100 triệu đồng/năm.',
    dossierItems: [
      {
        title: 'Ngưỡng doanh thu tính thuế 100 triệu/năm',
        detail:
          'Doanh thu từ 100 triệu đồng trở xuống trong năm dương lịch được miễn toàn bộ thuế.',
      },
    ],
    steps: [
      {
        step: 1,
        title: 'Khai thuế điện tử qua eTax',
        detail: 'Khai nộp hồ sơ theo quý hoặc theo kỳ thanh toán hợp đồng.',
      },
    ],
    legalGrounds: [
      {
        title: 'Thông tư số 40/2021/TT-BTC',
        article: 'Điều 4, Điều 9 (Phương pháp tính thuế cho thuê tài sản)',
      },
    ],
    notes: [
      'Bên thuê và bên cho thuê có thể thỏa thuận bên nào có trách nhiệm nộp thuế trong hợp đồng.',
    ],
  },
  'fire-safety-nd136': {
    id: 'fire-safety-nd136',
    code: 'PCCC & NĐ 136/2020',
    title: 'Luật PCCC & Nghị định 136/2020/NĐ-CP (sửa đổi bởi NĐ 50/2024)',
    subtitle:
      'Tiêu chuẩn an toàn Phòng cháy chữa cháy và Cứu nạn cứu hộ nhà chung cư',
    agency: 'Chính phủ / Cục Cảnh sát PCCC & CNCH',
    duration: 'Áp dụng bắt buộc đối với mọi tòa nhà chung cư',
    fee: 'Quy chuẩn An toàn Bắt buộc',
    externalUrl:
      'https://vanban.chinhphu.vn/default.aspx?pageid=27160&docid=201688',
    icon: 'fire',
    description:
      'Quy chuẩn an toàn bắt buộc: Trang bị bình chữa cháy bột/khí trong căn hộ, kiểm định hệ thống báo cháy tự động, không cản trở lối thoát nạn, tuân thủ an toàn sạc pin xe điện/xe máy điện.',
    dossierItems: [
      {
        title: 'Trang thiết bị PCCC cơ bản tại chỗ',
        detail:
          'Mỗi căn hộ phải có tối thiểu 01 bình chữa cháy xách tay đạt chuẩn và thiết bị báo khói hoạt động tốt.',
      },
    ],
    steps: [
      {
        step: 1,
        title: 'Kiểm tra hiện trạng PCCC khi nhận bàn giao',
        detail:
          'Kiểm tra chuông báo cháy, vòi phun Sprinkler, lối thoát hiểm ban công và bình chữa cháy.',
      },
    ],
    legalGrounds: [
      {
        title: 'Nghị định số 136/2020/NĐ-CP & Nghị định số 50/2024/NĐ-CP',
        article: 'Điều 5, Điều 7 (Điều kiện an toàn PCCC đối với nhà chung cư)',
      },
    ],
    notes: [
      'Nghiêm cấm sạc pin xe điện qua đêm không người trông coi tại hành lang hoặc trong căn hộ trái quy định ban quản lý tòa nhà.',
    ],
  },
  'circular-16-2014-bct': {
    id: 'circular-16-2014-bct',
    code: 'TT 16/2014/TT-BCT',
    title: 'Thông tư 16/2014/TT-BCT về thực hiện giá bán điện',
    subtitle:
      'Quy định áp giá bán lẻ điện sinh hoạt cho sinh viên và người lao động thuê nhà',
    agency: 'Bộ Công Thương',
    duration: 'Đã đối chiếu nội dung ngày 05/11/2026',
    fee: 'Văn bản quy phạm pháp luật',
    externalUrl:
      'https://hethongphapluat.com/thong-tu-16-2014-tt-bct-nam-2014-ve-thuc-hien-gia-ban-dien-do-bo-truong-bo-cong-thuong-ban-hanh.html',
    icon: 'law',
    description:
      'Điều 10 khoản 4 quy định cách tính điện cho sinh viên và người lao động thuê nhà (bên thuê nhà không phải là một hộ gia đình): cứ 4 người được tính là một hộ sử dụng điện để tính số định mức áp dụng giá bán lẻ điện sinh hoạt.',
    dossierItems: [
      {
        title: 'Cách tính định mức theo số người (Điều 10 khoản 4)',
        detail:
          'Cứ 4 người được tính là một hộ sử dụng điện; 1 người bằng 1/4 định mức, 2 người bằng 1/2 định mức.',
      },
      {
        title: 'Người ký hợp đồng mua điện (Điều 10 khoản 4)',
        detail:
          'Thời hạn thuê từ 12 tháng trở lên thì đại diện người thuê có thể ký; dưới 12 tháng thì chủ nhà ký trực tiếp.',
      },
    ],
    steps: [
      {
        step: 1,
        title: 'Thỏa thuận đơn giá trong hợp đồng',
        detail:
          'Trên TH-PropTech, đơn giá điện, nước và phí dịch vụ do hai bên thỏa thuận và ghi trong hợp đồng; hệ thống không tự áp bảng giá nhà nước.',
      },
    ],
    legalGrounds: [
      {
        title: 'Thông tư 16/2014/TT-BCT',
        article: 'Điều 10 khoản 4',
        url: 'https://hethongphapluat.com/thong-tu-16-2014-tt-bct-nam-2014-ve-thuc-hien-gia-ban-dien-do-bo-truong-bo-cong-thuong-ban-hanh.html',
      },
    ],
    notes: [
      'Tham khảo, chưa kiểm chứng phạm vi áp dụng: văn bản nói về sinh viên và người lao động thuê nhà, không nêu riêng căn hộ chung cư cho thuê.',
      'Nguồn đọc lại: hethongphapluat.com (ngày 05/11/2026). Thông tư 25/2018/TT-BCT sửa đổi Thông tư này chưa được đối chiếu nên chưa đưa vào.',
    ],
  },
  'building-rules-circ05': {
    id: 'building-rules-circ05',
    code: 'TT 05/2024/TT-BXD',
    title: 'Quy chế Quản lý Nhà chung cư (Thông tư 05/2024/TT-BXD)',
    subtitle:
      'Nội quy sử dụng diện tích chung/riêng, phí bảo trì 2% và quyền hạn Ban quản trị',
    agency: 'Bộ Xây dựng',
    duration:
      'Có hiệu lực từ ngày 01/08/2024 (thay thế Thông tư 02/2016/TT-BXD)',
    fee: 'Quy chuẩn Vận hành Tòa nhà',
    externalUrl:
      'https://vanban.chinhphu.vn/default.aspx?pageid=27160&docid=210819',
    icon: 'building',
    description:
      'Quy định chi tiết về quyền và nghĩa vụ của chủ sở hữu và người sử dụng nhà chung cư; quy chế hoạt động của Ban Quản trị, Ban Quản lý; nội quy giữ gìn an ninh trật tự, vệ sinh và tiếng ồn sau 22h00.',
    dossierItems: [
      {
        title: 'Nội quy quản lý sử dụng chung cư',
        detail:
          'Bản nội quy tòa nhà do Hội nghị nhà chung cư thông qua, người thuê nhà có nghĩa vụ tuân thủ 100%.',
      },
    ],
    steps: [
      {
        step: 1,
        title: 'Đăng ký cư dân với Ban Quản lý Tòa nhà',
        detail:
          'Nộp bản sao hợp đồng thuê để làm thẻ cư dân, thẻ thang máy và đăng ký vé gửi xe.',
      },
    ],
    legalGrounds: [
      {
        title: 'Thông tư số 05/2024/TT-BXD',
        article: 'Quy chế quản lý, sử dụng nhà chung cư ban hành kèm theo',
      },
    ],
    notes: [
      'Người thuê nhà không được phép tự ý thay đổi kết cấu chịu lực hoặc cơi nới diện tích căn hộ mà không có sự phê duyệt của chủ nhà và Ban Quản lý.',
    ],
  },
}

export const SEED_PLATFORM_REGULATIONS: Array<
  PlatformRegulationContent & {
    id: string
    linkedLegalKey?: string
    updatedAt?: string
  }
> = [
  {
    id: 'reg-residence-01',
    code: 'REG-RES-01',
    title: 'Bắt buộc đăng ký Tạm trú trực tuyến trong 30 ngày',
    summary:
      'Người thuê nhà có nghĩa vụ phối hợp cùng Chủ nhà thực hiện thủ tục đăng ký tạm trú trực tuyến trên Cổng DVC Bộ Công an hoặc app VNeID trong vòng 30 ngày kể từ ngày nhận bàn giao căn hộ.',
    category: 'residence',
    severity: 'mandatory',
    scope: ['all', 'apartment', 'serviced-apartment', 'villa-house', 'room'],
    linkedLegalKey: '1.004194',
    order: 1,
    isActive: true,
    isDefault: true,
    checklistItems: [
      {
        id: 'chk-ct01',
        label: 'Kê khai mẫu CT01 trực tuyến trên Cổng DVC BCA / VNeID',
        hint: 'Sử dụng tài khoản định danh VNeID mức 2 của người thuê',
      },
      {
        id: 'chk-contract-hash',
        label: 'Đính kèm bản Hợp đồng điện tử đã khóa SHA-256 từ TH-PropTech',
        hint: 'File PDF trích xuất từ mục Không gian hợp đồng',
      },
      {
        id: 'chk-owner-consent',
        label: 'Chủ nhà xác nhận đồng ý cho thuê trên hệ thống DVC',
        hint: 'Chủ nhà ký số xác nhận hoặc bấm phê duyệt trên VNeID',
      },
    ],
    updatedAt: '2026-09-23T20:00:00Z',
  },
  {
    id: 'reg-tax-02',
    code: 'REG-TAX-02',
    title: 'Kê khai thuế cho thuê tài sản đối với doanh thu > 100 triệu/năm',
    summary:
      'Chủ nhà hoặc Bên thuê (theo thỏa thuận hợp đồng) có trách nhiệm thực hiện kê khai thuế GTGT và thuế TNCN điện tử qua eTax khi tổng doanh thu cho thuê trong năm vượt quá 100.000.000 VNĐ.',
    category: 'tax-finance',
    severity: 'mandatory',
    scope: ['all', 'apartment', 'villa-house'],
    linkedLegalKey: '1.007689',
    order: 2,
    isActive: true,
    isDefault: true,
    checklistItems: [
      {
        id: 'chk-tax-declaration',
        label:
          'Nộp tờ khai mẫu 01/TTS kèm phụ lục hợp đồng trên thuedientu.gdt.gov.vn',
        hint: 'Áp dụng theo từng quý hoặc theo kỳ thanh toán',
      },
      {
        id: 'chk-tax-payment',
        label: 'Hoàn thành nộp số tiền thuế theo mã ID khoản nộp được cấp',
        hint: 'Thanh toán qua ứng dụng ngân hàng hoặc eTax Mobile',
      },
    ],
    updatedAt: '2026-09-23T20:00:00Z',
  },
  {
    id: 'reg-fire-03',
    code: 'REG-FIRE-03',
    title: 'Tiêu chuẩn an toàn PCCC & Kiểm soát sạc pin xe điện trong căn hộ',
    summary:
      'Nghiêm cấm tự ý câu móc điện, sạc pin xe máy điện/xe đạp điện qua đêm không người giám sát trong căn hộ. Căn hộ phải trang bị tối thiểu 01 bình chữa cháy và bảo đảm không chặn lối thoát hiểm ban công.',
    category: 'fire-safety',
    severity: 'mandatory',
    scope: ['all', 'apartment', 'serviced-apartment'],
    linkedLegalKey: 'fire-safety-nd136',
    order: 3,
    isActive: true,
    isDefault: true,
    checklistItems: [
      {
        id: 'chk-extinguisher',
        label:
          'Kiểm tra bình chữa cháy xách tay còn hạn sử dụng và áp suất chuẩn',
      },
      {
        id: 'chk-ev-charging',
        label:
          'Cam kết sạc xe điện tại khu vực quy hoạch chuyên dụng của tòa nhà',
      },
      {
        id: 'chk-balcony-clear',
        label:
          'Lối thoát nạn ban công / lô gia thông thoáng không có rào chắn cố định',
      },
    ],
    updatedAt: '2026-09-23T20:00:00Z',
  },
  {
    id: 'reg-bldg-04',
    code: 'REG-BLDG-04',
    title: 'Nội quy trật tự tiếng ồn và giờ giấc sinh hoạt chung cư sau 22h00',
    summary:
      'Tuân thủ tuyệt đối quy định về kiểm soát tiếng ồn, không mở nhạc công suất lớn hoặc khoan đục sau 22h00 đêm đến 06h00 sáng. Thực hiện đăng ký cư dân và thẻ thang máy với Ban Quản lý tòa nhà.',
    category: 'building-operations',
    severity: 'mandatory',
    scope: ['apartment', 'serviced-apartment'],
    linkedLegalKey: 'building-rules-circ05',
    order: 4,
    isActive: true,
    isDefault: true,
    checklistItems: [
      {
        id: 'chk-bldg-registration',
        label: 'Nộp hồ sơ đăng ký cư dân với BQL Tòa nhà trong 07 ngày',
      },
      {
        id: 'chk-noise-compliance',
        label:
          'Ký cam kết giữ gìn trật tự và không gây tiếng ồn ảnh hưởng căn hộ lân cận',
      },
    ],
    updatedAt: '2026-09-23T20:00:00Z',
  },
  {
    id: 'reg-digital-05',
    code: 'REG-DIGITAL-05',
    title: 'Giá trị pháp lý Hợp đồng số e-Consent & Mã băm SHA-256',
    summary:
      'Hợp đồng được giao kết trên nền tảng TH-PropTech có giá trị pháp lý tương đương văn bản giấy theo Luật Giao dịch điện tử 2023. Mã băm SHA-256 và nhật ký ký số Blockchain là bằng chứng bất biến.',
    category: 'digital-legal',
    severity: 'mandatory',
    scope: ['all'],
    linkedLegalKey: 'e-transactions-law-2023',
    order: 5,
    isActive: true,
    isDefault: true,
    checklistItems: [
      {
        id: 'chk-sha256-verify',
        label: 'Khóa mã băm toàn vẹn nội dung hợp đồng trước khi ký',
      },
      {
        id: 'chk-both-signed',
        label: 'Cả Bên thuê và Bên cho thuê hoàn tất chữ ký số e-Consent',
      },
    ],
    updatedAt: '2026-09-23T20:00:00Z',
  },
  {
    id: 'reg-deposit-06',
    code: 'REG-DEPOSIT-06',
    title: 'Quy chuẩn tiền Đặt cọc & Thời hạn hoàn cọc 07 ngày',
    summary: `Tiền đặt cọc do Chủ nhà giữ và hoàn trả trực tiếp cho Khách thuê; nền tảng không nhận, không giữ và không chuyển tiền cọc. Sau khi lập biên bản trả nhà và bảng khấu trừ cọc được Khách thuê chấp nhận (hoặc được xem là chấp nhận khi quá hạn phản hồi), Chủ nhà có nghĩa vụ hoàn trả tiền cọc trong ${DEPOSIT_REFUND_DUE_TEXT}.`,
    category: 'deposit-handover',
    severity: 'mandatory',
    scope: ['all'],
    linkedLegalKey: 'civil-code-2015',
    order: 6,
    isActive: true,
    isDefault: true,
    checklistItems: [
      {
        id: 'chk-deposit-receipt',
        label: 'Xác nhận nhận đủ tiền đặt cọc có chứng từ điện tử',
      },
      {
        id: 'chk-deposit-refund-term',
        label: `Cam kết hoàn cọc trong ${DEPOSIT_REFUND_DUE_TEXT} sau khi bảng khấu trừ cọc được chấp nhận`,
      },
    ],
    updatedAt: '2026-09-23T20:00:00Z',
  },
  {
    id: 'reg-handover-07',
    code: 'REG-HANDOVER-07',
    title: 'Biên bản bàn giao hiện trạng nội thất có ảnh chụp đối chứng',
    summary:
      'Hai bên bắt buộc lập Biên bản giao nhận căn hộ và trang thiết bị nội thất điện tử đính kèm hình ảnh hiện trạng rõ nét trước khi nhận chìa khóa.',
    category: 'deposit-handover',
    severity: 'mandatory',
    scope: ['all', 'apartment', 'villa-house'],
    linkedLegalKey: 'nd96-2024',
    order: 7,
    isActive: true,
    isDefault: true,
    checklistItems: [
      {
        id: 'chk-inventory-list',
        label: 'Kiểm kê danh mục tài sản và hiện trạng hoạt động',
      },
      {
        id: 'chk-photos-uploaded',
        label:
          'Tải lên bộ ảnh chụp hiện trạng đối chứng 4 góc phòng và đồng hồ điện/nước',
      },
    ],
    updatedAt: '2026-09-23T20:00:00Z',
  },
  {
    id: 'reg-sublease-08',
    code: 'REG-SUBLEASE-08',
    title: 'Nghiêm cấm cho thuê lại khi chưa có văn bản chấp thuận',
    summary:
      'Bên thuê không được phép chuyển nhượng hợp đồng hoặc cho bên thứ ba thuê lại một phần hay toàn bộ căn hộ nếu không có sự đồng ý trước bằng văn bản của Chủ nhà.',
    category: 'residence',
    severity: 'mandatory',
    scope: ['all', 'apartment', 'villa-house'],
    linkedLegalKey: 'housing-law-2023',
    order: 8,
    isActive: true,
    isDefault: true,
    checklistItems: [
      {
        id: 'chk-no-unauthorized-sublease',
        label:
          'Bên thuê cam kết chỉ sử dụng đúng mục đích ở cho các thành viên đăng ký',
      },
    ],
    updatedAt: '2026-09-23T20:00:00Z',
  },
  {
    id: 'reg-maint-09',
    code: 'REG-MAINT-09',
    title: 'Phân định chi phí bảo trì: Hao mòn tự nhiên vs. Lỗi sử dụng',
    summary:
      'Chủ nhà chịu trách nhiệm sửa chữa các hư hỏng kết cấu, hao mòn tự nhiên theo thời gian; Người thuê chịu trách nhiệm sửa chữa, bồi thường các hư hỏng do quá trình vận hành sai quy cách gây ra.',
    category: 'building-operations',
    severity: 'recommended',
    scope: ['all', 'apartment'],
    linkedLegalKey: 'nd96-2024',
    order: 9,
    isActive: true,
    isDefault: true,
    checklistItems: [
      {
        id: 'chk-maintenance-notice',
        label:
          'Thông báo sự cố hư hỏng cho Chủ nhà trong vòng 48h kể từ khi phát sinh',
      },
    ],
    updatedAt: '2026-09-23T20:00:00Z',
  },
  {
    id: 'reg-pet-10',
    code: 'REG-PET-10',
    title: 'Quy chuẩn nuôi thú cưng & Vệ sinh môi trường tòa nhà',
    summary:
      'Người thuê chỉ được nuôi thú cưng khi có sự cho phép của Chủ nhà và Nội quy tòa nhà; cam kết tiêm phòng dại đầy đủ, đeo rọ mõm khi ra hành lang và dọn dẹp vệ sinh.',
    category: 'building-operations',
    severity: 'recommended',
    scope: ['apartment', 'serviced-apartment'],
    linkedLegalKey: 'building-rules-circ05',
    order: 10,
    isActive: true,
    isDefault: true,
    checklistItems: [
      {
        id: 'chk-pet-vaccination',
        label: 'Có sổ tiêm phòng dại định kỳ hợp lệ của thú cưng',
      },
      {
        id: 'chk-pet-leash',
        label:
          'Cam kết đeo rọ mõm và sử dụng dây dắt khi ra khu vực sinh hoạt chung',
      },
    ],
    updatedAt: '2026-09-23T20:00:00Z',
  },
]

/** Nguồn thêm sau lần seed đầu: được bổ sung vào DB đã có dữ liệu khi khởi động. */
export const ADDED_SEED_SOURCE_KEYS: readonly string[] = [
  'circular-16-2014-bct',
]

/** Nguồn hiển thị mặc định trên panel hợp đồng (tương ứng `DVC_LINKS` cũ) */
export const SEED_CONTRACT_PANEL_KEYS: readonly string[] = [
  '1.004194',
  '1.007689',
  'housing-law-2023',
  'nd96-2024',
  'civil-code-2015',
]

/** Mã TTHC dạng `1.xxxxxx` là thủ tục; còn lại là văn bản pháp lý */
function kindOfKey(key: string): 'procedure' | 'legal_text' {
  return /^\d+\.\d+$/.test(key) ? 'procedure' : 'legal_text'
}

export type SeedLegalSource = LegalSourceContent & {
  key: string
  kind: 'procedure' | 'legal_text'
  showInContractPanel: boolean
  order: number
  isActive: boolean
  updatedBy: string
}

export type SeedPlatformRegulation = PlatformRegulationContent & {
  isDefault: boolean
  linkedSourceKey: string | null
  updatedBy: string
}

export function buildSeedLegalSources(): SeedLegalSource[] {
  return Object.values(SEED_LEGAL_SOURCES).map(({ id, ...content }, index) => ({
    ...content,
    key: id,
    kind: kindOfKey(id),
    showInContractPanel: SEED_CONTRACT_PANEL_KEYS.includes(id),
    order: index + 1,
    isActive: true,
    updatedBy: 'system-seed',
  }))
}

export function buildSeedPlatformRegulations(): SeedPlatformRegulation[] {
  return SEED_PLATFORM_REGULATIONS.map(reg => ({
    code: reg.code,
    title: reg.title,
    summary: reg.summary,
    category: reg.category,
    severity: reg.severity,
    scope: reg.scope,
    checklistItems: reg.checklistItems,
    order: reg.order,
    isActive: reg.isActive,
    isDefault: reg.isDefault ?? false,
    linkedSourceKey: reg.linkedLegalKey ?? null,
    updatedBy: 'system-seed',
  }))
}
