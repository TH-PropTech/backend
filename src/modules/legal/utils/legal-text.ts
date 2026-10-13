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

/**
 * Picks the part of `text` that matters for `query`, within `maxChars`: paragraphs
 * sharing the most query words are kept (in original order); with no overlap the
 * start of the text is used. Short texts are returned as they are.
 */
export function pickMainExcerpt(
  text: string,
  query: string,
  maxChars: number
): string {
  const clean = text.trim()
  if (clean.length <= maxChars) return clean

  const queryWords = new Set(
    tokenize(query).filter(token => !token.includes('_'))
  )
  const paragraphs = clean
    .split(/\n+/)
    .map(part => part.trim())
    .filter(part => part.length > 0)
  const ranked = paragraphs
    .map((part, index) => {
      const words = new Set(tokenize(part))
      let score = 0
      for (const word of queryWords) if (words.has(word)) score += 1
      return { part, index, score }
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)

  if ((ranked[0]?.score ?? 0) === 0) return truncateAtWord(clean, maxChars)

  const chosen: typeof ranked = []
  let used = 0
  for (const item of ranked) {
    if (item.score === 0) break
    const cost = item.part.length + 1
    if (used + cost > maxChars) {
      if (chosen.length === 0) {
        return truncateAtWord(item.part, maxChars)
      }
      continue
    }
    chosen.push(item)
    used += cost
  }
  return chosen
    .sort((a, b) => a.index - b.index)
    .map(item => item.part)
    .join('\n')
}

function truncateAtWord(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}
