import * as cheerio from 'cheerio'

type CheerioRoot = ReturnType<typeof cheerio.load>
type CheerioSelection = ReturnType<CheerioRoot>

/** Elements dropped entirely (with their content). */
const REMOVED_TAGS = [
  'script',
  'style',
  'noscript',
  'svg',
  'iframe',
  'form',
  'nav',
  'header',
  'footer',
  'aside',
  'template',
]

/** Matched against class and id; the element is dropped unless it contains the main content. */
const NOISE_ATTR_RE =
  /(menu|nav|footer|header|sidebar|banner|cookie|breadcrumb|share|social|comment|advert|ads)/i

const MAIN_CANDIDATES = [
  'article',
  'main',
  '[role=main]',
  '.content',
  '#content',
  '.post-content',
  '.entry-content',
  '.detail-content',
]

const SKIPPED_TEXT_TAGS = new Set(['script', 'style', 'noscript', 'template'])
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'blockquote',
  'pre',
  'dl',
  'dt',
  'dd',
  'figure',
  'figcaption',
  'address',
  'hr',
])
const MAIN_MARKER = 'data-legal-main'

export interface ExtractedPage {
  title?: string
  text: string
}

/**
 * Extracts the readable main text of an HTML page. Pure and tolerant: malformed
 * HTML yields whatever could be parsed, and it never throws.
 */
export function extractMainText(html: string): ExtractedPage {
  try {
    return extractUnsafe(html)
  } catch {
    return { text: '' }
  }
}

function extractUnsafe(html: string): ExtractedPage {
  const $ = cheerio.load(html)

  const title =
    $('title').first().text().replace(/\s+/g, ' ').trim() ||
    $('h1').first().text().replace(/\s+/g, ' ').trim()

  $(REMOVED_TAGS.join(',')).remove()

  const root = pickMainRoot($)
  root.attr(MAIN_MARKER, '1')

  // Drop noisy blocks by class/id, but never an ancestor of the main content
  // (e.g. a wrapper class such as "layout-with-sidebar").
  $('[class],[id]').each((_, el) => {
    const node = $(el)
    const attrs = `${node.attr('class') ?? ''} ${node.attr('id') ?? ''}`
    if (!NOISE_ATTR_RE.test(attrs)) return
    if (
      node.is(`[${MAIN_MARKER}]`) ||
      node.find(`[${MAIN_MARKER}]`).length > 0
    ) {
      return
    }
    node.remove()
  })

  const lines: string[] = []
  collectBlocks($, root, lines)
  const text = normalizeText(lines.join(''))

  return {
    ...(title ? { title } : {}),
    text,
  }
}

function pickMainRoot($: CheerioRoot): CheerioSelection {
  for (const selector of MAIN_CANDIDATES) {
    const candidate = $(selector).first()
    if (candidate.length > 0 && candidate.text().trim().length > 0) {
      return candidate
    }
  }
  return $('body').length > 0 ? $('body').first() : $.root()
}

/** Appends text fragments to `out`, turning block structure into newlines. */
function collectBlocks(
  $: CheerioRoot,
  node: CheerioSelection,
  out: string[]
): void {
  node.contents().each((_, child) => {
    const kind: string = child.type
    if (kind === 'text') {
      out.push($(child).text())
      return
    }
    if (kind !== 'tag' || !('tagName' in child)) return

    const tag = child.tagName.toLowerCase()
    if (SKIPPED_TEXT_TAGS.has(tag)) return

    if (tag === 'br') {
      out.push('\n')
      return
    }

    const isBlock = BLOCK_TAGS.has(tag) || /^h[1-6]$/.test(tag)
    if (isBlock) out.push('\n')
    if (tag === 'li') out.push('- ')
    if (tag === 'td' || tag === 'th') out.push(' | ')

    collectBlocks($, $(child), out)

    if (isBlock) out.push('\n')
  })
}

function normalizeText(raw: string): string {
  return raw
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
