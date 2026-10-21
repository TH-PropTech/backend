import { describe, expect, it } from 'vitest'
import { findScopeNotes, findUngroundedFigures } from './legal-answer-guard'

const evidence = [
  'Văn bản: Luật Nhà ở 2023 Số hiệu: 27/2023/QH15 Điều/mục: Điều 89. Bán, cho thuê mua, cho thuê nhà ở xã hội',
  'Nội dung: thu tiền đặt cọc thuê nhà ở tối đa bằng 12 tháng tiền thuê nhà tạm tính; số tiền ứng trước lần đầu không vượt quá 30% giá trị hợp đồng.',
  'Văn bản: Bộ luật Dân sự 2015 Điều/mục: Điều 328. Đặt cọc',
  'Bên thuê không trả đủ tiền thuê nhà từ 03 tháng trở lên mà không có lý do. Cập nhật từ nguồn: 2026-10-11, ngày 27/11/2023.',
].join('\n')

describe('findUngroundedFigures', () => {
  it('catches an invented duration in years or weeks and accepts the one in the passage', () => {
    expect(
      findUngroundedFigures(
        'Hợp đồng phải có thời hạn tối thiểu 5 năm.',
        evidence
      )
    ).toContain('5 năm')
    expect(
      findUngroundedFigures('Báo trước 2 tuần là đủ.', evidence)
    ).toContain('2 tuần')
    expect(
      findUngroundedFigures(
        'Hợp đồng thuê tối đa 50 năm.',
        evidence + ' Thời hạn thuê tối đa là 50 năm.'
      )
    ).toEqual([])
  })

  it('accepts an answer whose figures and references all come from the passages', () => {
    const answer =
      'Theo Luật Nhà ở 2023 (Điều 89), đặt cọc tối đa bằng 12 tháng tiền thuê; ứng trước không quá 30%. Theo Điều 328 Bộ luật Dân sự, đặt cọc là biện pháp bảo đảm.'
    expect(findUngroundedFigures(answer, evidence)).toEqual([])
  })

  it('catches the invented "tối đa hai (2) tháng" that the law does not say', () => {
    const answer =
      'Khoản đặt cọc khi thuê nhà ở không được vượt quá hai (2) tháng tiền thuê (Điều 89).'
    expect(findUngroundedFigures(answer, evidence)).toEqual(['2 tháng'])
  })

  it('catches invented rates and thresholds in a made-up comparison table', () => {
    const answer =
      '| Thuế suất | 10 % | giảm xuống 8 % |\n| Miễn giảm | dưới 30 triệu | nâng lên 40 triệu |'
    expect(findUngroundedFigures(answer, evidence).sort()).toEqual(
      ['10 %', '30 triệu', '40 triệu', '8 %'].sort()
    )
  })

  it('catches a decree or article number that is not in the passages', () => {
    const answer =
      'Theo Nghị định 100/2024/NĐ-CP và Điều 160 Luật Nhà ở, tiền cọc được quy định như sau.'
    expect(findUngroundedFigures(answer, evidence).sort()).toEqual(
      ['Điều 160', 'Nghị định 100/2024'].sort()
    )
  })

  it('treats 03 and 3, or 1.500.000 and 1500000, as the same number', () => {
    expect(findUngroundedFigures('Từ 3 tháng trở lên.', evidence)).toEqual([])
    expect(
      findUngroundedFigures('Giá 1.500.000 đồng.', 'phí là 1500000 đồng')
    ).toEqual([])
  })

  it('does not mistake dates for quantities', () => {
    const answer =
      'Luật được ban hành ngày 27 tháng 11 năm 2023, cập nhật 11/10/2026, hiệu lực từ tháng 8/2024.'
    expect(findUngroundedFigures(answer, evidence)).toEqual([])
  })

  it('ignores answers without any figure', () => {
    expect(
      findUngroundedFigures(
        'Hiện chưa có dữ liệu về vấn đề này trong kho tri thức.',
        evidence
      )
    ).toEqual([])
  })

  it('is case- and accent-insensitive for references', () => {
    expect(findUngroundedFigures('Xem ĐIỀU 89 của luật.', evidence)).toEqual([])
  })
})

describe('findScopeNotes', () => {
  const social = {
    title: 'Luật Nhà ở 2023',
    heading: 'Điều 89. Bán, cho thuê mua, cho thuê nhà ở xã hội',
  }

  it('flags an article about social housing when the question was about an ordinary rental', () => {
    const notes = findScopeNotes(
      'Đặt cọc thuê nhà tối đa bao nhiêu tháng?',
      'Theo Luật Nhà ở 2023 (Điều 89), tối đa 12 tháng.',
      [social]
    )
    expect(notes).toEqual([
      'Điều 89 (Luật Nhà ở 2023) chỉ nói về nhà ở xã hội, không phải quy định chung cho thuê nhà ở thông thường.',
    ])
  })

  it('stays quiet when the question was about that kind of housing', () => {
    expect(
      findScopeNotes(
        'Đặt cọc thuê nhà ở xã hội tối đa bao nhiêu?',
        'Điều 89 quy định 12 tháng.',
        [social]
      )
    ).toEqual([])
  })

  it('stays quiet when the answer does not rely on that article', () => {
    expect(
      findScopeNotes(
        'Đặt cọc thuê nhà?',
        'Theo Điều 328 Bộ luật Dân sự, đặt cọc là...',
        [social]
      )
    ).toEqual([])
  })

  it('flags a "thuê khoán" article used for a house rental, once per article', () => {
    const notes = findScopeNotes(
      'Chủ nhà đơn phương chấm dứt hợp đồng thuê khi nào?',
      'Theo Điều 492 và Điều 492 của Bộ luật Dân sự...',
      [
        {
          title: 'Bộ luật Dân sự 2015',
          heading:
            'Điều 492. Đơn phương chấm dứt thực hiện hợp đồng thuê khoán',
        },
        {
          title: 'Bộ luật Dân sự 2015',
          heading:
            'Điều 492. Đơn phương chấm dứt thực hiện hợp đồng thuê khoán',
        },
      ]
    )
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('thuê khoán')
  })

  it('ignores sources without an article heading', () => {
    expect(findScopeNotes('hỏi', 'trả lời', [{ title: 'Bài viết' }])).toEqual(
      []
    )
  })
})
