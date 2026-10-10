import { foldVietnamese, tokenize } from './legal-text'

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
