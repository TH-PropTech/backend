import type { LegalSearchHit } from '../../legal/utils/legal-knowledge.types'
import { buildRelatedSourcesAnswer } from './legal-fallback-answer'

const hit = (overrides: Partial<LegalSearchHit>): LegalSearchHit => ({
  docId: 'd',
  title: 'Văn bản',
  text: 'Nội dung.',
  score: 30,
  coverage: 0.9,
  ...overrides,
})

describe('buildRelatedSourcesAnswer', () => {
  it('lists the best matches with issuer and update date, without quoting text', () => {
    const answer = buildRelatedSourcesAnswer([
      hit({
        title: 'Nghị định 68/2026/NĐ-CP',
        issuer: 'Chính phủ',
        fetchedAt: '2026-10-11T03:00:00.000Z',
        text: 'Đoạn trích không được đưa vào câu trả lời.',
      }),
    ])

    expect(answer).toContain('**Nghị định 68/2026/NĐ-CP**')
    expect(answer).toContain('Chính phủ, cập nhật')
    expect(answer).not.toContain('Đoạn trích không được đưa vào')
    expect(answer).toContain('không thay thế tư vấn pháp lý')
    expect(answer).not.toMatch(/^Hiện chưa có dữ liệu/)
  })

  it('keeps at most three distinct documents and drops hits far weaker than the best', () => {
    const answer = buildRelatedSourcesAnswer([
      hit({ docId: '1', title: 'A', score: 40 }),
      hit({ docId: '1', title: 'A', score: 39 }),
      hit({ docId: '2', title: 'B', score: 35 }),
      hit({ docId: '3', title: 'C', score: 30 }),
      hit({ docId: '4', title: 'D', score: 28 }),
      hit({ docId: '5', title: 'E', score: 5 }),
    ])
    expect(answer?.match(/\*\*A\*\*/g)).toHaveLength(1)
    expect(answer).toContain('**C**')
    expect(answer).not.toContain('**D**')
    expect(answer).not.toContain('**E**')
  })

  it('returns undefined when matches are too weak or missing', () => {
    expect(buildRelatedSourcesAnswer([])).toBeUndefined()
    expect(buildRelatedSourcesAnswer([hit({ score: 12 })])).toBeUndefined()
  })

  it('stays silent when the hits only share common words with the question (out-of-scope topic)', () => {
    // "thủ tục ly hôn đơn phương giấy tờ": high BM25 on "thủ tục"/"giấy tờ" but "ly hôn" is missing everywhere
    const answer = buildRelatedSourcesAnswer([
      hit({ title: 'Đăng ký thường trú', score: 35.8, coverage: 0.68 }),
      hit({
        docId: 'e',
        title: 'Mẫu hợp đồng thuê nhà',
        score: 31.9,
        coverage: 0.6,
      }),
    ])
    expect(answer).toBeUndefined()
  })

  it('does not talk about comparisons between years when the question was not about that', () => {
    const answer = buildRelatedSourcesAnswer([hit({ title: 'A' })])
    expect(answer).not.toContain('giữa các năm')
  })
})
