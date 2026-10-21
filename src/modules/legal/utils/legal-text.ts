const STOPWORD_SOURCE = [
  'và',
  'của',
  'là',
  'các',
  'những',
  'được',
  'cho',
  'trong',
  'với',
  'có',
  'không',
  'này',
  'khi',
  'thì',
  'để',
  'theo',
]

/**
 * Folded (accent-free, lowercase) stopwords. Built from the same folding as the
 * tokens so the comparison is exact.
 */
const STOPWORDS = new Set(STOPWORD_SOURCE.map(w => foldVietnamese(w)))

/**
 * Lowercases, strips Vietnamese diacritics (including the đ/Đ letter) and
 * collapses whitespace. Used for both indexing and querying so that
 * "thuê nhà" matches "thue nha".
 */
export function foldVietnamese(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Everyday words people use for a legal concept, mapped to the term the statutes use. Patterns are
 * written on accent-free lowercase text. The statute term is only ADDED to the question, never
 * substituted, so a document that does use the everyday word still matches.
 */
const LEGAL_TERM_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(so hong|so do|giay chu quyen)\b/, 'giấy chứng nhận quyền sở hữu nhà ở'],
  [/\b(chu nha|nguoi cho thue)\b/, 'bên cho thuê'],
  [/\b(nguoi thue|khach thue|nguoi di thue|nguoi o thue)\b/, 'bên thuê'],
  [/\b(tang gia|giam gia|doi gia)\b/, 'điều chỉnh giá thuê nhà ở'],
  [/\b(tra nha|doi nha|boi thuong khi tra)\b/, 'trả lại nhà ở thuê'],
  [
    /\b(hu hong|sua chua|hong hoc)\b/,
    'bảo trì cải tạo sửa chữa nhà ở cho thuê',
  ],
  [
    /\b(hop dong dien tu|ky dien tu|chu ky dien tu|ky so)\b/,
    'giao dịch điện tử chữ ký điện tử hợp đồng điện tử',
  ],
  [/\b(tien coc)\b/, 'đặt cọc'],
  [
    /\b(het han hop dong|het han thue)\b/,
    'chấm dứt hợp đồng thuê nhà ở thời hạn thuê',
  ],
  [/\b(moi gioi)\b/, 'chứng chỉ hành nghề môi giới bất động sản'],
  [/\b(tam tru)\b/, 'đăng ký tạm trú cư trú'],
  [/\b(thuong tru|ho khau)\b/, 'đăng ký thường trú cư trú'],
  [
    /\b(hoan coc|tra coc|mat coc|phat coc|boi thuong coc)\b/,
    'đặt cọc trả lại tiền đặt cọc phạt cọc',
  ],
  [
    /\b(thue lai|cho thue lai|sublet)\b/,
    'cho thuê lại nhà ở bên thuê cho thuê lại',
  ],
  [
    /\b(phi quan ly|phi dich vu|phi chung cu)\b/,
    'kinh phí quản lý vận hành nhà chung cư',
  ],
  [
    /\b(dong thue|nop thue|khai thue|thue cho thue)\b/,
    'thuế thu nhập cá nhân thuế giá trị gia tăng cho thuê tài sản',
  ],
  [/\b(cong chung|chung thuc)\b/, 'công chứng chứng thực hợp đồng thuê nhà ở'],
  [
    /\b(vi pham hop dong|phat vi pham|bo hop dong)\b/,
    'phạt vi phạm hợp đồng bồi thường thiệt hại đơn phương chấm dứt',
  ],
  [
    /\b(nguoi nuoc ngoai|viet kieu)\b/,
    'tổ chức cá nhân nước ngoài thuê nhà ở tại Việt Nam',
  ],
  [/\b(the chap|ngan hang giu so)\b/, 'thế chấp nhà ở đang cho thuê'],
]

/** The question followed by the statute terms for the everyday words it uses (unchanged if none). */
export function expandLegalQuery(query: string): string {
  const folded = foldVietnamese(query)
  const additions: string[] = []
  for (const [pattern, term] of LEGAL_TERM_ALIASES) {
    if (pattern.test(folded) && !folded.includes(foldVietnamese(term))) {
      additions.push(term)
    }
  }
  return additions.length > 0 ? `${query} ${additions.join(' ')}` : query
}

/**
 * Folded unigrams (1-char tokens and stopwords dropped) followed by adjacent
 * bigrams "a_b" built from the kept unigram sequence.
 */
export function tokenize(s: string): string[] {
  const words = foldVietnamese(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => [...w].length >= 2 && !STOPWORDS.has(w))

  const bigrams: string[] = []
  for (let i = 0; i + 1 < words.length; i++) {
    bigrams.push(`${words[i]}_${words[i + 1]}`)
  }
  return [...words, ...bigrams]
}

/** A line that really starts a new block (article/chapter heading, numbered or lettered item, bullet). */
const BLOCK_START_RE =
  /^(?:[Cc]hương\s+[IVXLC\d]+\s*(?:[.:–-]|$)|[Mm]ục\s+\d+\s*(?:[.:–-]|$)|[Đđ]iều\s+\d+[a-zđ]?(?:\s*[.:]|\s*$|\s+\p{Lu})|\d+[.)]\s|[a-zđ][.)]\s|[-•*–]\s|#{1,6}\s)/u

/**
 * Many legal pages are extracted with hard line breaks every ~80 characters, even in the
 * middle of a heading or a sentence. True when most lines that continue into a next line of the
 * same paragraph have that fixed-width look.
 */
/**
 * Share of wrapped-looking lines above which a text counts as hard-wrapped. Measured on the real
 * knowledge base: wrapped laws score 0.45-0.73 (Luật Nhà ở 0.61, Luật Cư trú 0.50), well-formed
 * pages 0.17 or less.
 */
const WRAPPED_MIN_SHARE = 0.35

export function isHardWrapped(text: string): boolean {
  let inner = 0
  let wrapped = 0
  for (const paragraph of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = paragraph.split('\n').filter(line => line.trim().length > 0)
    for (let i = 0; i + 1 < lines.length; i++) {
      inner++
      const line = lines[i]!.trim()
      // một dòng bị ngắt cứng thì dừng giữa câu: không kết thúc bằng dấu chấm câu
      if (line.length >= 50 && line.length <= 115 && !/[.;:!?]$/.test(line))
        wrapped++
    }
  }
  return inner >= 3 && wrapped / inner >= WRAPPED_MIN_SHARE
}

/**
 * Joins hard-wrapped lines back into paragraphs. Blank lines stay paragraph breaks, and a line
 * that starts a new block (heading, "1.", "a)", bullet) is kept on its own line. Text without the
 * fixed-width look is returned unchanged, so already well-formed sources are never altered.
 */
export function unwrapHardLines(text: string): string {
  if (!isHardWrapped(text)) return text
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map(paragraph => {
      let out = ''
      for (const raw of paragraph.split('\n')) {
        const line = raw.trim()
        if (!line) continue
        if (!out) out = line
        else if (BLOCK_START_RE.test(line)) out += `\n${line}`
        else out += ` ${line}`
      }
      return out
    })
    .filter(paragraph => paragraph.length > 0)
    .join('\n\n')
}

/**
 * Picks the part of `text` that matters for `query`, within `maxChars`. The result is ALWAYS a
 * contiguous run of the original lines (the window with the most query words), never lines glued
 * together from different places: dropping the lines in between can turn a sentence into a
 * different, wrong one. With no overlap the start of the text is used. Short texts are returned
 * as they are.
 */
export function pickMainExcerpt(
  text: string,
  query: string,
  maxChars: number
): string {
  const clean = unwrapHardLines(text.trim()).trim()
  if (clean.length <= maxChars) return clean

  const queryWords = new Set(
    tokenize(query).filter(token => !token.includes('_'))
  )
  const lines = clean
    .split(/\n+/)
    .map(part => part.trim())
    .filter(part => part.length > 0)
  const scores = lines.map(line => {
    const words = new Set(tokenize(line))
    let score = 0
    for (const word of queryWords) if (words.has(word)) score += 1
    return score
  })

  // chừa chỗ cho dấu "…" ở hai đầu để kết quả không vượt maxChars
  const room = Math.max(20, maxChars - 4)
  let best: { start: number; end: number; score: number } | undefined
  for (let start = 0; start < lines.length; start++) {
    let length = 0
    let score = 0
    let end = start
    while (end < lines.length) {
      const cost = lines[end]!.length + (end > start ? 1 : 0)
      if (length + cost > room) break
      length += cost
      score += scores[end]!
      end++
    }
    if (end === start) continue
    if (!best || score > best.score) best = { start, end, score }
  }

  if (!best) {
    // không dòng nào vừa khung: cắt dòng khớp nhiều nhất tại ranh giới từ
    let top = 0
    scores.forEach((score, index) => {
      if (score > scores[top]!) top = index
    })
    return truncateAtWord(lines[top] ?? clean, maxChars)
  }
  if (best.score === 0) return truncateAtWord(clean, maxChars)

  const window = lines.slice(best.start, best.end).join('\n')
  return `${best.start > 0 ? '… ' : ''}${window}${best.end < lines.length ? ' …' : ''}`
}

function truncateAtWord(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}
