import type { PayoutStatus } from '../schemas/payout.schema'

const REASON_MESSAGES: Record<string, string> = {
  NOT_CONFIGURED:
    'Hệ thống chuyển tiền chưa được cấu hình. Vui lòng liên hệ hỗ trợ.',
  GATEWAY_UNAVAILABLE:
    'Cổng chuyển tiền tạm thời không phản hồi. Hệ thống sẽ thử lại hoặc nhân viên sẽ hỗ trợ bạn.',
  TRANSFER_FAILED: 'Giao dịch chuyển tiền không thành công.',
  INSUFFICIENT_BALANCE:
    'Tài khoản nguồn của sàn không đủ số dư để chuyển tiền.',
  INSUFFICIENT_FUNDS: 'Tài khoản nguồn của sàn không đủ số dư để chuyển tiền.',
  PAYEE_NOT_FOUND: 'Không tìm thấy tài khoản nhận tiền đã liên kết của bạn.',
  PAYEE_INACTIVE:
    'Tài khoản nhận tiền của bạn đang bị khóa hoặc ngưng hoạt động.',
  INVALID_PAYEE: 'Tài khoản nhận tiền của bạn không hợp lệ.',
}

const GENERIC_FAILURE =
  'Giao dịch chuyển tiền không thành công. Vui lòng liên hệ hỗ trợ.'

/** Câu tiếng Việt thân thiện cho trạng thái/lý do payout (hiển thị cho chủ nhà). */
export function humanizePayoutReason(
  status: PayoutStatus,
  failureReason: string | null
): string {
  if (status === 'awaiting-wallet') return 'Bạn chưa liên kết ví nhận tiền.'
  if (status === 'pending') return 'Khoản tiền đang chờ xử lý.'
  if (status === 'paid-out') return 'Đã chuyển tiền thành công.'
  if (!failureReason) return GENERIC_FAILURE
  return REASON_MESSAGES[failureReason.toUpperCase()] ?? GENERIC_FAILURE
}
