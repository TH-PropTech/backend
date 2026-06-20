import { Injectable, Logger } from '@nestjs/common'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

@Injectable()
export class GroqLlmService {
  private readonly logger = new Logger(GroqLlmService.name)
  private readonly defaultApiKey = process.env.GROQ_API_KEY || ''
  private readonly defaultModel = 'llama-3.3-70b-versatile'

  async chat(messages: ChatMessage[], customApiKey?: string): Promise<string> {
    const apiKey = customApiKey || this.defaultApiKey
    if (!apiKey) {
      this.logger.error('GROQ_API_KEY is not configured.')
      return 'Xin lỗi, khóa API Groq chưa được cấu hình.'
    }

    try {
      const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
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
        }
      )

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
