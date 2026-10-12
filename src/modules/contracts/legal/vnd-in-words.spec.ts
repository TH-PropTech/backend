import { vndInWords } from './vnd-in-words'

describe('vndInWords', () => {
  it.each([
    [0, 'không đồng'],
    [5, 'năm đồng'],
    [10, 'mười đồng'],
    [15, 'mười lăm đồng'],
    [21, 'hai mươi mốt đồng'],
    [24, 'hai mươi tư đồng'],
    [105, 'một trăm lẻ năm đồng'],
    [500_000, 'năm trăm nghìn đồng'],
    [1_000_000, 'một triệu đồng'],
    [12_500_000, 'mười hai triệu năm trăm nghìn đồng'],
    [15_000_005, 'mười lăm triệu không trăm lẻ năm đồng'],
    [1_005_000, 'một triệu không trăm lẻ năm nghìn đồng'],
    [2_000_000_000, 'hai tỷ đồng'],
    [
      1_234_567_891,
      'một tỷ hai trăm ba mươi tư triệu năm trăm sáu mươi bảy nghìn tám trăm chín mươi mốt đồng',
    ],
  ])('reads %i as "%s"', (amount, words) => {
    expect(vndInWords(amount)).toBe(words)
  })

  it('returns an empty string for invalid amounts instead of printing a wrong value', () => {
    expect(vndInWords(-1)).toBe('')
    expect(vndInWords(1.5)).toBe('')
    expect(vndInWords(Number.NaN)).toBe('')
    expect(vndInWords(undefined)).toBe('')
    expect(vndInWords(null)).toBe('')
  })
})
