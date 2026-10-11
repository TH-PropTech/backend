import type { LegalSearchHit } from '../../legal-knowledge/legal-knowledge.types'
import { buildRelatedSourcesAnswer } from './legal-fallback-answer'

const hit = (overrides: Partial<LegalSearchHit>): LegalSearchHit => ({
  docId: 'd',
  title: 'Văn bản',
  text: 'Nội dung.',
  score: 30,
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
})
