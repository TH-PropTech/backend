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
