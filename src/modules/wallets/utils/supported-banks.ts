/** Mã ngân hàng của Ví Mộc sandbox: tiền của chủ nhà được trả thẳng vào tài khoản này. */
export const MOCBANK_BANK_CODE = 'MOCBANK'

/** Số tài khoản Ví Mộc gồm đúng 12 chữ số. */
export const MOCBANK_ACCOUNT_PATTERN = /^\d{12}$/

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

/** Thương hiệu ví mô phỏng trên cùng một tài khoản Ví Mộc (API dùng chữ thường). */
export const WALLET_BRANDS = ['mocbank', 'momo', 'zalopay', 'vnpay'] as const
export type WalletBrand = (typeof WALLET_BRANDS)[number]
