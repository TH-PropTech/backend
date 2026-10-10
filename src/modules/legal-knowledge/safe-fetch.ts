import { lookup as dnsLookup } from 'node:dns/promises'

export type SafeFetchErrorCode =
  | 'BLOCKED'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'BAD_TYPE'
  | 'HTTP'
  | 'NETWORK'

export class SafeFetchError extends Error {
  constructor(
    message: string,
    readonly code: SafeFetchErrorCode,
    readonly status?: number
  ) {
    super(message)
    this.name = 'SafeFetchError'
  }
}

export interface FetchPageOptions {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  lookup?: (host: string) => Promise<string[]>
  fetchImpl?: typeof fetch
}

export interface FetchedPage {
  finalUrl: string
  html: string
  status: number
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_BYTES = 3_000_000
const DEFAULT_MAX_REDIRECTS = 3
const ALLOWED_PORTS = new Set([80, 443])
const ALLOWED_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'text/plain',
])
const USER_AGENT = 'Mozilla/5.0 (compatible; TH-PropTechBot/1.0)'

/**
 * Returns true when `ip` (IPv4 or IPv6 literal) is loopback, private, link-local,
 * multicast, reserved or otherwise not a public unicast address. Unparseable
 * input is treated as private (fail closed).
 */
export function isPrivateAddress(ip: string): boolean {
  const candidate =
    ip
      .trim()
      .replace(/^\[|\]$/g, '')
      .split('%')[0] ?? ''
  if (candidate.includes(':')) return isPrivateIPv6(candidate)

  const v4 = parseIPv4(candidate)
  return v4 === null ? true : isPrivateIPv4(v4)
}

function parseIPv4(ip: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!match) return null
  const octets = match.slice(1).map(Number)
  return octets.every(o => o >= 0 && o <= 255) ? octets : null
}

function isPrivateIPv4(octets: number[]): boolean {
  const [a, b, c] = octets
  if (a === undefined || b === undefined || c === undefined) return true
  return (
    a === 0 || // 0.0.0.0/8 "this" network
    a === 10 || // 10/8 private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 carrier-grade NAT
    (a === 169 && b === 254) || // link-local (incl. cloud metadata 169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12 private
    (a === 192 && b === 0 && c === 0) || // 192.0.0/24 IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // 192.0.2/24 TEST-NET-1
    (a === 192 && b === 168) || // 192.168/16 private
    (a === 198 && (b === 18 || b === 19)) || // 198.18/15 benchmarking
    (a === 198 && b === 51 && c === 100) || // 198.51.100/24 TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // 203.0.113/24 TEST-NET-3
    a >= 224 // multicast 224/4 and reserved 240/4 (incl. broadcast)
  )
}

function isPrivateIPv6(ip: string): boolean {
  const groups = expandIPv6(ip)
  if (!groups) return true

  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] =
    groups

  // IPv4-mapped ::ffff:a.b.c.d, IPv4-compatible ::a.b.c.d (deprecated) and NAT64 64:ff9b::/96:
  // the embedded IPv4 address is what matters.
  const allZeroTo5 = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0
  if (allZeroTo5 && (g5 === 0 || g5 === 0xffff)) {
    return isPrivateIPv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff])
  }
  if (
    g0 === 0x64 &&
    g1 === 0xff9b &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0
  ) {
    return isPrivateIPv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff])
  }

  if (groups.every(g => g === 0)) return true // ::
  if (groups.slice(0, 7).every(g => g === 0) && g7 === 1) return true // ::1
  if ((g0 & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true // ff00::/8 multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true // 2001:db8::/32 documentation
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true // 100::/64 discard
  return false
}

/** Expands an IPv6 literal (with `::` and optional trailing dotted IPv4) into 8 hextets. */
function expandIPv6(input: string): number[] | null {
  let ip = input.toLowerCase()

  const tailMatch = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip)
  if (tailMatch) {
    const quad = parseIPv4(tailMatch[2] ?? '')
    if (!quad) return null
    const hi = ((quad[0] ?? 0) << 8) | (quad[1] ?? 0)
    const lo = ((quad[2] ?? 0) << 8) | (quad[3] ?? 0)
    ip = `${tailMatch[1]}${hi.toString(16)}:${lo.toString(16)}`
  }

  const halves = ip.split('::')
  if (halves.length > 2) return null

  const parseGroups = (part: string): number[] | null => {
    if (part === '') return []
    const parts = part.split(':')
    const values: number[] = []
    for (const p of parts) {
      if (!/^[0-9a-f]{1,4}$/.test(p)) return null
      values.push(parseInt(p, 16))
    }
    return values
  }

  const head = parseGroups(halves[0] ?? '')
  if (!head) return null

  if (halves.length === 1) {
    return head.length === 8 ? head : null
  }

  const tail = parseGroups(halves[1] ?? '')
  if (!tail) return null
  const missing = 8 - head.length - tail.length
  if (missing < 1) return null
  return [...head, ...new Array<number>(missing).fill(0), ...tail]
}

/**
 * Downloads an HTML/text page with SSRF defences: http(s) only, no credentials,
 * ports 80/443 only, every resolved address must be public, every redirect hop
 * is re-validated, size and time are capped, and only text content types are accepted.
 *
 * Note: DNS pinning is not done (the resolved address is not bound to the socket),
 * which leaves a small DNS-rebinding window. Acceptable for an admin-only tool.
 */
export async function fetchPageHtml(
  url: string,
  opts: FetchPageOptions = {}
): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const lookup = opts.lookup ?? defaultLookup
  const fetchImpl = opts.fetchImpl ?? fetch
  const signal = AbortSignal.timeout(timeoutMs)

  try {
    let current = await validateUrl(url, lookup)

    for (let hop = 0; ; hop++) {
      const response = await fetchImpl(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
      })

      if (isRedirect(response.status)) {
        const location = response.headers.get('location')
        await discardBody(response)
        if (!location) {
          throw new SafeFetchError(
            'Trang chuyển hướng nhưng không có địa chỉ đích',
            'HTTP',
            response.status
          )
        }
        if (hop >= maxRedirects) {
          throw new SafeFetchError(
            'Trang chuyển hướng quá nhiều lần',
            'NETWORK'
          )
        }
        // Re-validate every hop: a public URL may redirect to a private host.
        current = await validateUrl(
          new URL(location, current).toString(),
          lookup
        )
        continue
      }

      if (response.status < 200 || response.status > 299) {
        await discardBody(response)
        throw new SafeFetchError(
          `Trang trả về lỗi HTTP ${response.status}`,
          'HTTP',
          response.status
        )
      }

      const contentType = response.headers.get('content-type') ?? ''
      const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
      if (!ALLOWED_TYPES.has(mime)) {
        await discardBody(response)
        throw new SafeFetchError(
          `Loại nội dung không được hỗ trợ: ${mime || 'không xác định'}`,
          'BAD_TYPE'
        )
      }

      const declaredLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        await discardBody(response)
        throw new SafeFetchError('Nội dung trang quá lớn', 'TOO_LARGE')
      }

      const bytes = await readCapped(response, maxBytes)
      return {
        finalUrl: current.toString(),
        html: decodeBody(bytes, contentType),
        status: response.status,
      }
    }
  } catch (err) {
    if (err instanceof SafeFetchError) throw err
    if (signal.aborted || isAbortError(err)) {
      throw new SafeFetchError(
        'Trang tải quá lâu, đã hết thời gian chờ',
        'TIMEOUT'
      )
    }
    throw new SafeFetchError('Không kết nối được tới trang', 'NETWORK')
  }
}

async function validateUrl(
  raw: string,
  lookup: (host: string) => Promise<string[]>
): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SafeFetchError('Đường dẫn không hợp lệ', 'BLOCKED')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('Chỉ hỗ trợ đường dẫn http hoặc https', 'BLOCKED')
  }
  if (url.username !== '' || url.password !== '') {
    throw new SafeFetchError(
      'Đường dẫn không được chứa thông tin đăng nhập',
      'BLOCKED'
    )
  }

  const port =
    url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port)
  if (!ALLOWED_PORTS.has(port)) {
    throw new SafeFetchError('Chỉ cho phép cổng 80 hoặc 443', 'BLOCKED')
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host) {
    throw new SafeFetchError('Đường dẫn không có tên miền', 'BLOCKED')
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new SafeFetchError(
      'Địa chỉ nội bộ không được phép truy cập',
      'BLOCKED'
    )
  }

  if (host.includes(':') || parseIPv4(host) !== null) {
    if (isPrivateAddress(host)) {
      throw new SafeFetchError(
        'Địa chỉ nội bộ không được phép truy cập',
        'BLOCKED'
      )
    }
    return url
  }

  let addresses: string[]
  try {
    addresses = await lookup(host)
  } catch {
    throw new SafeFetchError('Không phân giải được tên miền', 'NETWORK')
  }
  if (addresses.length === 0) {
    throw new SafeFetchError('Không phân giải được tên miền', 'NETWORK')
  }
  if (addresses.some(address => isPrivateAddress(address))) {
    throw new SafeFetchError(
      'Địa chỉ nội bộ không được phép truy cập',
      'BLOCKED'
    )
  }
  return url
}

async function defaultLookup(host: string): Promise<string[]> {
  const records = await dnsLookup(host, { all: true, verbatim: true })
  return records.map(r => r.address)
}

function isRedirect(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  )
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err.name === 'AbortError' || err.name === 'TimeoutError')
  )
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // ignore: the body is discarded anyway
  }
}

async function readCapped(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(0)

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new SafeFetchError('Nội dung trang quá lớn', 'TOO_LARGE')
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function decodeBody(bytes: Uint8Array, contentType: string): string {
  const charset = /charset\s*=\s*"?([^";\s]+)"?/i
    .exec(contentType)?.[1]
    ?.toLowerCase()
  const label =
    charset === 'iso-8859-1' || charset === 'latin1'
      ? 'windows-1252'
      : charset === 'windows-1252'
        ? 'windows-1252'
        : 'utf-8'
  return new TextDecoder(label).decode(bytes)
}
