import type { FlowProfileSteps } from './schemas/rental-flow-profile.schema'

export const SAFE_DEFAULT_FLOW_PROFILE_ID = 'safe-default-profile'

export const DEFAULT_FLOW_PROFILE_STEPS: FlowProfileSteps = {
  step1: {
    moveInDateLabel: 'Ngày vào ở dự kiến *',
    moveInDateHelpText:
      'Vui lòng chọn ngày chuyển vào ở thực tế để thiết lập mốc tính tiền thuê.',
    minMoveInLeadDays: 0,
    maxMoveInLeadDays: 90,
    occupantsLabel: 'Số lượng người ở thực tế *',
    occupantsHelpText:
      'Quy chuẩn nhà chung cư: bình quân tối thiểu 8 m²/người theo Điều 29 Luật Nhà ở 2023.',
    minOccupants: 1,
    maxOccupants: 10,
    enforceDensityWarning: true,
    occupationLabel: 'Nghề nghiệp & Lĩnh vực hoạt động *',
    occupationPlaceholder: 'Nhập nghề nghiệp hoặc bấm chọn nhanh bên dưới...',
    occupationRequired: true,
    allowedOccupationSuggestions: [
      'Công nghệ thông tin',
      'Tài chính - Ngân hàng',
      'Kỹ sư / Kiến trúc',
      'Y tế / Bác sĩ',
      'Kinh doanh / Marketing',
      'Giáo dục / Giảng viên',
      'Sinh viên đại học',
      'Tự do / Freelancer',
    ],
    petsAllowedToggleVisible: true,
    petsLabel: 'Có mang theo thú cưng (chó, mèo...) không?',
    petsBylawsNotice:
      'Căn hộ thuộc chung cư có nội quy nghiêm ngặt: Vui lòng đảm bảo tiêm phòng dại và giữ vệ sinh khu vực sinh hoạt chung.',
    notesLabel: 'Ghi chú & Thỏa thuận riêng (Tùy chọn)',
    notesPlaceholder:
      'Nêu mong muốn về thiết bị, giờ giấc bàn giao hoặc yêu cầu riêng cho chủ nhà...',
    notesMaxLength: 1000,
    notesSuggestions: [
      'Yêu cầu hỗ trợ thủ tục đăng ký tạm trú',
      'Muốn thuê thêm chỗ đậu xe ô tô',
      'Đề nghị kiểm kê nội thất trước 02 ngày',
      'Mong muốn bàn giao vào cuối tuần',
    ],
  },
  step2: {
    headerTitle: 'Lựa chọn gói thuê & Điều khoản đặt cọc',
    headerSubtitle:
      'Giá thuê được niêm yết minh bạch, cố định trong suốt kỳ hạn cam kết. Tiền cọc được bảo đảm theo khung pháp lý quy định.',
    depositNoticeTitle:
      'Bảo vệ quyền lợi tiền cọc theo Điều 12 Nghị định 96/2024/NĐ-CP',
    depositNoticeBody:
      'Tiền đặt cọc được giữ an toàn để bảo đảm nghĩa vụ hợp đồng. Bên cho thuê có trách nhiệm hoàn trả 100% tiền cọc cho Bên thuê trong vòng 15 ngày làm việc kể từ thời điểm chấm dứt hợp đồng hợp lệ.',
    highlightLongTermPackages: true,
    showSubtotalEstimate: true,
    paymentScheduleHelpText:
      'Kỳ thanh toán định kỳ: Từ ngày 01 đến ngày 05 đầu mỗi kỳ hạn thanh toán qua chuyển khoản ngân hàng.',
    badgeRules: [
      {
        durationMonths: 12,
        badgeText: 'Phổ biến nhất',
        colorVariant: 'primary',
      },
      { durationMonths: 6, badgeText: 'Linh hoạt', colorVariant: 'accent' },
      { durationMonths: 3, badgeText: 'Ngắn hạn', colorVariant: 'success' },
    ],
  },
  step3: {
    headerTitle: 'Quy chế pháp lý & Cam kết trách nhiệm',
    headerSubtitle:
      'Vui lòng đọc kỹ các điều khoản dịch vụ, an toàn PCCC và xác nhận cam kết trước khi gửi hồ sơ chính thức cho chủ nhà.',
    termsReferenceKey: 'canonical',
    disclosures: [
      {
        id: 'listing-terms',
        title: 'Thông tin căn hộ và gói thuê',
        body: 'Thông tin căn hộ, thời hạn, tiền thuê và tiền cọc được chốt theo gói đang được phê duyệt tại thời điểm gửi hồ sơ.',
        required: true,
        immutablePolicy: true,
      },
      {
        id: 'pre-contract-request',
        title: 'Đây là yêu cầu thuê trước hợp đồng',
        body: 'Hồ sơ này chỉ là yêu cầu để chủ nhà xem xét, chưa phải hợp đồng thuê và chưa làm phát sinh nghĩa vụ ký kết.',
        required: true,
        immutablePolicy: true,
      },
      {
        id: 'future-payment-and-signing',
        title: 'Các bước cọc, thanh toán và ký',
        body: 'Nếu được chấp thuận, hệ thống mới mở thỏa thuận cọc, thanh toán qua provider sandbox và quy trình ký theo trạng thái hợp đồng.',
        required: true,
        immutablePolicy: true,
      },
    ],
    legalAccordions: [
      {
        id: 'pccc',
        title: '1. Quy chuẩn An toàn Phòng cháy Chữa cháy (PCCC) & Trật tự',
        lawReference:
          'Quy chế quản lý, sử dụng nhà chung cư (Thông tư 05/2024/TT-BXD)',
        summary:
          'Bên thuê có nghĩa vụ chấp hành nghiêm chỉnh nội quy an toàn PCCC, không tích trữ hóa chất dễ cháy nổ.',
        details: [
          'Không che chắn hoặc làm hỏng đầu báo khói, đầu phun sprinkler trong căn hộ.',
          'Tuyệt đối không đốt vàng mã, than củi tại ban công, lô gia hoặc hành lang chung cư.',
          'Đảm bảo hành lang thoát hiểm và cửa sổ thoát hiểm luôn thông thoáng.',
        ],
      },
      {
        id: 'civil-law',
        title: '2. Quy định Pháp luật về Hợp đồng thuê tài sản',
        lawReference: 'Bộ luật Dân sự 2015 & Luật Kinh doanh Bất động sản 2023',
        summary:
          'Hợp đồng thuê căn hộ số xác lập quyền và nghĩa vụ hợp pháp giữa bên thuê và bên cho thuê.',
        details: [
          'Bên thuê được bảo đảm quyền sử dụng ổn định trong suốt thời hạn hợp đồng.',
          'Bên cho thuê không được tự ý tăng giá thuê ngoài thỏa thuận đã ký kết.',
          'Việc chấm dứt hợp đồng trước hạn phải thông báo trước tối thiểu 30 ngày.',
        ],
      },
      {
        id: 'residence-dvc',
        title: '3. Quy định Đăng ký Tạm trú & Thủ tục Dịch vụ công',
        lawReference: 'Luật Cư trú 2020 & Dịch vụ công trực tuyến mã số 6007',
        summary:
          'Hệ thống hỗ trợ trích xuất hợp đồng số để hoàn tất thủ tục đăng ký tạm trú trực tuyến.',
        details: [
          'Hợp đồng số có giá trị pháp lý làm căn cứ chứng minh chỗ ở hợp pháp.',
          'Chủ nhà có nghĩa vụ phối hợp và cung cấp thông tin phục vụ thủ tục khai báo cư trú.',
        ],
      },
    ],
    consentCheckboxLabel:
      'Tôi xác nhận đã đọc, hiểu rõ và chấp thuận Quy chế thuê nhà cùng các quy định an toàn PCCC nêu trên.',
    consentStatement:
      'Tôi cam đoan toàn bộ thông tin kê khai trong hồ sơ là chính xác. Tôi đồng ý rằng sau khi chủ nhà phê duyệt và hai bên ký số, bản cam kết cùng mã băm hợp đồng sẽ được lưu trữ bất biến trên hệ thống blockchain.',
  },
  step4: {
    heroSuccessTitle: 'Hồ sơ đặt thuê đã được gửi thành công',
    heroSuccessMessage:
      'Yêu cầu thuê căn hộ của bạn đã được ghi nhận. Chủ nhà sẽ xem xét và phản hồi trước khi hợp đồng số chính thức được khởi tạo.',
    timelineSteps: [
      {
        step: 1,
        title: 'Hồ sơ đã được gửi',
        desc: 'Yêu cầu thuê đã được lưu trữ an toàn trong cơ sở dữ liệu hệ thống.',
      },
      {
        step: 2,
        title: 'Chủ nhà xét duyệt',
        desc: 'Chủ nhà sẽ đối chiếu thông tin và phản hồi phê duyệt trong vòng 24 - 48 giờ.',
      },
      {
        step: 3,
        title: 'Khởi tạo & Ký số hợp đồng',
        desc: 'Hệ thống tự động lập hợp đồng số theo Phụ lục II NĐ 96/2024 để hai bên ký số qua eKYC/OTP.',
      },
      {
        step: 4,
        title: 'Đăng ký tạm trú trực tuyến',
        desc: 'Sử dụng hợp đồng số đã kích hoạt để đăng ký tạm trú theo thủ tục Dịch vụ công 6007.',
      },
    ],
    decree96ReferenceVisible: true,
    customNoticeTitle: 'Ghi nhận sổ cái Hyperledger Fabric',
    customNoticeBody:
      'Ở giai đoạn nộp hồ sơ ứng tuyển, dữ liệu được bảo mật ngoài chuỗi (off-chain). Khi chủ nhà phê duyệt và hai bên hoàn tất ký số sinh trắc học, mã băm toàn vẹn của hợp đồng và snapshot cam kết mới được neo vĩnh viễn lên blockchain.',
    ctaBackText: 'Quay lại chi tiết căn hộ',
    ctaFollowUpText: 'Theo dõi tiến trình hồ sơ của tôi',
  },
}
