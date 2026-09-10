const MAX_CONTENT_BYTES = 100_000

const ALLOWED_NODES = new Set([
  'doc',
  'paragraph',
  'heading',
  'text',
  'bulletList',
  'orderedList',
  'listItem',
  'hardBreak',
])

const ALLOWED_MARKS = new Set(['bold', 'italic', 'underline', 'link'])

export type TipTapNode = Record<string, unknown> & {
  type: string
  attrs?: Record<string, unknown>
  content?: TipTapNode[]
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
  text?: string
}

export function sanitizeTipTapContent(input: unknown): TipTapNode {
  if (JSON.stringify(input).length > MAX_CONTENT_BYTES) {
    throw new Error('TIPTAP_CONTENT_TOO_LARGE')
  }
  if (!isRecord(input) || input.type !== 'doc') {
    throw new Error('TIPTAP_DOCUMENT_REQUIRED')
  }
  return sanitizeNode(input)
}

export function canonicalizeTipTapContent(input: unknown): string {
  return JSON.stringify(sortKeys(sanitizeTipTapContent(input)))
}

function sanitizeNode(input: Record<string, unknown>): TipTapNode {
  const type = typeof input.type === 'string' ? input.type : ''
  if (!ALLOWED_NODES.has(type)) throw new Error('TIPTAP_NODE_NOT_ALLOWED')

  const result: TipTapNode = { type }
  if (type === 'text') {
    if (typeof input.text !== 'string' || input.text.length > 20_000) {
      throw new Error('TIPTAP_TEXT_INVALID')
    }
    result.text = input.text
  }
  if (type === 'heading') {
    const level = getNumber(input.attrs, 'level')
    if (![1, 2, 3].includes(level))
      throw new Error('TIPTAP_HEADING_LEVEL_INVALID')
    result.attrs = { level }
  }
  if (type === 'link') {
    throw new Error('TIPTAP_LINK_NODE_INVALID')
  }
  if (
    type === 'paragraph' ||
    type === 'listItem' ||
    type === 'bulletList' ||
    type === 'orderedList' ||
    type === 'doc'
  ) {
    result.content = Array.isArray(input.content)
      ? input.content.map(child => {
          if (!isRecord(child)) throw new Error('TIPTAP_NODE_INVALID')
          return sanitizeNode(child)
        })
      : []
  }
  if (Array.isArray(input.marks)) {
    result.marks = input.marks.map(mark => {
      if (
        !isRecord(mark) ||
        typeof mark.type !== 'string' ||
        !ALLOWED_MARKS.has(mark.type)
      ) {
        throw new Error('TIPTAP_MARK_NOT_ALLOWED')
      }
      if (mark.type !== 'link') return { type: mark.type }
      const href = getString(mark.attrs, 'href')
      if (!href || !/^https:\/\//i.test(href))
        throw new Error('TIPTAP_LINK_INVALID')
      return { type: 'link', attrs: { href } }
    })
  }
  return result
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!isRecord(value)) return value
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = sortKeys(value[key])
      return result
    }, {})
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getNumber(attrs: unknown, key: string): number {
  if (!isRecord(attrs) || typeof attrs[key] !== 'number') return 0
  return attrs[key]
}

function getString(attrs: unknown, key: string): string | null {
  if (!isRecord(attrs) || typeof attrs[key] !== 'string') return null
  return attrs[key]
}
