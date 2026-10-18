import { foldVietnamese } from '../../legal/utils/legal-text'

/**
 * Checks a legal answer against the passages it was written from. The model must only state
 * figures (months, days, %, money) and article/decree numbers that appear in those passages; one
 * that does not is a hallucination ("không quá 2 tháng" when the law says 12 months for social
 * housing) and must not reach the user.
 */

const QUANTITY_UNITS = 'tháng|ngày|%|phần trăm|triệu|nghìn|ngàn|đồng|lần|giờ'
// "2 tháng", "02 tháng", "hai (2) tháng", "10%", "1.500.000 đồng" -> number + unit
const QUANTITY_RE = new RegExp(
  `(\\d+(?:[.,]\\d+)*)\\)?\\s*(${QUANTITY_UNITS})(?![\\p{L}])`,
  'giu'
)
// Điều 89, Nghị định 100/2024/NĐ-CP, Thông tư 40/2021 ... (kept only up to the year)
const REFERENCE_RE =
  /(Điều|Nghị định|Thông tư|Quyết định|Nghị quyết)\s+(\d+[a-zđ]?(?:\/\d{4})?)/giu
// Dates are not quantities: "ngày 27 tháng 11 năm 2023", "27/11/2023"
const DATE_RES = [
  /ngày\s+\d{1,2}\s+tháng\s+\d{1,2}(?:\s+năm\s+\d{4})?/giu,
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gu,
  /\btháng\s+\d{1,2}(?:\/|\s+năm\s+)\d{4}\b/giu,
]

/** "03" and "3" are the same number; "1.500" and "1500" too. */
function normalizeNumber(raw: string): string {
  return raw.replace(/[.,]/g, '').replace(/^0+(?=\d)/, '')
}

function stripDates(text: string): string {
  return DATE_RES.reduce((out, re) => out.replace(re, ' '), text)
}

/** key (accent-free, normalised) -> text as the author wrote it, for messages to the model. */
function quantitiesOf(text: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of stripDates(text).matchAll(QUANTITY_RE)) {
    const unit = foldVietnamese(match[2] ?? '').replace('phan tram', '%')
    const key = `${normalizeNumber(match[1] ?? '')} ${unit}`
    if (!found.has(key)) found.set(key, `${match[1]} ${match[2]}`)
  }
  return found
}

function referencesOf(text: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of text.matchAll(REFERENCE_RE)) {
    const key = `${foldVietnamese(match[1] ?? '')} ${foldVietnamese(match[2] ?? '')}`
    if (!found.has(key)) found.set(key, `${match[1]} ${match[2]}`)
  }
  return found
}

/**
 * Figures and references in `answer` that cannot be found in `evidence` (the passages shown to the
 * model, with their titles and headings). Empty when the answer is fully grounded.
 */
export function findUngroundedFigures(
  answer: string,
  evidence: string
): string[] {
  const knownQuantities = quantitiesOf(evidence)
  const knownReferences = referencesOf(evidence)
  const missing: string[] = []

  for (const [key, shown] of quantitiesOf(answer)) {
    if (!knownQuantities.has(key)) missing.push(shown)
  }
  for (const [key, shown] of referencesOf(answer)) {
    if (!knownReferences.has(key)) missing.push(shown)
  }
  return missing
}

/**
 * Sections of a statute that apply to one kind of housing or contract only. A heading such as
 * "Điều 89. Bán, cho thuê mua, cho thuê nhà ở xã hội" says what it covers; quoting it as the rule for
 * an ordinary tenancy is wrong even when every figure matches.
 */
const SCOPE_TERMS: ReadonlyArray<readonly [string, string]> = [
  ['nhà ở xã hội', 'nhà ở xã hội'],
  ['công vụ', 'nhà ở công vụ'],
  ['thuê khoán', 'hợp đồng thuê khoán tài sản'],
  ['thuê mua', 'thuê mua nhà ở'],
  ['lực lượng vũ trang', 'nhà ở cho lực lượng vũ trang'],
  ['tái định cư', 'nhà ở phục vụ tái định cư'],
  ['lưu trú công nhân', 'nhà lưu trú công nhân'],
  ['thế chấp', 'thế chấp nhà ở'],
]

export interface ScopeSource {
  title: string
  heading?: string | undefined
}

/**
 * One note per article the answer cites whose heading is limited to a kind of housing the question
 * never mentioned, so the reader knows the rule is not the general one for ordinary rentals.
 */
export function findScopeNotes(
  question: string,
  answer: string,
  sources: readonly ScopeSource[]
): string[] {
  const foldedQuestion = foldVietnamese(question)
  const foldedAnswer = foldVietnamese(answer)
  const notes = new Set<string>()

  for (const source of sources) {
    const heading = source.heading ?? ''
    const article = /^Điều\s+(\d+[a-zđ]?)/iu.exec(heading)?.[1]
    if (!article || !foldedAnswer.includes(`dieu ${foldVietnamese(article)}`)) {
      continue
    }
    const foldedHeading = foldVietnamese(heading)
    const scopes = SCOPE_TERMS.filter(([needle]) =>
      foldedHeading.includes(foldVietnamese(needle))
    )
    // the question touching ANY of the kinds the heading covers means the article is on topic
    const onTopic = scopes.some(([needle]) =>
      foldedQuestion.includes(foldVietnamese(needle))
    )
    if (scopes.length > 0 && !onTopic) {
      notes.add(
        `Điều ${article} (${source.title}) chỉ nói về ${scopes[0]![1]}, không phải quy định chung cho thuê nhà ở thông thường.`
      )
    }
  }
  return [...notes]
}
