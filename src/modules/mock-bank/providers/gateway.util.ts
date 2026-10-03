import { createHmac, timingSafeEqual } from 'node:crypto'

export type GatewayFetchResponse = {
  ok: boolean
  status?: number
  json(): Promise<unknown>
}

/** HTTP status (null on transport failure) and parsed JSON body (null if none). */
export type GatewayReply = { status: number | null; body: unknown }
export type GatewayFetcher = (
  url: string,
  init: RequestInit
) => Promise<GatewayFetchResponse>

export function hmacHex(
  algorithm: 'sha256' | 'sha512',
  key: string,
  data: string
): string {
  return createHmac(algorithm, key).update(data, 'utf8').digest('hex')
}

/** Constant-time compare of two hex signatures (case-insensitive). */
export function sameSignature(received: string, expected: string): boolean {
  const left = Buffer.from(received.toLowerCase(), 'utf8')
  const right = Buffer.from(expected.toLowerCase(), 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

const VN_DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

type VnParts = Record<
  'year' | 'month' | 'day' | 'hour' | 'minute' | 'second',
  string
>

function vnParts(date: Date): VnParts {
  const parts = Object.fromEntries(
    VN_DATE_FORMAT.formatToParts(date).map(part => [part.type, part.value])
  )
  return {
    year: parts.year ?? '',
    month: parts.month ?? '',
    day: parts.day ?? '',
    hour: parts.hour ?? '',
    minute: parts.minute ?? '',
    second: parts.second ?? '',
  }
}

/** `yyyyMMddHHmmss` in Asia/Ho_Chi_Minh (VNPAY create/expire dates). */
export function formatVnTimestamp(date: Date): string {
  const p = vnParts(date)
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`
}

/** `yyMMdd` in Asia/Ho_Chi_Minh (ZaloPay app_trans_id prefix). */
export function formatVnShortDate(date: Date): string {
  const p = vnParts(date)
  return `${p.year.slice(2)}${p.month}${p.day}`
}

/** Positive integer VND amount, or null for anything else. */
export function parseVndAmount(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : value
  if (typeof text !== 'string' || !/^\d+$/.test(text)) return null
  const amount = Number(text)
  return Number.isSafeInteger(amount) ? amount : null
}

export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** First string value for a query/body key; arrays and non-strings are rejected. */
export function stringField(
  payload: Record<string, unknown>,
  key: string
): string | null {
  const value = payload[key]
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/**
 * POST to a gateway with a hard timeout. Error bodies are kept because
 * gateways (e.g. MoMo HTTP 400) explain rejections there; callers still
 * fail closed unless the body carries an explicit success code.
 */
export async function postToGateway(
  fetcher: GatewayFetcher,
  url: string,
  init: { headers: Record<string, string>; body: string },
  timeoutMs: number
): Promise<GatewayReply> {
  let response: GatewayFetchResponse
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return { status: null, body: null }
  }
  const status = response.status ?? (response.ok ? 200 : null)
  try {
    return { status, body: await response.json() }
  } catch {
    return { status, body: null }
  }
}

/** Short, secret-free description of a gateway field for logs. */
export function logField(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return typeof value === 'string' ? value.slice(0, 120) : 'none'
}
