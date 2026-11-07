import type { Payment } from '../schemas/payment.schema'

/** Chaincode ABI đầu tiên nhận tham số `periodStart` của `recordPayment`. */
const PERIOD_START_MIN_ABI_VERSION = 3

type PaymentLedgerArgsInput = Pick<
  Payment,
  'contractId' | 'amount' | 'type' | 'periodStart'
> & { _id: { toHexString(): string }; paymentHash: string }

/**
 * Args của chaincode `recordPayment`, dùng chung cho mọi đường chuyển hóa đơn sang `paid`.
 * Fabric ép đúng số tham số của hàm chaincode: ABI 3 luôn nhận 5 tham số, ABI cũ nhận 4.
 * Tham số thứ 5 là ngày bắt đầu kỳ của hóa đơn `rent` (để ledger chặn kỳ sau ngày hợp đồng
 * chấm dứt); hóa đơn khác truyền chuỗi rỗng, chaincode bỏ qua kiểm kỳ.
 */
export function buildPaymentLedgerArgs(
  payment: PaymentLedgerArgsInput,
  chaincodeAbiVersion: number
): string[] {
  const args = [
    payment._id.toHexString(),
    payment.contractId,
    payment.amount.toString(),
    payment.paymentHash,
  ]
  if (chaincodeAbiVersion >= PERIOD_START_MIN_ABI_VERSION) {
    const isRent = (payment.type ?? 'rent') === 'rent'
    args.push(
      isRent && payment.periodStart ? payment.periodStart.toISOString() : ''
    )
  }
  return args
}
