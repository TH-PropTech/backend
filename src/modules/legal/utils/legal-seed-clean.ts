/** Lines that sit above the legal text on caselaw.vn (contact box and table-of-contents chrome). */
const HEADER_NOISE =
  /^(?:[\d.\s]{9,}|\[email[^\]]*\]|Hướng dẫn sử dụng|Liên hệ|\||MỤC LỤC|In mục lục|Không có mục lục)$/

/** Where the document itself starts: the issuing body followed by a dashed rule. */
const BODY_START =
  /\n[|\s]*(?:VĂN PHÒNG\s+)?(?:QUỐC\s+HỘI|CHÍNH\s+PHỦ|BỘ\s+[^\n]+)\s*\n\s*-{3,}/

/** Sign-in nag and "read more" lists that follow the text. */
const FOOTER_NOISE = [
  /\n\s*Vui lòng\s*\n+\s*Đăng ký[\s\S]*$/,
  /\n-\s*Tham khảo thêm[\s\S]*$/,
]

/** Share of the page the body marker may sit at; later matches are treated as false hits. */
const BODY_START_MAX_RATIO = 0.6

/**
 * Removes site chrome around a fetched legal page so that only the document
 * text is stored (and later cited by the chat bot). Conservative: when no
 * known pattern matches, the text is returned trimmed and otherwise unchanged.
 */
export function cleanSourceText(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n')

  const start = BODY_START.exec(text)
  if (start && start.index < text.length * BODY_START_MAX_RATIO) {
    text = text.slice(start.index + 1)
  }
  text = dropLeadingNoise(text)

  for (const pattern of FOOTER_NOISE) text = text.replace(pattern, '')
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

function dropLeadingNoise(text: string): string {
  const lines = text.split('\n')
  let first = 0
  while (first < lines.length) {
    const line = (lines[first] ?? '').trim()
    if (line.length > 0 && !HEADER_NOISE.test(line)) break
    first += 1
  }
  return lines.slice(first).join('\n')
}

/**
 * Keeps only the procedure detail of a dichvucong.gov.vn page: from "Tên thủ tục"
 * to just before the "Tìm kiếm nhiều nhất" list. Drops the portal menu and the
 * unrelated procedures listed below the detail.
 */
export function cleanPortalProcedure(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex(line => line.trim() === 'Tên thủ tục')
  const endIndex = lines.findIndex(
    line => line.trim() === 'Tìm kiếm nhiều nhất'
  )
  const from = start >= 0 ? start : 0
  const to = endIndex > from ? endIndex : lines.length
  return lines
    .slice(from, to)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
