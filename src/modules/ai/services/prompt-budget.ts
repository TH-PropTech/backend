/**
 * Keeps every Groq request inside the per-minute token limit (8,000 TPM on the
 * on_demand tier), so a long history
 * or a big knowledge excerpt can no longer push a request over the limit.
 */

/** Vietnamese with diacritics costs about 2.4 characters per token; assume less to stay safe. */
const CHARS_PER_TOKEN = 2.4
/** Per-message framing overhead (role, separators). */
const MESSAGE_OVERHEAD_TOKENS = 6
/** Input budget: system prompt + tool definitions + history + tool results. */
export const INPUT_TOKEN_BUDGET = 3800
/** Never shrink a single tool result below this many characters. */
const MIN_TOOL_CHARS = 400
const TRUNCATION_NOTE = '\n…(đã rút gọn cho vừa giới hạn)'

export interface BudgetMessage {
  role: string
  content?: string | null
  tool_calls?: unknown
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function messageTokens(message: BudgetMessage): number {
  const toolCalls = message.tool_calls ? JSON.stringify(message.tool_calls) : ''
  return (
    MESSAGE_OVERHEAD_TOKENS +
    estimateTokens(message.content ?? '') +
    estimateTokens(toolCalls)
  )
}

function totalTokens(
  fixedTokens: number,
  messages: readonly BudgetMessage[]
): number {
  return messages.reduce((sum, m) => sum + messageTokens(m), fixedTokens)
}

/**
 * Returns `messages` (never mutated) trimmed to fit `budget` once `fixedTokens`
 * (system prompt and tool definitions) are counted:
 *  1. drop the oldest whole turns (a user message and everything up to the next
 *     user message), keeping tool-call structure valid;
 *  2. if the latest turn is still too big, shorten its longest tool results.
 * The latest user message is always kept as is.
 */
export function fitMessagesToBudget<T extends BudgetMessage>(
  fixedTokens: number,
  messages: readonly T[],
  budget: number = INPUT_TOKEN_BUDGET
): T[] {
  let fitted = [...messages]

  while (totalTokens(fixedTokens, fitted) > budget) {
    const nextTurn = fitted.findIndex(
      (m, index) => index > 0 && m.role === 'user'
    )
    if (nextTurn < 0) break
    fitted = fitted.slice(nextTurn)
  }

  const over = totalTokens(fixedTokens, fitted) - budget
  if (over <= 0) return fitted

  let overChars = Math.ceil(over * CHARS_PER_TOKEN)
  const toolIndexes = fitted
    .map((m, index) => ({ m, index }))
    .filter(({ m }) => m.role === 'tool')
    .sort((a, b) => (b.m.content?.length ?? 0) - (a.m.content?.length ?? 0))

  for (const { m, index } of toolIndexes) {
    if (overChars <= 0) break
    const content = m.content ?? ''
    const target = Math.max(MIN_TOOL_CHARS, content.length - overChars)
    if (target >= content.length) continue
    const cut = content.slice(0, target)
    const boundary = cut.lastIndexOf('\n')
    const kept = boundary > target * 0.6 ? cut.slice(0, boundary) : cut
    fitted[index] = { ...m, content: `${kept}${TRUNCATION_NOTE}` }
    overChars -= content.length - kept.length
  }
  return fitted
}
