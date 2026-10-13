import { createHash } from 'node:crypto'

/**
 * Chuỗi hoá JSON ổn định (key đã sắp xếp), dùng để băm SHA-256 xác định
 * (deterministic) không phụ thuộc thứ tự thuộc tính object. Dùng chung cho
 * mọi envelope bằng chứng ledger (signed-contract v1/v2/v3, governance,
 * move-in settlement, move-in handover) — KHÔNG đổi thuật toán này, vì sẽ
 * làm lệch hash của bằng chứng đã neo trước đó.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  const entries = Object.keys(record)
    .filter(key => record[key] !== undefined)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
  return `{${entries.join(',')}}`
}

export function sha256Hex(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}
