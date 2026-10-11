import type { LegalSearchHit } from '../../legal-knowledge/legal-knowledge.types'

/** Hits scoring below this are too weak to present as "related". */
export const FALLBACK_MIN_TOP_SCORE = 20
/** A hit joins the list only if it scores at least this share of the best hit. */
const FALLBACK_SCORE_SHARE = 0.6
const FALLBACK_MAX_ITEMS = 3

function formatDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toLocaleDateString('vi-VN')
}

/**
 * Answer used when the model refuses although the knowledge base found related
 * documents: lists the best matches (title, issuer, update date) and points to the
 * citations for reading them. No excerpt is quoted, since a chunk start can be
 * off-topic or carry site boilerplate. Returns undefined when nothing is strong
 * enough, so a truly out-of-scope question keeps the plain "no data" reply.
 */
export function buildRelatedSourcesAnswer(
  hits: readonly LegalSearchHit[]
): string | undefined {
  const top = hits.reduce((best, hit) => Math.max(best, hit.score), 0)
  if (top < FALLBACK_MIN_TOP_SCORE) return undefined

  const seen = new Set<string>()
  const chosen = hits
    .filter(hit => hit.score >= top * FALLBACK_SCORE_SHARE)
    .filter(hit => {
      if (seen.has(hit.docId)) return false
      seen.add(hit.docId)
      return true
    })
    .slice(0, FALLBACK_MAX_ITEMS)
  if (chosen.length === 0) return undefined

  const items = chosen.map((hit, index) => {
    const meta = [hit.issuer, formatDate(hit.fetchedAt)]
      .filter(Boolean)
      .join(', cập nhật ')
    const heading = hit.heading ? ` · ${hit.heading}` : ''
    return `${index + 1}. **${hit.title}**${heading}${meta ? ` (${meta})` : ''}`
  })

  return [
    'Kho tri thức chưa có nội dung trả lời trực tiếp đúng câu hỏi của bạn (ví dụ chưa có bản so sánh giữa các năm), nhưng có các văn bản liên quan sau. Bạn có thể mở nguồn ở phần "Căn cứ trích dẫn" để đọc và đối chiếu:',
    items.join('\n'),
    '*Nội dung chỉ mang tính tham khảo, không thay thế tư vấn pháp lý chuyên nghiệp.*',
  ].join('\n\n')
}
