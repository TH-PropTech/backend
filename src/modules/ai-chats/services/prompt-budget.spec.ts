import {
  estimateTokens,
  fitMessagesToBudget,
  type BudgetMessage,
} from './prompt-budget'

const msg = (role: string, content: string): BudgetMessage => ({
  role,
  content,
})

describe('fitMessagesToBudget', () => {
  it('keeps everything when it already fits', () => {
    const messages = [msg('user', 'chào'), msg('assistant', 'xin chào')]
    expect(fitMessagesToBudget(100, messages, 1000)).toEqual(messages)
  })

  it('drops the oldest whole turns first and keeps the latest turn', () => {
    const big = 'a'.repeat(2400)
    const messages = [
      msg('user', 'câu hỏi cũ'),
      msg('assistant', big),
      msg('user', 'câu hỏi mới'),
      msg('assistant', 'trả lời mới'),
    ]
    const fitted = fitMessagesToBudget(0, messages, 300)
    expect(fitted.map(m => m.content)).toEqual(['câu hỏi mới', 'trả lời mới'])
  })

  it('never starts mid-turn: a tool result is not left without its user turn', () => {
    const messages = [
      msg('user', 'cũ'),
      { role: 'assistant', content: '', tool_calls: [{ id: '1' }] },
      msg('tool', 'b'.repeat(2400)),
      msg('user', 'mới'),
    ]
    const fitted = fitMessagesToBudget(0, messages, 200)
    expect(fitted[0]?.role).toBe('user')
    expect(fitted.some(m => m.role === 'tool')).toBe(false)
  })

  it('shortens the longest tool result of the latest turn when it still does not fit', () => {
    const toolText = `${'Đoạn một.\n'.repeat(400)}`
    const messages = [msg('user', 'hỏi'), msg('tool', toolText)]
    const fitted = fitMessagesToBudget(0, messages, 400)
    const tool = fitted.find(m => m.role === 'tool')
    expect((tool?.content ?? '').length).toBeLessThan(toolText.length)
    expect(tool?.content).toContain('đã rút gọn')
    expect(fitted[0]?.content).toBe('hỏi')
  })

  it('does not mutate the input', () => {
    const messages = [msg('user', 'x'.repeat(5000))]
    const copy = JSON.parse(JSON.stringify(messages)) as BudgetMessage[]
    fitMessagesToBudget(0, messages, 100)
    expect(messages).toEqual(copy)
  })
})

describe('estimateTokens', () => {
  it('counts more tokens for longer text', () => {
    expect(estimateTokens('a'.repeat(240))).toBe(100)
    expect(estimateTokens('')).toBe(0)
  })
})
