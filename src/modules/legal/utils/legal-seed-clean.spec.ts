import { cleanPortalProcedure, cleanSourceText } from './legal-seed-clean'

describe('cleanSourceText', () => {
  it('drops the contact box and table of contents before the issuing body', () => {
    const raw = [
      '0971.654.238',
      '[email protected]',
      '',
      'Hướng dẫn sử dụng',
      '|',
      'Liên hệ',
      '',
      'MỤC LỤC',
      '',
      '- Điều 1. Phạm vi điều chỉnh',
      '',
      '|',
      'QUỐC HỘI',
      '--------',
      'Luật số: 27/2023/QH15',
      'Điều 1. Phạm vi điều chỉnh',
      'Nội dung điều 1.',
    ].join('\n')
    const cleaned = cleanSourceText(raw)
    expect(cleaned.startsWith('QUỐC HỘI')).toBe(true)
    expect(cleaned).toContain('Nội dung điều 1.')
    expect(cleaned).not.toContain('0971.654.238')
    expect(cleaned).not.toContain('MỤC LỤC')
  })

  it('only strips header noise when no issuing body marker exists', () => {
    const raw = [
      '0971.654.238',
      '[email protected]',
      'Hướng dẫn sử dụng',
      'Liên hệ',
      'MỤC LỤC',
      'In mục lục',
      '',
      '- LUẬT CƯ TRÚ',
      'Điều 1. Phạm vi điều chỉnh',
    ].join('\n')
    expect(cleanSourceText(raw)).toBe(
      '- LUẬT CƯ TRÚ\nĐiều 1. Phạm vi điều chỉnh'
    )
  })

  it('removes the sign-in footer and related-reading list', () => {
    const raw =
      'Điều 1. A\n\nNội dung.\n\nVui lòng\n\nĐăng ký\n\ntài khoản hoặc đăng nhập'
    expect(cleanSourceText(raw)).toBe('Điều 1. A\n\nNội dung.')
    expect(
      cleanSourceText('Hợp đồng\n\nNội dung.\n\n- Tham khảo thêm\n\nMẫu khác')
    ).toBe('Hợp đồng\n\nNội dung.')
  })

  it('ignores a body marker that sits late in the page', () => {
    const raw = `${'Dòng nội dung dài.\n'.repeat(50)}\nQUỐC HỘI\n--------\nVăn bản khác`
    expect(cleanSourceText(raw)).toContain('Dòng nội dung dài.')
  })

  it('leaves clean text unchanged', () => {
    expect(cleanSourceText('Điều 1. A\n\nNội dung.')).toBe(
      'Điều 1. A\n\nNội dung.'
    )
  })
})

describe('cleanPortalProcedure', () => {
  const page = [
    'Đăng nhập',
    'Thông tin và dịch vụ',
    'Chi tiết thủ tục',
    'Đăng ký tạm trú',
    'Tên thủ tục',
    'Đăng ký tạm trú',
    'Mã thủ tục',
    '1.116789',
    'Trình Tự Thực Hiện',
    'Bước 1: Chuẩn bị hồ sơ.',
    '',
    '',
    '',
    'Thành phần hồ sơ',
    'Tìm kiếm nhiều nhất',
    'Hưởng trợ cấp thất nghiệp (Cấp tỉnh)',
    'Bộ Nội vụ',
  ].join('\n')

  it('keeps only the procedure detail', () => {
    const cleaned = cleanPortalProcedure(page)
    expect(cleaned.startsWith('Tên thủ tục')).toBe(true)
    expect(cleaned).toContain('Bước 1: Chuẩn bị hồ sơ.')
    expect(cleaned).toContain('Thành phần hồ sơ')
    expect(cleaned).not.toContain('Thông tin và dịch vụ')
    expect(cleaned).not.toContain('Hưởng trợ cấp thất nghiệp')
    expect(cleaned).not.toMatch(/\n{3,}/)
  })

  it('returns the whole trimmed text when no markers exist', () => {
    expect(cleanPortalProcedure('  Nội dung bất kỳ  ')).toBe('Nội dung bất kỳ')
  })
})
