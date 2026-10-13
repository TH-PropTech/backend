import { foldVietnamese, pickMainExcerpt, tokenize } from './legal-text'

describe('foldVietnamese', () => {
  it('strips diacritics, maps đ and lowercases', () => {
    expect(foldVietnamese('Thuê Nhà Đặt Cọc')).toBe('thue nha dat coc')
  })

  it('collapses whitespace and trims', () => {
    expect(foldVietnamese('  Điều   472\n\tquy định ')).toBe(
      'dieu 472 quy dinh'
    )
  })

  it('returns empty string for blank input', () => {
    expect(foldVietnamese('   ')).toBe('')
  })
})

describe('tokenize', () => {
  it('returns folded unigrams and adjacent bigrams', () => {
    const tokens = tokenize('Thuê nhà phải đặt cọc')
    expect(tokens).toEqual(
      expect.arrayContaining([
        'thue',
        'nha',
        'phai',
        'dat',
        'coc',
        'thue_nha',
        'nha_phai',
        'dat_coc',
      ])
    )
  })

  it('drops stopwords and single-character tokens', () => {
    const tokens = tokenize('Và của là các những a b')
    expect(tokens).toEqual([])
  })

  it('removes stopwords before building bigrams', () => {
    const tokens = tokenize('hợp đồng và cọc')
    expect(tokens).toEqual(['hop', 'dong', 'coc', 'hop_dong', 'dong_coc'])
  })

  it('keeps digits (article numbers)', () => {
    expect(tokenize('Điều 472')).toEqual(['dieu', '472', 'dieu_472'])
  })

  it('returns an empty list for empty input', () => {
    expect(tokenize('')).toEqual([])
  })
})

describe('pickMainExcerpt', () => {
  const text = [
    'Điều 1. Phạm vi điều chỉnh của luật này áp dụng cho mọi tổ chức.',
    'Quy định chung về hồ sơ không liên quan tới nội dung đang hỏi ở đây.',
    'Lệ phí đăng ký tạm trú nộp trực tiếp là 15.000 đồng mỗi lần đăng ký.',
    'Thời hạn giải quyết hồ sơ là 3 ngày làm việc kể từ ngày nhận đủ hồ sơ.',
  ].join('\n')

  it('returns short text untouched', () => {
    expect(pickMainExcerpt('Ngắn gọn', 'bất kỳ', 100)).toBe('Ngắn gọn')
  })

  it('keeps the paragraphs that match the question, in original order', () => {
    const excerpt = pickMainExcerpt(text, 'lệ phí đăng ký tạm trú', 150)
    expect(excerpt).toContain('Lệ phí đăng ký tạm trú')
    expect(excerpt).not.toContain('Phạm vi điều chỉnh')
    expect(excerpt.length).toBeLessThanOrEqual(150)
  })

  it('falls back to the start of the text when nothing matches', () => {
    const excerpt = pickMainExcerpt(text, 'zzzz qqqq', 90)
    expect(excerpt.startsWith('Điều 1.')).toBe(true)
    expect(excerpt.length).toBeLessThanOrEqual(91)
  })

  it('cuts a single oversized matching paragraph at a word boundary', () => {
    const long = `Lệ phí tạm trú ${'rất dài '.repeat(100)}`
    const excerpt = pickMainExcerpt(long, 'lệ phí tạm trú', 80)
    expect(excerpt.length).toBeLessThanOrEqual(81)
    expect(excerpt.endsWith('…')).toBe(true)
  })
})
