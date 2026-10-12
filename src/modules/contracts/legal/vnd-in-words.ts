const DIGITS = [
  'không',
  'một',
  'hai',
  'ba',
  'bốn',
  'năm',
  'sáu',
  'bảy',
  'tám',
  'chín',
] as const

const UNITS = ['', 'nghìn', 'triệu', 'tỷ'] as const

/** Đọc một nhóm ba chữ số (0–999); `full` = có đọc "không trăm" khi nhóm không phải nhóm đầu. */
function readTriple(value: number, full: boolean): string {
  const hundreds = Math.floor(value / 100)
  const tens = Math.floor((value % 100) / 10)
  const ones = value % 10
  const parts: string[] = []

  if (hundreds > 0 || full) parts.push(`${DIGITS[hundreds]} trăm`)

  if (tens > 1) {
    parts.push(`${DIGITS[tens]} mươi`)
    if (ones === 1) parts.push('mốt')
    else if (ones === 4) parts.push('tư')
    else if (ones === 5) parts.push('lăm')
    else if (ones > 0) parts.push(DIGITS[ones] as string)
  } else if (tens === 1) {
    parts.push('mười')
    if (ones === 5) parts.push('lăm')
    else if (ones > 0) parts.push(DIGITS[ones] as string)
  } else if (ones > 0) {
    if (hundreds > 0 || full) parts.push('lẻ')
    parts.push(DIGITS[ones] as string)
  }
  return parts.join(' ')
}

/**
 * Số tiền đồng đọc bằng chữ tiếng Việt, vd. 500000 → "năm trăm nghìn đồng".
 * Chỉ nhận số nguyên không âm; giá trị không hợp lệ trả về chuỗi rỗng để không in sai.
 */
export function vndInWords(amount: number | null | undefined): string {
  if (
    amount === null ||
    amount === undefined ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    !Number.isInteger(amount) ||
    amount > 999_999_999_999
  ) {
    return ''
  }
  if (amount === 0) return 'không đồng'

  const groups: number[] = []
  let rest = amount
  while (rest > 0) {
    groups.push(rest % 1000)
    rest = Math.floor(rest / 1000)
  }

  const parts: string[] = []
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index] as number
    if (group === 0) continue
    const isLeading = index === groups.length - 1
    parts.push(`${readTriple(group, !isLeading)} ${UNITS[index] ?? ''}`.trim())
  }
  return `${parts.join(' ').replace(/\s+/g, ' ').trim()} đồng`
}
