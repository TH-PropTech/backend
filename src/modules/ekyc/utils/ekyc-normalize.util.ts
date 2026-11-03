export type JsonRecord = Record<string, unknown>

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readText(fields: JsonRecord, key: string): string {
  const value = fields[key]
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

/** Accepts DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY and YYYY-MM-DD; returns DD/MM/YYYY or ''. */
export function normalizeDate(value: string): string {
  const text = value.trim()
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text)
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  const [day, month, year] = dmy
    ? [dmy[1], dmy[2], dmy[3]]
    : ymd
      ? [ymd[3], ymd[2], ymd[1]]
      : [undefined, undefined, undefined]
  if (!day || !month || !year) return ''
  const d = Number(day)
  const m = Number(month)
  if (d < 1 || d > 31 || m < 1 || m > 12) return ''
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${year}`
}

export function normalizeGender(value: string): string {
  const folded = value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (folded.startsWith('nu') || folded === 'female') return 'Nữ'
  if (folded.startsWith('nam') || folded === 'male') return 'Nam'
  return ''
}
