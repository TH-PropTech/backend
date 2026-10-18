import { foldVietnamese, tokenize } from './legal-text'

const K1 = 1.5
const B = 0.75
const KEYWORD_BOOST = 2.0
const DEFAULT_LIMIT = 10

export interface Bm25Doc<T> {
  id: string
  text: string
  keywords?: string[]
  meta: T
}

export interface Bm25Hit<T> {
  id: string
  score: number
  /**
   * Share (0..1) of the query's IDF weight carried by words this document actually contains.
   * "thủ tục ly hôn đơn phương giấy tờ" matches thousands of chunks on "thủ tục"/"giấy tờ" but none
   * on the rare "ly hôn", so it scores low here while a real match scores high.
   */
  coverage: number
  meta: T
}

interface KeywordMatcher {
  /** Folded, punctuation-normalised phrase, e.g. "thue nha". */
  phrase: string
  /** Folded unigrams of the phrase (stopwords dropped). */
  unigrams: string[]
}

interface IndexedDoc<T> {
  id: string
  meta: T
  length: number
  termFreq: Map<string, number>
  keywords: KeywordMatcher[]
}

/** Okapi BM25 over folded unigrams + bigrams, with a keyword boost. In-memory, rebuilt wholesale. */
export class Bm25Index<T> {
  private docs: IndexedDoc<T>[] = []
  private docFreq = new Map<string, number>()
  private avgLength = 1

  /** Replaces the whole index. */
  build(docs: Bm25Doc<T>[]): void {
    const indexed: IndexedDoc<T>[] = []
    const docFreq = new Map<string, number>()
    let totalLength = 0

    for (const doc of docs) {
      const tokens = tokenize(doc.text)
      const termFreq = new Map<string, number>()
      for (const token of tokens) {
        termFreq.set(token, (termFreq.get(token) ?? 0) + 1)
      }
      for (const term of termFreq.keys()) {
        docFreq.set(term, (docFreq.get(term) ?? 0) + 1)
      }
      totalLength += tokens.length

      indexed.push({
        id: doc.id,
        meta: doc.meta,
        length: tokens.length,
        termFreq,
        keywords: (doc.keywords ?? [])
          .map(k => toKeywordMatcher(k))
          .filter((k): k is KeywordMatcher => k !== null),
      })
    }

    this.docs = indexed
    this.docFreq = docFreq
    this.avgLength =
      indexed.length > 0 ? Math.max(1, totalLength / indexed.length) : 1
  }

  search(
    query: string,
    limit = DEFAULT_LIMIT,
    minScore = 0,
    minCoverage = 0
  ): Array<Bm25Hit<T>> {
    if (this.docs.length === 0 || limit <= 0) return []

    const queryTokens = tokenize(query)
    if (queryTokens.length === 0) return []

    const uniqueTerms = [...new Set(queryTokens)]
    const querySet = new Set(queryTokens)
    const normalizedQuery = ` ${normalizePhrase(query)} `

    const idfOf = (term: string): number => {
      const df = this.docFreq.get(term) ?? 0
      return Math.log(1 + (this.docs.length - df + 0.5) / (df + 0.5))
    }
    // coverage is measured on single words (bigrams would double-count the same words)
    const words = uniqueTerms.filter(term => !term.includes('_'))
    const totalWordIdf = words.reduce((sum, term) => sum + idfOf(term), 0)

    const scored: Array<Bm25Hit<T>> = []
    for (const doc of this.docs) {
      let score = 0
      let matchedWordIdf = 0

      for (const term of uniqueTerms) {
        const tf = doc.termFreq.get(term)
        if (!tf) continue
        const idf = idfOf(term)
        if (!term.includes('_')) matchedWordIdf += idf
        const norm = tf + K1 * (1 - B + (B * doc.length) / this.avgLength)
        score += idf * ((tf * (K1 + 1)) / norm)
      }

      for (const keyword of doc.keywords) {
        if (
          normalizedQuery.includes(` ${keyword.phrase} `) ||
          (keyword.unigrams.length > 0 &&
            keyword.unigrams.every(u => querySet.has(u)))
        ) {
          score += KEYWORD_BOOST
        }
      }

      const coverage = totalWordIdf > 0 ? matchedWordIdf / totalWordIdf : 1
      if (score > 0 && score >= minScore && coverage >= minCoverage) {
        scored.push({ id: doc.id, score, coverage, meta: doc.meta })
      }
    }

    scored.sort(
      (a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )
    return scored.slice(0, limit)
  }

  size(): number {
    return this.docs.length
  }
}

function normalizePhrase(s: string): string {
  return foldVietnamese(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length > 0)
    .join(' ')
}

function toKeywordMatcher(keyword: string): KeywordMatcher | null {
  const phrase = normalizePhrase(keyword)
  if (!phrase) return null
  const unigrams = tokenize(keyword).filter(t => !t.includes('_'))
  return { phrase, unigrams }
}
