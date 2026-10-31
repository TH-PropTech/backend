import { DEPOSIT_REFUND_DUE_TEXT } from '../../rental/utils/deposit-refund.constants'
import type { LegalDocCategory } from './legal-knowledge.types'

export interface PlatformFaqEntry {
  title: string
  category: LegalDocCategory
  keywords: string[]
  /** Markdown: each `##` section becomes its own searchable passage. */
  content: string
}

/** Issuer shown in the citations of these documents. */
export const PLATFORM_FAQ_ISSUER = 'TH-PropTech'

/**
 * TH-PropTech's own rules and how-tos, written from what the system really does (code and specs), not
 * from the law. Facts that differ between sources are stated the way the signed contract template
 * states them. Anything the platform has not decided (platform fee amounts, reminders for viewings,
 * rescheduling) is said plainly instead of guessed.
 *
 * Seeded as drafts: an admin reviews the wording and publishes (see scripts: `seed-legal-knowledge --faq`).
 */
export const PLATFORM_FAQ_ENTRIES: PlatformFaqEntry[] = [
  {
    title: 'Quy trình thuê căn hộ trên TH-PropTech',
    category: 'faq',
    keywords: [
      'quy trình thuê',
      'các bước thuê',
      'thuê căn hộ',
      'hồ sơ thuê',
      'ký hợp đồng',
      'đặt cọc',
      'bàn giao',
    ],
    content: `## Tổng quan các bước
Quy trình thuê căn hộ trên TH-PropTech gồm: tìm căn hộ, đặt lịch xem (không bắt buộc), nộp hồ sơ thuê, chủ nhà duyệt, hoàn thiện và ký hợp đồng điện tử, thanh toán tiền cọc, bàn giao căn hộ, rồi thanh toán tiền thuê theo kỳ. Hiện nền tảng áp dụng thứ tự ký hợp đồng trước, đặt cọc sau.

## Bước 1. Tìm căn hộ và xem trước
Khách tìm căn hộ theo khu vực, mức giá, số phòng ngủ. Chỉ các tin đã được nhân viên duyệt mới hiển thị công khai. Ảnh 360 độ và liên kết thực tế ảo VR do nhân viên hoặc quản trị viên cập nhật cho từng căn, chủ nhà không tự tải lên phần này.

## Bước 2. Đặt lịch xem nhà (không bắt buộc)
Khách có thể đặt lịch xem trực tiếp hoặc xem qua video. Chủ căn hộ là người xác nhận lịch. Nộp hồ sơ thuê không bắt buộc phải có lịch xem trước.

## Bước 3. Nộp hồ sơ thuê
Khách chọn gói thuê (thời hạn 3, 6, 12 hoặc 24 tháng), ngày dọn vào (không được ở quá khứ), số người ở từ 1 đến 10 và ghi chú tối đa 1000 ký tự. Không thể nộp thêm hồ sơ khi đang có hồ sơ chờ duyệt cho cùng căn hộ.

## Bước 4. Chủ nhà duyệt hồ sơ
Chủ nhà chấp nhận hoặc từ chối hồ sơ. Màn hình thường ghi dự kiến phản hồi trong 24 đến 48 giờ, đây là thời gian dự kiến, hệ thống không tự ép hạn này. Khi chủ nhà chấp nhận, hệ thống tạo thỏa thuận đặt cọc và bản nháp hợp đồng thuê.

## Bước 5. Hoàn thiện và ký hợp đồng điện tử
Nhân viên và chủ nhà hoàn thiện điều khoản, sau đó nội dung hợp đồng được khóa để ký. Cả khách thuê và chủ nhà phải hoàn tất xác thực danh tính (eKYC) trước khi ký. Mỗi bên tự ký phần của mình, nhân viên không ký thay.

## Bước 6. Thanh toán tiền cọc
Sau khi hợp đồng được ký, khách thanh toán tiền cọc qua cổng thanh toán. Hợp đồng có hiệu lực khi cả hai bên đã ký và tiền cọc đã được thanh toán.

## Bước 7. Bàn giao và thanh toán định kỳ
Hai bên lập biên bản bàn giao (ngày giờ, chỉ số điện nước, số chìa khóa hoặc thẻ, tình trạng căn hộ) và cùng xác nhận. Sau đó căn hộ được ghi nhận là đang cho thuê và hệ thống lập lịch hóa đơn tiền thuê theo kỳ.`,
  },
  {
    title: 'Đặt lịch xem căn hộ trên TH-PropTech',
    category: 'faq',
    keywords: [
      'đặt lịch xem',
      'xem nhà',
      'lịch hẹn',
      'hủy lịch',
      'video call',
      'xác nhận lịch',
    ],
    content: `## Cách đặt lịch xem
Khách chọn căn hộ rồi đặt lịch xem trực tiếp tại căn hộ hoặc xem qua video call, chọn ngày và khung giờ (sáng, chiều hoặc tối), để lại họ tên và số điện thoại. Có thể đặt lịch mà không cần đăng nhập, nhưng phải để lại họ tên và số điện thoại. Chủ nhà không thể đặt lịch xem căn hộ của chính mình.

## Ai xác nhận lịch xem
Chủ của căn hộ là người xác nhận hoặc từ chối lịch, nhân viên không xác nhận thay. Khi từ chối, chủ nhà phải nhập lý do. Khách nhận thông báo trong ứng dụng khi lịch được xác nhận, bị từ chối hoặc hoàn thành. Trạng thái lịch gồm: chờ xác nhận, đã xác nhận, bị từ chối, đã hủy, đã xem.

## Hủy hoặc đổi lịch
Khách chỉ được hủy lịch do chính mình đặt, khi lịch còn ở trạng thái chờ xác nhận hoặc đã xác nhận. Hệ thống không thu phí hủy lịch xem và không quy định thời hạn báo trước. Hiện chưa có chức năng đổi giờ, muốn đổi thì hủy lịch cũ rồi đặt lịch mới.

## Nhắc lịch
Hệ thống gửi thông báo trong ứng dụng khi có lịch mới hoặc khi lịch đổi trạng thái. Hiện chưa có nhắc lịch tự động trước giờ xem, khách nên tự ghi nhớ giờ hẹn.`,
  },
  {
    title: 'Đặt cọc trên TH-PropTech',
    category: 'faq',
    keywords: [
      'đặt cọc',
      'tiền cọc',
      'hoàn cọc',
      'mất cọc',
      'cọc giữ chỗ',
      'thỏa thuận đặt cọc',
      'thanh toán cọc',
    ],
    content: `## Mức tiền cọc
Mức cọc không cố định chung cho cả nền tảng mà do chủ nhà đặt trong gói thuê của từng căn hộ: bằng một số tháng tiền thuê (từ 1 đến 12 tháng) hoặc một số tiền cố định. Khách xem đúng số tiền cọc của căn hộ trong thỏa thuận đặt cọc trước khi thanh toán.

## Cọc giữ chỗ
Một số gói cho phép chia tiền cọc: khách trả trước một phần (cọc giữ chỗ), phần còn lại trả khi quyết toán nhận nhà. Số tiền phải lớn hơn 0 và không vượt tổng tiền cọc.

## Quy trình thanh toán cọc
Khách phải đồng ý với đúng phiên bản thỏa thuận đặt cọc trước khi thanh toán. Chủ nhà không thanh toán cọc. Khách thanh toán qua cổng thanh toán được bật trên hệ thống. Ở môi trường thử nghiệm (demo) hệ thống dùng Mock Bank mô phỏng, không phải giao dịch tiền thật. Mỗi lần thanh toán có thời hạn hiệu lực mặc định 15 phút, hết hạn khách có thể tạo lại lần thanh toán mới mà không cần đồng ý lại.

## Nền tảng không giữ hộ tiền cọc
Theo điều khoản dịch vụ, nền tảng không giữ hộ tiền cọc. Tiền cọc được chuyển trực tiếp đến tài khoản ngân hàng đã liên kết của chủ nhà. Khách nhận biên nhận điện tử có mã biên nhận và mã băm để đối chiếu.

## Khi nào được hoàn lại cọc
Theo mẫu hợp đồng thuê hiện hành, tiền cọc do chủ nhà giữ và được hoàn trả trực tiếp cho bên thuê, nền tảng không nhận, không giữ và không chuyển tiền cọc. Khi bên thuê trả nhà, chủ nhà lập biên bản trả nhà rồi bảng khấu trừ cọc (lý do, số tiền và chứng từ từng khoản). Bên thuê có số ngày phản hồi đã ghi trong hợp đồng để chấp nhận hoặc phản đối; quá hạn mà không phản hồi thì được xem là chấp nhận. Sau đó chủ nhà hoàn cọc trong ${DEPOSIT_REFUND_DUE_TEXT} theo lịch, sau khi trừ tiền thuê, chi phí dịch vụ còn nợ và thiệt hại có chứng từ hợp lệ, rồi ghi nhận "đã hoàn" trên hệ thống để bên thuê xác nhận đã nhận. Bản ghi "đã hoàn" là lời khai của chủ nhà được bên thuê xác nhận, nền tảng không bảo đảm khoản tiền. Tiền cọc không tự động bù vào tiền thuê hàng tháng, trừ khi hai bên có thỏa thuận bằng văn bản. Nếu hai bên không thống nhất, mỗi bên có thể yêu cầu ghi nhận tranh chấp trên hệ thống; nền tảng không phân xử, hãy liên hệ nhân viên hỗ trợ.

## Khi nào mất cọc
Theo hợp đồng thuê và Điều 328 Bộ luật Dân sự 2015: bên thuê từ chối ký hợp đồng hoặc chấm dứt trái quy định thì mất tiền cọc. Bên cho thuê từ chối ký hoặc chấm dứt trái quy định thì phải trả lại tiền cọc và bồi thường một khoản tương đương tiền cọc.

## Hủy thỏa thuận đặt cọc
Thỏa thuận đặt cọc có thể bị hủy khi chưa thanh toán. Sau khi cọc đã thanh toán và được áp dụng vào hợp đồng thì không hủy theo cách này.`,
  },
  {
    title: 'Hợp đồng thuê và ký điện tử trên TH-PropTech',
    category: 'faq',
    keywords: [
      'hợp đồng thuê',
      'ký điện tử',
      'chữ ký số',
      'SmartCA',
      'Smart OTP',
      'chấm dứt hợp đồng',
      'gia hạn',
      'phụ lục',
    ],
    content: `## Hợp đồng được tạo như thế nào
Khi chủ nhà chấp nhận hồ sơ thuê, hệ thống tạo bản nháp hợp đồng theo mẫu của nền tảng, lấy thời hạn, giá thuê và tiền cọc từ gói thuê đã chọn. Nhân viên hoặc chủ nhà chỉnh các điều khoản thương mại khi hợp đồng còn là bản nháp. Sau đó nội dung được khóa bằng mã xác thực nội dung rồi mới đến bước ký.

## Cách ký điện tử
Mỗi bên tự ký phần của mình, nhân viên không ký thay. Người ký phải đã xác thực danh tính (eKYC) thành công. Các cách ký đang bật mặc định: ký bằng SmartCA của VNPT (duyệt trên ứng dụng SmartCA, nền tảng không lưu mật khẩu hay mã OTP của SmartCA) và ký bằng xác thực khuôn mặt cùng Smart OTP của TH-PropTech. Mã Smart OTP có hiệu lực 5 phút và được nhập sai tối đa 3 lần.

## Khi nào hợp đồng có hiệu lực
Hợp đồng có hiệu lực khi cả hai bên đã ký và tiền cọc đã được thanh toán. Khi đó hệ thống lập lịch hóa đơn tiền thuê.

## Gia hạn
Hệ thống không tự động gia hạn. Muốn gia hạn, bên thuê báo bằng văn bản trước khi hết hạn theo số ngày ghi trong hợp đồng và hai bên thỏa thuận bằng văn bản, bên thuê được ưu tiên thuê tiếp.

## Chấm dứt hợp đồng trước hạn
Theo mẫu hợp đồng, bên cho thuê được đơn phương chấm dứt khi bên thuê chậm thanh toán quá 15 ngày sau khi đã được nhắc bằng văn bản, sử dụng sai mục đích, cho thuê lại trái phép, làm hư hại nghiêm trọng hoặc vi phạm nghiêm trọng nội quy. Bên thuê được chấm dứt khi bên cho thuê không bàn giao, không bảo đảm sử dụng ổn định hoặc tự ý tăng giá thuê. Các trường hợp chấm dứt trước hạn khác phải báo trước bằng văn bản theo số ngày ghi trong hợp đồng (mặc định 30 ngày). Trên hệ thống chỉ nhân viên hoặc quản trị viên ghi nhận việc chấm dứt hợp đồng đang hiệu lực, vì vậy khách cần liên hệ nhân viên hỗ trợ.

## Thay đổi sau khi đã ký
Mọi thay đổi sau khi ký được lập bằng phụ lục theo phiên bản, cần cả hai bên đồng ý và ký, chỉ có hiệu lực từ thời điểm sau đó và không sửa các kỳ đã thanh toán.

## Cho thuê lại
Bên thuê không được cho thuê lại nếu chưa có văn bản đồng ý của bên cho thuê.`,
  },
  {
    title: 'Thanh toán tiền thuê và hóa đơn trên TH-PropTech',
    category: 'faq',
    keywords: [
      'thanh toán tiền thuê',
      'hóa đơn',
      'hạn thanh toán',
      'trả chậm',
      'nhắc thanh toán',
      'biên nhận',
      'cổng thanh toán',
    ],
    content: `## Lịch hóa đơn tiền thuê
Khi hợp đồng có hiệu lực, hệ thống lập sẵn các hóa đơn tiền thuê theo chu kỳ 1, 3 hoặc 6 tháng tùy gói thuê (số tiền bằng tiền thuê một tháng nhân số tháng của chu kỳ). Hạn thanh toán là ngày thanh toán ghi trong hợp đồng; nếu tháng không có ngày đó thì lấy ngày cuối tháng. Mỗi kỳ chỉ có một hóa đơn.

## Cách thanh toán
Khách thanh toán trên hệ thống qua cổng thanh toán được bật (Mock Bank mô phỏng ở môi trường demo; VNPAY, MoMo, ZaloPay khi được cấu hình). Nền tảng không có ví chứa tiền: khách không nạp tiền vào ví nền tảng. Mỗi hóa đơn đã thanh toán có biên nhận điện tử kèm mã băm SHA-256. Chủ nhà nhận tiền qua tài khoản ngân hàng đã liên kết.

## Nhắc thanh toán và quá hạn
Hệ thống được thiết kế gửi một thông báo nhắc trong ứng dụng trước hạn thanh toán 7 ngày và đánh dấu hóa đơn quá hạn khi qua hạn chưa thanh toán; tính năng này phụ thuộc cấu hình triển khai, nên khách nên chủ động theo dõi hạn thanh toán trên trang hóa đơn.

## Chậm thanh toán
Hợp đồng quy định lãi chậm trả theo tỷ lệ phần trăm một năm ghi trong hợp đồng, không vượt mức trần theo Điều 468 Bộ luật Dân sự 2015. Hệ thống không tự tính hay tự thu tiền phạt, hai bên thực hiện theo hợp đồng. Bên cho thuê có quyền chấm dứt hợp đồng khi bên thuê chậm thanh toán quá 15 ngày sau khi đã được nhắc bằng văn bản.

## Thanh toán trùng hoặc muộn
Nếu một khoản được thanh toán hai lần, hệ thống không tự động hoàn mà ghi nhận để nhân viên xử lý. Khách cần liên hệ nhân viên hỗ trợ.

## Thuế khi cho thuê
Trách nhiệm kê khai và nộp thuế từ hoạt động cho thuê thuộc về bên cho thuê theo hợp đồng.`,
  },
  {
    title: 'Xác thực danh tính eKYC trên TH-PropTech',
    category: 'faq',
    keywords: [
      'eKYC',
      'KYC',
      'xác thực danh tính',
      'CCCD',
      'căn cước',
      'định danh điện tử',
      'xác minh tài khoản',
    ],
    content: `## eKYC là gì và ai phải làm
eKYC là bước xác thực danh tính điện tử bằng căn cước công dân (CCCD). Người sẽ ký hợp đồng, cả khách thuê và chủ nhà, phải hoàn tất eKYC; chưa xác thực thì không ký được hợp đồng. Xem căn hộ và nộp hồ sơ thuê không đòi hỏi eKYC.

## Cần chuẩn bị gì
Ảnh mặt trước và mặt sau CCCD còn hiệu lực, mỗi ảnh tối đa 5 MB, chụp rõ nét. Hệ thống đọc tự động các thông tin như số CCCD, họ tên, ngày sinh để người dùng kiểm tra lại trước khi gửi.

## Các bước thực hiện
Tải ảnh mặt trước và mặt sau CCCD, kiểm tra thông tin hệ thống đọc được, rồi xác nhận gửi hồ sơ. Hồ sơ chuyển sang trạng thái chờ duyệt để nhân viên xem xét. Trạng thái gồm: chưa bắt đầu, chờ duyệt, đã xác thực, bị từ chối. Nếu bị từ chối, nhân viên ghi rõ lý do và khách có thể gửi lại hồ sơ.

## Khuôn mặt khi ký hợp đồng
Khi ký hợp đồng bằng phương thức sinh trắc, người ký được đối chiếu khuôn mặt với giấy tờ. Nếu đối chiếu khuôn mặt không đạt thì không ký được và khách thử lại.

## Bảo mật ảnh giấy tờ
Ảnh CCCD là dữ liệu riêng tư, chỉ chủ tài khoản và nhân viên được phân quyền mới xem được. Tài khoản đã xác thực thành công không phải gửi lại hồ sơ. Thông tin cá nhân và giấy tờ không được ghi lên blockchain.`,
  },
  {
    title: 'Blockchain và mã băm hợp đồng trên TH-PropTech',
    category: 'faq',
    keywords: [
      'blockchain',
      'hash',
      'mã băm',
      'SHA-256',
      'Hyperledger Fabric',
      'xác minh hợp đồng',
      'lưu vết',
      'toàn vẹn',
    ],
    content: `## Blockchain dùng để làm gì
TH-PropTech dùng Hyperledger Fabric để lưu vết bất biến mã băm (SHA-256) của hợp đồng đã ký và của các giao dịch liên quan như tiền cọc, thanh toán, phụ lục, chấm dứt, quyết toán nhận nhà và bàn giao. Blockchain không lưu nội dung hợp đồng, chỉ lưu mã băm và dữ liệu tối thiểu, nên không chứa họ tên, số CCCD, địa chỉ, chữ ký hay mã OTP.

## Mã băm hợp đồng là gì
Mã băm là dãy ký tự được tính từ toàn bộ nội dung hợp đồng. Chỉ cần sửa một ký tự thì mã băm thay đổi hoàn toàn, nhờ đó phát hiện được hợp đồng đã bị chỉnh sửa sau khi ký.

## Cách kiểm tra hợp đồng
Ở trang hợp đồng, nhấn nút xác minh tính toàn vẹn. Hệ thống so mã băm của bản hợp đồng hiện tại với mã băm đã lưu vết. Nếu khớp, hệ thống báo nội dung toàn vẹn. Nếu lệch, hệ thống cảnh báo nội dung đã bị thay đổi so với bản gốc. Khách thuê và chủ nhà thấy cùng một bằng chứng, gồm mã giao dịch, số khối, thời điểm ghi và mã băm.

## Khi blockchain tạm thời không khả dụng
Giao dịch nghiệp vụ (ký, thanh toán) vẫn hoàn tất bình thường, việc ghi lên blockchain được xếp hàng và thử lại sau. Trong lúc đó trạng thái lưu vết hiển thị là đang chờ hoặc tạm thời không khả dụng, hệ thống không báo xác nhận khi chưa có.

## Không có trên blockchain
Việc xác thực eKYC, lịch xem nhà, tin đăng và dữ liệu cá nhân không được ghi lên blockchain. Ở môi trường thử nghiệm (demo) hệ thống có thể chạy chế độ mô phỏng thay vì mạng Fabric thật và giao diện hiển thị rõ chế độ này.`,
  },
  {
    title: 'Tài khoản và bảo mật trên TH-PropTech',
    category: 'faq',
    keywords: [
      'đăng ký tài khoản',
      'đăng nhập',
      'quên mật khẩu',
      'mật khẩu',
      'xác thực hai lớp',
      '2FA',
      'Smart OTP',
      'mã PIN',
      'vai trò',
    ],
    content: `## Đăng ký tài khoản
Đăng ký bằng email, số điện thoại, mật khẩu, họ tên và chọn vai trò khách thuê hoặc chủ nhà. Hệ thống gửi mã OTP 6 chữ số về email, có hiệu lực 5 phút và chỉ dùng một lần. Email và số điện thoại không được trùng với tài khoản khác. Một tài khoản dùng được cho cả việc đi thuê và việc cho thuê. Tài khoản nhân viên và quản trị viên do hệ thống cấp, không tự đăng ký.

## Đăng nhập
Đăng nhập bằng email và mật khẩu. Phiên đăng nhập được tự động làm mới trong 7 ngày. Tài khoản bị tạm khóa hoặc ngừng hoạt động thì không đăng nhập được, khi đó liên hệ nhân viên hỗ trợ.

## Quên mật khẩu
Chọn quên mật khẩu, nhập email để nhận mã OTP 6 chữ số có hiệu lực 5 phút, rồi nhập mã cùng mật khẩu mới.

## Xác thực hai lớp
Có thể bật xác thực hai lớp bằng ứng dụng authenticator (quét mã QR) và nhận 10 mã dự phòng. Tài khoản đã bật xác thực hai lớp cũng có thể đăng nhập bằng mã từ ứng dụng thay cho mật khẩu.

## Smart OTP và mã PIN
Smart OTP gắn với một thiết bị tin cậy, mặc định mỗi tài khoản một thiết bị. Mã PIN gồm đúng 6 chữ số. Đổi PIN cần PIN cũ và xác thực Smart OTP, đặt lại PIN cần xác thực Smart OTP. Smart OTP dùng để xác nhận giao dịch và ký hợp đồng. Mỗi phiên OTP có hiệu lực 5 phút và cho nhập sai tối đa 3 lần.`,
  },
  {
    title: 'Phí dịch vụ của TH-PropTech',
    category: 'faq',
    keywords: [
      'phí',
      'phí dịch vụ',
      'hoa hồng',
      'phí nền tảng',
      'phí môi giới',
      'VAT',
    ],
    content: `## Biểu phí
Biểu phí nền tảng (phí hoa hồng thu từ chủ nhà theo thời hạn thuê, phí dịch vụ thu từ khách thuê, thuế VAT) do quản trị viên công bố theo từng phiên bản sau khi đã rà soát pháp lý. Mức phí cụ thể được hiển thị minh bạch tại bước nộp hồ sơ thuê và trước khi xác nhận, khách chỉ thấy phần phí của mình. Khi chưa có biểu phí nào được công bố thì chưa phát sinh phí nền tảng.

## Cách thu phí
Phí nền tảng được lập hóa đơn riêng, không bị trừ vào tiền cọc hay tiền thuê. Phí hoa hồng của chủ nhà được lập khi hợp đồng có hiệu lực. Phí dịch vụ của khách thuê nằm trong khoản quyết toán nhận nhà hoặc hóa đơn riêng. Biểu phí đã áp dụng cho một hồ sơ không thay đổi khi nền tảng công bố biểu phí mới.`,
  },
]
