/** Hạn hoàn cọc sau khi bảng khấu trừ được chấp nhận: 07 ngày theo lịch (không phải ngày làm việc). */
export const DEPOSIT_REFUND_DUE_DAYS = 7

/**
 * Lãi chủ nhà chậm hoàn cọc (%/năm). Hợp đồng chỉ thỏa thuận lãi cho Bên thuê, nên với Bên cho thuê
 * áp mức luật định: 50% của trần 20%/năm tại khoản 1 Điều 468 theo khoản 2 Điều 468 BLDS 2015.
 */
export const DEPOSIT_REFUND_LATE_INTEREST_RATE_PER_YEAR = 10

/** Số ngày khách phản hồi biên bản trả nhà / bảng khấu trừ khi gói thuê cũ chưa có `moveOutPolicy`. */
export const DEFAULT_MOVE_OUT_RESPONSE_DAYS = 3

export const MIN_MOVE_OUT_RESPONSE_DAYS = 1
export const MAX_MOVE_OUT_RESPONSE_DAYS = 15

/** Chữ in vào hợp đồng và văn bản pháp lý, ví dụ "07 (bảy) ngày". */
export const DEPOSIT_REFUND_DUE_TEXT = '07 (bảy) ngày'
