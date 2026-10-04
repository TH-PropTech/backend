import { Injectable, Logger } from '@nestjs/common'
import { GroqKeyPool } from '../../groq/groq-key-pool.service'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

@Injectable()
export class GroqLlmService {
  private readonly logger = new Logger(GroqLlmService.name)
  private readonly defaultModel = 'llama-3.3-70b-versatile'

  constructor(private readonly groqKeyPool: GroqKeyPool) {}

  async chat(messages: ChatMessage[], customApiKey?: string): Promise<string> {
    if (!customApiKey && !this.groqKeyPool.hasKeys()) {
      this.logger.error('GROQ_API_KEY is not configured.')
      return 'Xin lỗi, khóa API Groq chưa được cấu hình.'
    }

    const send = (apiKey: string): Promise<Response> =>
      fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.defaultModel,
          messages,
          temperature: 0.7,
          max_tokens: 150,
        }),
      })

    try {
      // A key supplied by the session is the caller's own: no rotation.
      const response = customApiKey
        ? await send(customApiKey)
        : await this.groqKeyPool.run(this.defaultModel, send)

      if (!response.ok) {
        throw new Error(`Groq API request failed: ${response.statusText}`)
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      return data.choices?.[0]?.message?.content?.trim() || ''
    } catch (error) {
      this.logger.error('Error during chat completion with Groq:', error)
      return 'Có lỗi kết nối với trợ lý AI, xin vui lòng thử lại.'
    }
  }
}
