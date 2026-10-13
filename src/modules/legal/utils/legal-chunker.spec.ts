import { chunkLegalText } from './legal-chunker'

describe('chunkLegalText', () => {
  it('returns no chunks for empty or whitespace-only input', () => {
    expect(chunkLegalText('')).toEqual([])
    expect(chunkLegalText('   \n\n  ')).toEqual([])
  })

  it('splits on Điều headings and keeps the heading line', () => {
    const text = [
      'Điều 1. Phạm vi điều chỉnh',
      'Luật này quy định về nhà ở.',
      '',
      'Điều 2. Giải thích từ ngữ',
      'Nhà ở là công trình xây dựng.',
    ].join('\n')

    const chunks = chunkLegalText(text)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.heading).toBe('Điều 1. Phạm vi điều chỉnh')
    expect(chunks[0]?.text).toContain('Luật này quy định về nhà ở.')
    expect(chunks[1]?.heading).toBe('Điều 2. Giải thích từ ngữ')
    expect(chunks.map(c => c.order)).toEqual([0, 1])
  })

  it('carries the last Chương line as context prefix for articles', () => {
    const text = [
      'Chương I',
      'QUY ĐỊNH CHUNG',
      'Điều 1. Phạm vi',
      'Nội dung điều 1.',
      'Chương II',
      'THUÊ NHÀ',
      'Điều 2. Đặt cọc',
      'Nội dung điều 2.',
    ].join('\n')

    const chunks = chunkLegalText(text)
    const article1 = chunks.find(c => c.heading === 'Điều 1. Phạm vi')
    const article2 = chunks.find(c => c.heading === 'Điều 2. Đặt cọc')
    expect(article1?.text.startsWith('Chương I\n')).toBe(true)
    expect(article2?.text.startsWith('Chương II\n')).toBe(true)
    expect(article2?.text).not.toContain('Nội dung điều 1.')
  })

  it('does not duplicate a Chương heading as its own prefix', () => {
    const chunks = chunkLegalText('Chương I\nQUY ĐỊNH CHUNG\nNội dung.')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text.match(/Chương I/g)).toHaveLength(1)
  })

  it('splits a long article into overlapping chunks within maxChars', () => {
    const sentence =
      'Bên thuê phải đặt cọc đúng thời hạn theo hợp đồng đã ký kết. '
    const body = Array.from({ length: 40 }, () => sentence).join('')
    const text = `Điều 472. Hợp đồng thuê tài sản\n${body}`

    const maxChars = 300
    const overlap = 60
    const chunks = chunkLegalText(text, { maxChars, overlap })

    expect(chunks.length).toBeGreaterThan(3)
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(maxChars)
      expect(chunk.heading).toBe('Điều 472. Hợp đồng thuê tài sản')
    }
    // Consecutive chunks share text (overlap).
    const tailOfFirst = chunks[0]?.text.slice(-30) ?? ''
    const words = tailOfFirst.trim().split(/\s+/).slice(-2).join(' ')
    expect(chunks[1]?.text).toContain(words)
  })

  it('recognises Markdown headings', () => {
    const text = [
      '# Hướng dẫn thuê nhà',
      'Giới thiệu chung.',
      '## Hồ sơ cần chuẩn bị',
      'CCCD và hợp đồng lao động.',
    ].join('\n')

    const chunks = chunkLegalText(text)
    expect(chunks.map(c => c.heading)).toEqual([
      '# Hướng dẫn thuê nhà',
      '## Hồ sơ cần chuẩn bị',
    ])
  })

  it('falls back to paragraph windows when there are no headings', () => {
    const paragraph = 'Đoạn văn bản pháp lý không có tiêu đề rõ ràng. '.repeat(
      6
    )
    const text = [paragraph, paragraph, paragraph, paragraph].join('\n\n')

    const chunks = chunkLegalText(text, { maxChars: 400, overlap: 80 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.heading).toBeUndefined()
      expect(chunk.text.length).toBeLessThanOrEqual(400)
      expect(chunk.text.trim()).not.toBe('')
    }
  })

  it('normalises CRLF and CR line endings', () => {
    const chunks = chunkLegalText(
      'Điều 1. A\r\nNội dung A.\rĐiều 2. B\r\nNội dung B.'
    )
    expect(chunks.map(c => c.heading)).toEqual(['Điều 1. A', 'Điều 2. B'])
    expect(chunks.every(c => !c.text.includes('\r'))).toBe(true)
  })

  it('is deterministic and produces sequential order', () => {
    const text = 'Điều 1. A\nNội dung.\n\nĐiều 2. B\nNội dung khác.'
    const first = chunkLegalText(text)
    expect(chunkLegalText(text)).toEqual(first)
    expect(first.map(c => c.order)).toEqual(first.map((_, i) => i))
  })

  it('never emits empty chunks', () => {
    const chunks = chunkLegalText('Điều 1.\n\n\n\nĐiều 2.\n   \n')
    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      expect(chunk.text.trim()).not.toBe('')
    }
  })
})
