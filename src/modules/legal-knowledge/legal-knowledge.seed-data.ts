import type { LegalDocCategory } from './legal-knowledge.types'

export interface LegalSeedEntry {
  url: string
  title: string
  category: LegalDocCategory
  docNumber?: string
  issuer?: string
  keywords: string[]
  /** Nội dung có sẵn (thu thập bằng trình duyệt thật); khi có thì bỏ qua bước tải link. */
  content?: string
}

/**
 * Nguồn công khai tải được không cần đăng nhập (caselaw.vn và các cổng của Chính phủ).
 * thuvienphapluat.vn và luatvietnam.vn chặn truy cập tự động nên không đưa vào đây.
 */
export const LEGAL_SEED_ENTRIES: LegalSeedEntry[] = [
  {
    url: 'https://caselaw.vn/van-ban-phap-luat/115605-bo-luat-dan-su-so-91-2015-qh13-ngay-24-11-2015-cua-quoc-hoi',
    title: 'Bộ luật Dân sự 2015',
    category: 'luat',
    docNumber: '91/2015/QH13',
    issuer: 'Quốc hội',
    keywords: [
      'hợp đồng thuê tài sản',
      'thuê nhà',
      'đặt cọc',
      'bồi thường thiệt hại',
      'chấm dứt hợp đồng',
      'Điều 472',
    ],
  },
  {
    url: 'https://caselaw.vn/van-ban-phap-luat/411478-luat-nha-o-so-27-2023-qh15-ngay-27-11-2023-cua-quoc-hoi',
    title: 'Luật Nhà ở 2023',
    category: 'luat',
    docNumber: '27/2023/QH15',
    issuer: 'Quốc hội',
    keywords: [
      'thuê nhà ở',
      'hợp đồng thuê nhà ở',
      'nhà chung cư',
      'quyền và nghĩa vụ bên thuê',
      'nhà ở cho thuê',
    ],
  },
  {
    url: 'https://caselaw.vn/van-ban-phap-luat/411479-luat-kinh-doanh-bat-dong-san-so-29-2023-qh15-ngay-28-11-2023-cua-quoc-hoi',
    title: 'Luật Kinh doanh bất động sản 2023',
    category: 'luat',
    docNumber: '29/2023/QH15',
    issuer: 'Quốc hội',
    keywords: [
      'kinh doanh bất động sản',
      'cho thuê bất động sản',
      'môi giới bất động sản',
      'sàn giao dịch',
    ],
  },
  {
    url: 'https://caselaw.vn/van-ban-phap-luat/372271-luat-cu-tru-68-2020-qh14-ngay-13-11-2020-cua-quoc-hoi',
    title: 'Luật Cư trú 2020',
    category: 'luat',
    docNumber: '68/2020/QH14',
    issuer: 'Quốc hội',
    keywords: [
      'đăng ký tạm trú',
      'đăng ký thường trú',
      'lưu trú',
      'khai báo cư trú',
      'chỗ ở hợp pháp',
    ],
  },
  {
    url: 'https://caselaw.vn/van-ban-phap-luat/334543-luat-quan-ly-thue-so-38-2019-qh14-ngay-13-06-2019-cua-quoc-hoi',
    title: 'Luật Quản lý thuế 2019',
    category: 'luat',
    docNumber: '38/2019/QH14',
    issuer: 'Quốc hội',
    keywords: [
      'đăng ký thuế',
      'mã số thuế',
      'khai thuế',
      'nộp thuế',
      'xử lý vi phạm thuế',
    ],
  },
  {
    url: 'https://caselaw.vn/van-ban-phap-luat/462015-van-ban-hop-nhat-so-03-vbhn-vpqh-ngay-16-09-2024-cua-bo-truong-van-phong-quoc-hoi-hop-nhat-luat-thue-thu-nhap-ca-nhan',
    title: 'Văn bản hợp nhất Luật Thuế thu nhập cá nhân',
    category: 'luat',
    docNumber: '03/VBHN-VPQH',
    issuer: 'Văn phòng Quốc hội',
    keywords: [
      'thuế thu nhập cá nhân',
      'thu nhập từ cho thuê tài sản',
      'giảm trừ gia cảnh',
    ],
  },
  {
    url: 'https://xaydungchinhsach.chinhphu.vn/noi-dung-moi-cua-nghi-dinh-68-2026-nd-cp-va-thong-tu-18-2026-tt-btc-nguoi-nop-thue-can-luu-y-119260312140920747.htm',
    title:
      'Nội dung mới của Nghị định 68/2026/NĐ-CP và Thông tư 18/2026/TT-BTC người nộp thuế cần lưu ý',
    category: 'faq',
    issuer: 'Cổng thông tin Chính phủ',
    keywords: [
      'Thông tư 18/2026',
      'thuế hộ kinh doanh',
      'kê khai thuế',
      'chính sách mới 2026',
      'luật thuê căn hộ',
      'thuê căn hộ 2026',
      'thay đổi so với năm trước',
      'quy định mới 2026',
    ],
  },
  {
    url: 'https://xaydungchinhsach.chinhphu.vn/chinh-sach-moi-ve-thue-voi-ho-ca-nhan-cho-thue-bat-dong-san-119260312092953897.htm',
    title: 'Chính sách thuế mới đối với hộ, cá nhân cho thuê bất động sản',
    category: 'faq',
    issuer: 'Cổng thông tin Chính phủ',
    keywords: [
      'thuế cho thuê bất động sản',
      'thông báo doanh thu',
      'cá nhân cho thuê nhà',
      'chính sách mới 2026',
      'luật thuê căn hộ',
      'thuê căn hộ 2026',
      'chủ nhà cho thuê căn hộ',
      'thay đổi so với năm trước',
    ],
  },
  {
    url: 'https://portal.mof.gov.vn/hoidapcstc/home/cthoidap/162333',
    title:
      'Hỏi đáp tính thuế TNCN hộ kinh doanh mới năm 2026 (Nghị định 68/2026)',
    category: 'faq',
    issuer: 'Bộ Tài chính',
    keywords: ['hỏi đáp thuế', 'hộ kinh doanh', 'Nghị định 68/2026'],
  },
  {
    url: 'https://xaydungchinhsach.chinhphu.vn/nghi-dinh-so-54-2026-nd-cp-quy-dinh-moi-ve-mua-ban-thue-mua-cho-thue-gia-nha-o-xa-hoi-119260220165054643.htm',
    title:
      'Nghị định 54/2026/NĐ-CP quy định mới về mua bán, thuê mua, cho thuê, giá nhà ở xã hội',
    category: 'nghi-dinh',
    docNumber: '54/2026/NĐ-CP',
    issuer: 'Chính phủ',
    keywords: [
      'nhà ở xã hội',
      'thuê nhà ở xã hội',
      'giá thuê',
      'chính sách mới 2026',
    ],
  },
  {
    url: 'https://xaydungchinhsach.chinhphu.vn/mau-hop-dong-thue-nha-o-119240827172441217.htm',
    title: 'Mẫu hợp đồng thuê nhà ở',
    category: 'hop-dong-mau',
    issuer: 'Cổng thông tin Chính phủ',
    keywords: [
      'mẫu hợp đồng thuê nhà',
      'hợp đồng thuê nhà ở',
      'Nghị định 96/2024',
    ],
  },
  {
    url: 'https://caselaw.vn/hop-dong-mau/PGH8yCGWpW/hop-dong-thue-nha-tenancy-contract',
    title: 'Mẫu hợp đồng thuê nhà (song ngữ)',
    category: 'hop-dong-mau',
    issuer: 'Caselaw Việt Nam',
    keywords: ['mẫu hợp đồng thuê nhà', 'tenancy contract', 'đặt cọc'],
  },
  {
    url: 'https://xaydungchinhsach.chinhphu.vn/mot-loat-quy-dinh-moi-ve-dat-dai-nha-o-bat-dong-san-vien-chuc-co-hieu-luc-tu-thang-8-2024-119240801133133359.htm',
    title:
      'Quy định mới về đất đai, nhà ở, bất động sản có hiệu lực từ tháng 8/2024',
    category: 'faq',
    issuer: 'Cổng thông tin Chính phủ',
    keywords: [
      'hiệu lực 01/8/2024',
      'Luật Nhà ở',
      'Luật Đất đai',
      'bất động sản',
      'luật thuê căn hộ',
      'thay đổi so với năm trước',
    ],
  },
  {
    url: 'https://hatinh.gov.vn/vi/bai-viet/dang-ky-tam-tru-online-qua-vneid-theo-quy-dinh-moi',
    title: 'Đăng ký tạm trú online qua VNeID theo quy định mới',
    category: 'thu-tuc',
    issuer: 'Cổng thông tin điện tử Hà Tĩnh',
    keywords: [
      'đăng ký tạm trú online',
      'VNeID',
      'dịch vụ công',
      'cổng dịch vụ công quốc gia',
    ],
  },
  {
    url: 'https://hcc.nghean.gov.vn/tin-tong-hop/nhung-quy-dinh-moi-trong-tam-trong-luat-nha-o-2023-911.html',
    title: 'Những quy định mới, trọng tâm trong Luật Nhà ở 2023',
    category: 'faq',
    issuer: 'Trung tâm Phục vụ hành chính công Nghệ An',
    keywords: [
      'Luật Nhà ở 2023',
      'điểm mới',
      'thuê nhà ở',
      'luật thuê căn hộ',
      'thuê căn hộ',
      'thay đổi so với năm trước',
    ],
  },
  {
    url: 'https://tapchikinhtetaichinh.vn/nha-o-cho-thue-lan-dau-tien-co-hanh-lang-phap-ly-rieng-167302.html',
    title: 'Nhà ở cho thuê lần đầu tiên có hành lang pháp lý riêng',
    category: 'khac',
    issuer: 'Tạp chí Kinh tế - Tài chính',
    keywords: [
      'nhà ở cho thuê',
      'dự thảo Luật Nhà ở sửa đổi',
      'chính sách mới 2026',
      'luật thuê căn hộ',
      'thuê căn hộ 2026',
      'thay đổi so với năm trước',
      'quy định mới 2026',
      'dự thảo chưa có hiệu lực',
    ],
  },
  {
    url: 'https://caselaw.vn/van-ban-phap-luat/461100-van-ban-hop-nhat-so-08-vbhn-bct-ngay-07-04-2023-cua-bo-truong-bo-cong-thuong-hop-nhat-nghi-dinh-huong-dan-luat-bao-ve-quyen-loi-nguoi-tieu-dung',
    title:
      'Văn bản hợp nhất Nghị định hướng dẫn Luật Bảo vệ quyền lợi người tiêu dùng',
    category: 'nghi-dinh',
    docNumber: '08/VBHN-BCT',
    issuer: 'Bộ Công Thương',
    keywords: ['bảo vệ người tiêu dùng', 'khiếu nại', 'hợp đồng theo mẫu'],
  },
  {
    url: 'https://xaydungchinhsach.chinhphu.vn/toan-van-luat-dat-dai-119240221224513596.htm',
    title: 'Luật Đất đai 2024',
    category: 'luat',
    docNumber: '31/2024/QH15',
    issuer: 'Quốc hội',
    keywords: [
      'đất đai',
      'quyền sử dụng đất',
      'giấy chứng nhận quyền sử dụng đất',
      'sổ đỏ',
      'thu hồi đất',
      'tranh chấp đất đai',
    ],
  },
  {
    url: 'https://conganthanhhoa.gov.vn/de-an-06/huong-dan-dang-ky-thuong-tru-dang-ky-tam-tru-qua-dich-vu-cong-truc-tuyen.html',
    title: 'Hướng dẫn đăng ký thường trú, tạm trú qua dịch vụ công trực tuyến',
    category: 'thu-tuc',
    issuer: 'Công an tỉnh Thanh Hóa',
    keywords: [
      'đăng ký thường trú',
      'đăng ký tạm trú',
      'dịch vụ công trực tuyến',
      'Đề án 06',
    ],
  },
  {
    url: 'https://conganthanhhoa.gov.vn/phong-chong-toi-pham/quan-ly-hanh-chinh-ve-trat-tu-xa-hoi/huong-dan-dang-ky-thuong-tru-tam-tru-tren-ung-dung-vneid.html',
    title: 'Hướng dẫn đăng ký thường trú, tạm trú trên ứng dụng VNeID',
    category: 'thu-tuc',
    issuer: 'Công an tỉnh Thanh Hóa',
    keywords: [
      'VNeID',
      'đăng ký tạm trú',
      'đăng ký thường trú',
      'định danh điện tử',
    ],
  },
  {
    url: 'https://xaydungchinhsach.chinhphu.vn/huong-dan-thu-tuc-khai-thue-doi-voi-ca-nhan-cho-thue-bat-dong-san-truc-tiep-khai-thue-voi-co-quan-thue-119260530073744188.htm',
    title:
      'Hướng dẫn thủ tục khai thuế đối với cá nhân cho thuê bất động sản trực tiếp khai thuế với cơ quan thuế',
    category: 'thu-tuc',
    issuer: 'Cổng Xây dựng chính sách, pháp luật (Báo điện tử Chính phủ)',
    keywords: [
      'khai thuế cho thuê nhà',
      'cơ quan thuế',
      'hồ sơ khai thuế',
      'chính sách mới 2026',
    ],
  },
  {
    url: 'https://xaydungchinhsach.chinhphu.vn/huong-dan-ho-ca-nhan-cho-thue-bat-dong-san-ke-khai-thue-tren-cong-trai-nghiem-tai-ung-dung-etax-mobile-119251203120554504.htm',
    title:
      'Hướng dẫn hộ, cá nhân cho thuê bất động sản kê khai thuế trên ứng dụng eTax Mobile',
    category: 'thu-tuc',
    issuer: 'Cổng Xây dựng chính sách, pháp luật (Báo điện tử Chính phủ)',
    keywords: [
      'eTax Mobile',
      'kê khai thuế online',
      'cho thuê bất động sản',
      'dịch vụ công thuế',
    ],
  },
  {
    url: 'https://xaydungchinhsach.chinhphu.vn/cuc-thue-huong-dan-ke-khai-thue-voi-hoat-dong-cho-thue-bat-dong-san-119260317154243038.htm',
    title:
      'Cục Thuế hướng dẫn kê khai thuế với hoạt động cho thuê bất động sản',
    category: 'thu-tuc',
    issuer:
      'Cục Thuế (Bộ Tài chính), đăng trên Cổng Xây dựng chính sách, pháp luật',
    keywords: [
      'Cục Thuế hướng dẫn',
      'kê khai thuế',
      'cho thuê bất động sản',
      'chính sách mới 2026',
      'thuê căn hộ 2026',
      'chủ nhà cho thuê căn hộ',
      'quy định mới 2026',
    ],
  },
  {
    url: 'https://xaydungchinhsach.chinhphu.vn/huong-dan-ho-kinh-doanh-ke-khai-thue-khi-vua-cho-thue-bat-dong-san-vua-cho-thue-tai-san-119260323160131075.htm',
    title:
      'Hướng dẫn hộ kinh doanh kê khai thuế khi vừa cho thuê bất động sản vừa cho thuê tài sản',
    category: 'thu-tuc',
    issuer: 'Cổng Xây dựng chính sách, pháp luật (Báo điện tử Chính phủ)',
    keywords: [
      'hộ kinh doanh',
      'cho thuê tài sản',
      'kê khai thuế',
      'chính sách mới 2026',
    ],
  },
  {
    url: 'https://congchung6.gov.vn/vi/service/quy-trinh-13-cong-chung-hop-dong-cho-thue-nha-c201,159.aspx',
    title: 'Quy trình công chứng hợp đồng cho thuê nhà (Phòng Công chứng số 6)',
    category: 'thu-tuc',
    issuer: 'Phòng Công chứng số 6, TP. Hồ Chí Minh',
    keywords: [
      'công chứng hợp đồng thuê nhà',
      'hồ sơ công chứng',
      'phí công chứng',
      'thời hạn công chứng',
    ],
  },
]
