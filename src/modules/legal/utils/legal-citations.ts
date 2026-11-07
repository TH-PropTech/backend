/**
 * Căn cứ pháp lý dùng chung cho văn bản hợp đồng, chính sách, thông báo và bằng chứng (design D9).
 * Mọi nơi in hoặc lưu trích dẫn phải lấy từ file này để các văn bản không lệch nhau.
 *
 * Đã đối chiếu với văn bản gốc trên vanban.chinhphu.vn (xem design.md của change
 * add-rental-penalty-enforcement, mục D9):
 * - Luật Nhà ở 27/2023/QH15: khoản 1 Điều 170 (thỏa thuận thời hạn thuê, giá thuê), khoản 4
 *   Điều 172 (báo trước ít nhất 30 ngày khi đơn phương chấm dứt). Điều 130 là "Bảo trì nhà ở"
 *   và Điều 164 là công chứng, chứng thực; hai điều này không phải căn cứ của các nội dung trên.
 * - Bộ luật Dân sự 91/2015/QH13: Điều 328 (đặt cọc), Điều 357 (lãi chậm trả), Điều 468 (lãi suất).
 */

/** Thời hạn báo trước khi đơn phương chấm dứt hợp đồng thuê nhà ở. */
export const TERMINATION_NOTICE_BASIS = 'Khoản 4 Điều 172 Luật Nhà ở 2023'
export const TERMINATION_NOTICE_REFERENCE = `${TERMINATION_NOTICE_BASIS} (Luật số 27/2023/QH15)`

/** Các bên được tự thỏa thuận thời hạn thuê, giá thuê và hình thức trả tiền thuê. */
export const RENT_TERMS_FREEDOM_BASIS = 'Khoản 1 Điều 170 Luật Nhà ở 2023'

/** Lãi chậm trả theo mức các bên thỏa thuận trong hợp đồng, không vượt trần tại Điều 468. */
export const LATE_PAYMENT_AGREED_INTEREST_BASIS =
  'Điều 357 và Điều 468 Bộ luật Dân sự 2015'

/** Lãi chậm thực hiện nghĩa vụ trả tiền khi không có thỏa thuận: áp mức tại khoản 2 Điều 468 (10%/năm). */
export const LATE_PAYMENT_INTEREST_BASIS =
  'Điều 357 và khoản 2 Điều 468 Bộ luật Dân sự 2015'

/** Bên nhận cọc từ chối giao kết hoặc thực hiện hợp đồng: trả lại cọc và một khoản tương đương. */
export const WRONGFUL_TERMINATION_DEPOSIT_BASIS =
  'khoản 2 Điều 328 Bộ luật Dân sự 2015'
