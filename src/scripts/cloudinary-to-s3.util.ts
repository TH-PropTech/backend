const CLOUDINARY_URL_PATTERN = /^https:\/\/res\.cloudinary\.com\//
const SEED_PREFIX = 'seed'
const VERSION_SEGMENT_PATTERN = /^v\d+$/

export function isCloudinaryUrl(value: unknown): value is string {
  return typeof value === 'string' && CLOUDINARY_URL_PATTERN.test(value)
}

function isTraversable(value: unknown): value is object {
  if (value === null || typeof value !== 'object') return false
  if (value instanceof Date) return false
  return !('_bsontype' in value)
}

/** Gom mọi chuỗi URL Cloudinary (cả khi lồng sâu trong object/mảng) vào `into`. */
export function collectCloudinaryUrls(
  value: unknown,
  into: Set<string> = new Set()
): Set<string> {
  if (isCloudinaryUrl(value)) {
    into.add(value)
  } else if (Array.isArray(value)) {
    for (const item of value) collectCloudinaryUrls(item, into)
  } else if (isTraversable(value)) {
    for (const item of Object.values(value)) collectCloudinaryUrls(item, into)
  }
  return into
}

/**
 * Đặt key S3 dưới `seed/` theo tên file gốc. Hai URL khác nhau trùng tên file thì
 * thêm phiên bản Cloudinary (`v123-`) hoặc số thứ tự để không ghi đè nhau.
 * `taken` ánh xạ key đã dùng về URL nguồn; hàm tự ghi key mới vào đó.
 */
export function buildS3Key(url: string, taken: Map<string, string>): string {
  const segments = new URL(url).pathname.split('/').filter(Boolean)
  const fileName = decodeURIComponent(segments.at(-1) ?? 'file')
  const version = segments.find(segment =>
    VERSION_SEGMENT_PATTERN.test(segment)
  )
  const candidates = [
    `${SEED_PREFIX}/${fileName}`,
    ...(version ? [`${SEED_PREFIX}/${version}-${fileName}`] : []),
  ]
  const free = candidates.find(key => {
    const owner = taken.get(key)
    return owner === undefined || owner === url
  })
  const key = free ?? uniqueSuffixedKey(candidates.at(-1) ?? '', url, taken)
  taken.set(key, url)
  return key
}

function uniqueSuffixedKey(
  base: string,
  url: string,
  taken: Map<string, string>
): string {
  for (let index = 2; ; index += 1) {
    const key = `${base}-${index}`
    const owner = taken.get(key)
    if (owner === undefined || owner === url) return key
  }
}

export interface RewriteResult<T> {
  readonly value: T
  readonly changed: boolean
}

/** Thay chuỗi trùng khớp hoàn toàn với khoá của `map`; giữ nguyên mọi giá trị khác. */
export function rewriteUrls<T>(
  value: T,
  map: ReadonlyMap<string, string>
): RewriteResult<T> {
  if (typeof value === 'string') {
    const replacement = map.get(value)
    return replacement === undefined
      ? { value, changed: false }
      : { value: replacement as T, changed: true }
  }
  if (Array.isArray(value)) {
    const results = value.map(item => rewriteUrls(item as unknown, map))
    return {
      value: results.map(result => result.value) as T,
      changed: results.some(result => result.changed),
    }
  }
  if (isTraversable(value)) {
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const result = rewriteUrls(item, map)
      next[key] = result.value
      changed ||= result.changed
    }
    return { value: (changed ? next : value) as T, changed }
  }
  return { value, changed: false }
}

/** Đếm số tham chiếu Cloudinary theo đường dẫn field (chỉ số mảng chuẩn hoá thành `[]`). */
export function countCloudinaryRefsByField(
  value: unknown,
  counts: Map<string, number> = new Map(),
  path = ''
): Map<string, number> {
  if (isCloudinaryUrl(value)) {
    counts.set(path, (counts.get(path) ?? 0) + 1)
  } else if (Array.isArray(value)) {
    for (const item of value) {
      countCloudinaryRefsByField(item, counts, `${path}[]`)
    }
  } else if (isTraversable(value)) {
    for (const [key, item] of Object.entries(value)) {
      countCloudinaryRefsByField(item, counts, path ? `${path}.${key}` : key)
    }
  }
  return counts
}
