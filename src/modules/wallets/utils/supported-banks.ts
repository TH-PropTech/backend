export const SUPPORTED_BANKS = [
  { code: 'VCB', name: 'Vietcombank' },
  { code: 'TCB', name: 'Techcombank' },
  { code: 'MB', name: 'MB Bank' },
  { code: 'ACB', name: 'ACB' },
  { code: 'BIDV', name: 'BIDV' },
  { code: 'CTG', name: 'VietinBank' },
  { code: 'VPB', name: 'VPBank' },
  { code: 'TPB', name: 'TPBank' },
  { code: 'STB', name: 'Sacombank' },
  { code: 'AGR', name: 'Agribank' },
  { code: 'MOCBANK', name: 'Ví Mộc (sandbox)' },
] as const

/** Mã ngân hàng của Ví Mộc sandbox: tiền của chủ nhà được trả thẳng vào tài khoản này. */
export const MOCBANK_BANK_CODE = 'MOCBANK'

/** Số tài khoản Ví Mộc gồm đúng 12 chữ số. */
export const MOCBANK_ACCOUNT_PATTERN = /^\d{12}$/

export type SupportedBankCode = (typeof SUPPORTED_BANKS)[number]['code']

export const SUPPORTED_BANK_CODES = SUPPORTED_BANKS.map(bank => bank.code)

export function findBank(
  code: string
): (typeof SUPPORTED_BANKS)[number] | undefined {
  return SUPPORTED_BANKS.find(bank => bank.code === code)
}

/** Bỏ dấu, đưa về chữ hoa, gộp khoảng trắng để so khớp tên chủ tài khoản. */
export function normalizeHolderName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/gi, 'D')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function maskAccountNumber(accountNumber: string): string {
  return `****${accountNumber.slice(-4)}`
}
