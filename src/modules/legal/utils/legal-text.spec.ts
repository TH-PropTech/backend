import {
  expandLegalQuery,
  foldVietnamese,
  isHardWrapped,
  pickMainExcerpt,
  tokenize,
  unwrapHardLines,
} from './legal-text'

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

  it('keeps the best window of CONTIGUOUS lines that fits', () => {
    const excerpt = pickMainExcerpt(text, 'lệ phí đăng ký tạm trú', 150)
    expect(excerpt).toContain('Lệ phí đăng ký tạm trú')
    expect(excerpt).not.toContain('Phạm vi điều chỉnh')
    expect(excerpt.length).toBeLessThanOrEqual(150)
  })

  it('never glues together lines that were apart in the source', () => {
    const lines = [
      'Dòng khớp đầu tiên nói về đặt cọc thuê nhà ở.',
      'Dòng ở giữa không liên quan gì tới câu hỏi cả.',
      'Dòng ở giữa thứ hai cũng không liên quan gì hết.',
      'Dòng khớp cuối cùng cũng nói về đặt cọc thuê nhà ở.',
    ]
    const excerpt = pickMainExcerpt(lines.join('\n'), 'đặt cọc thuê nhà ở', 110)
    const kept = lines.filter(line => excerpt.includes(line))
    const first = lines.indexOf(kept[0]!)
    expect(kept.length).toBeGreaterThan(0)
    expect(kept).toEqual(lines.slice(first, first + kept.length))
  })

  it('does not turn a hard-wrapped sentence into a different one (regression: "vệ quanh")', () => {
    const wrapped = [
      'Điều 172. Đơn phương',
      'chấm dứt thực hiện hợp đồng thuê nhà ở',
      '',
      '2. Bên cho thuê nhà ở có quyền đơn phương chấm dứt thực hiện hợp đồng thuê nhà ở khi thuộc một',
      'trong các trường hợp sau đây:',
      '',
      'e) Bên thuê làm mất trật tự, vệ sinh môi trường, ảnh hưởng nghiêm trọng đến sinh hoạt của những người',
      'xung quanh đã được bên cho thuê nhà ở nhắc nhở nhưng vẫn không khắc phục;',
      '',
      'g) Trường hợp quy định tại khoản 2 Điều 170 của Luật này.',
    ].join('\n')
    const excerpt = pickMainExcerpt(
      wrapped,
      'bên cho thuê đơn phương chấm dứt hợp đồng thuê nhà ở',
      330
    )
    expect(excerpt).not.toMatch(/vệ\s+quanh/)
    expect(excerpt).toContain('khi thuộc một trong các trường hợp sau đây')
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

describe('unwrapHardLines', () => {
  const wrapped = [
    'Điều 160. Điều kiện của',
    'nhà ở tham gia giao dịch',
    '',
    '1. Giao dịch về mua bán, thuê mua, tặng cho, đổi, thế chấp, góp vốn bằng nhà ở thì nhà ở',
    'phải có đủ điều kiện sau đây, trừ trường hợp quy định tại khoản 2 Điều này:',
    '',
    'a) Có Giấy chứng nhận theo quy định của pháp luật về đất đai, pháp luật về xây dựng và',
    'pháp luật về nhà ở;',
  ].join('\n')

  it('detects the fixed-width look of an extracted page', () => {
    expect(isHardWrapped(wrapped)).toBe(true)
  })

  it('joins wrapped lines into paragraphs but keeps items and headings apart', () => {
    expect(unwrapHardLines(wrapped).split('\n\n')).toEqual([
      'Điều 160. Điều kiện của nhà ở tham gia giao dịch',
      '1. Giao dịch về mua bán, thuê mua, tặng cho, đổi, thế chấp, góp vốn bằng nhà ở thì nhà ở phải có đủ điều kiện sau đây, trừ trường hợp quy định tại khoản 2 Điều này:',
      'a) Có Giấy chứng nhận theo quy định của pháp luật về đất đai, pháp luật về xây dựng và pháp luật về nhà ở;',
    ])
  })

  it('leaves well-formed text (short lines, real line breaks) untouched', () => {
    const plain =
      'Tên thủ tục: Đăng ký tạm trú\nCơ quan thực hiện: Công an xã\nThời hạn: 03 ngày làm việc'
    expect(isHardWrapped(plain)).toBe(false)
    expect(unwrapHardLines(plain)).toBe(plain)
  })

  it('does not treat a cross-reference at the start of a wrapped line as a new block', () => {
    const text = [
      'Hợp đồng được lập thành văn bản theo quy định tại khoản này và phải bảo đảm đúng quy',
      'định tại Điều 19 của Luật này, đồng thời bên cho thuê phải thông báo cho bên thuê biết trước',
      'Điều 19 của Luật này; ba mươi ngày trước khi thực hiện việc điều chỉnh giá thuê nhà ở theo',
      'thỏa thuận của hai bên và các quy định khác của pháp luật có liên quan đến vấn đề này.',
    ].join('\n')
    expect(unwrapHardLines(text)).not.toContain('\n')
  })
})

describe('expandLegalQuery', () => {
  it('adds the statute term for an everyday word, keeping the original question', () => {
    const out = expandLegalQuery(
      'Nhà chưa có sổ hồng thì có được cho thuê không?'
    )
    expect(
      out.startsWith('Nhà chưa có sổ hồng thì có được cho thuê không?')
    ).toBe(true)
    expect(out).toContain('giấy chứng nhận quyền sở hữu nhà ở')
  })

  it('matches without accents and in any case', () => {
    expect(expandLegalQuery('CHU NHA tang gia')).toContain('bên cho thuê')
    expect(expandLegalQuery('CHU NHA tang gia')).toContain(
      'điều chỉnh giá thuê'
    )
  })

  it('returns the question unchanged when there is nothing to translate', () => {
    const q = 'Điều kiện của nhà ở tham gia giao dịch'
    expect(expandLegalQuery(q)).toBe(q)
  })

  it('does not add a term the question already contains', () => {
    const q = 'giấy chứng nhận quyền sở hữu nhà ở và sổ hồng'
    expect(expandLegalQuery(q)).toBe(q)
  })

  it('lets a plain-language question reach the article that uses the formal word', () => {
    const tokens = tokenize(expandLegalQuery('nhà không có sổ đỏ'))
    expect(tokens).toContain('giay')
    expect(tokens).toContain('chung')
  })
})
