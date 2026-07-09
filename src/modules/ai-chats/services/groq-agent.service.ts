import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

@Injectable()
export class GroqAgentService {
  private readonly logger = new Logger(GroqAgentService.name)
  private readonly apiKey: string
  private readonly model: string

  constructor(private readonly configService: ConfigService) {
    this.apiKey =
      this.configService.get<string>('GROQ_API_KEY') ||
      process.env.GROQ_API_KEY ||
      ''
    this.model = 'llama-3.3-70b-versatile'
  }

  getTools(): unknown[] {
    return [
      {
        type: 'function',
        function: {
          name: 'search_apartments',
          description:
            'Tìm kiếm danh sách căn hộ chung cư đang trống và hoạt động dựa trên các tiêu chí lọc như vị trí/dự án, giá thuê tối đa, và số lượng phòng ngủ.',
          parameters: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description:
                  'Tên quận, khu vực hoặc tên chung cư/dự án (ví dụ: Quận 7, Bình Thạnh, Vinhomes Central Park).',
              },
              maxPrice: {
                type: 'number',
                description:
                  'Giá thuê phòng tối đa hàng tháng bằng Việt Nam Đồng (VNĐ). Ví dụ: 15000000.',
              },
              bedrooms: {
                type: 'number',
                description: 'Số lượng phòng ngủ mong muốn (ví dụ: 1, 2, 3).',
              },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'request_booking',
          description:
            'Hiển thị thẻ đặt lịch xem nhà tương tác (Interactive Booking Card) để người dùng chọn nhanh ngày và giờ trực quan.',
          parameters: {
            type: 'object',
            properties: {
              apartmentId: {
                type: 'string',
                description: 'Mã ID căn hộ cần đặt lịch hẹn xem phòng.',
              },
            },
            required: ['apartmentId'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'create_booking_draft',
          description:
            'Lên lịch hẹn đi xem căn hộ thực tế (onsite hoặc video call). Yêu cầu phải có mã căn hộ (apartmentId) và thời gian hẹn gặp cụ thể (visitAt).',
          parameters: {
            type: 'object',
            properties: {
              apartmentId: {
                type: 'string',
                description:
                  'Mã định danh duy nhất của căn hộ (ví dụ: 60f7a9...).',
              },
              visitAt: {
                type: 'string',
                description:
                  'Thời gian đi xem căn hộ định dạng ISO 8601 (ví dụ: 2026-06-28T09:00:00Z).',
              },
              method: {
                type: 'string',
                enum: ['onsite', 'video'],
                description:
                  'Hình thức xem căn hộ: onsite (trực tiếp tại căn hộ) hoặc video (cuộc gọi video). Mặc định là onsite.',
              },
            },
            required: ['apartmentId', 'visitAt'],
          },
        },
      },
    ]
  }

  async chat(messages: ChatMessage[]): Promise<{
    content: string | null
    toolCalls?: ToolCall[]
  }> {
    if (!this.apiKey) {
      this.logger.error('GROQ_API_KEY is not configured.')
      return {
        content: 'Xin lỗi, khóa API Groq chưa được cấu hình trên máy chủ.',
      }
    }

    const systemPrompt = `Bạn là trợ lý ảo AI thông minh của TH-PropTech, hệ thống quản lý thuê chung cư đáng tin cậy.
Bạn trò chuyện thân thiện bằng tiếng Việt.
Bạn hỗ trợ khách thuê (cả khách đăng nhập và khách vãng lai) giải đáp quy trình thuê căn hộ, tìm kiếm căn hộ phù hợp và đặt lịch xem nhà.

Quy tắc quan trọng:
1. Nếu khách hàng muốn tìm kiếm hoặc hỏi về căn hộ theo nhu cầu (khu vực, giá, phòng ngủ), hãy sử dụng tool search_apartments để tìm kiếm. Không tự bịa thông tin căn hộ.
2. Khi giới thiệu căn hộ, luôn hiển thị thông tin chủ nhà (Họ tên, SĐT) dựa trên dữ liệu trả về từ tool.
3. TUYỆT ĐỐI KHÔNG hiển thị mã định danh kỹ thuật (ID căn hộ / MongoDB ObjectId như 60f7a9...) trong văn bản trò chuyện gửi cho khách hàng. Chỉ sử dụng tên căn hộ (ví dụ: "Căn hộ Vinhomes Central Park 2PN") để trao đổi.
4. Khi khách hàng bày tỏ mong muốn đặt lịch hẹn hoặc đồng ý đi xem một căn hộ cụ thể, hãy gọi ngay tool request_booking với ID căn hộ đó để hiển thị Thẻ Đặt Lịch Tương Tác cho họ chọn ngày/giờ trực tiếp. Không tự hỏi thời gian bằng văn bản.
5. Khi người dùng bấm nút xác nhận trên Thẻ Đặt Lịch, hệ thống client sẽ gửi lên tin nhắn chứa ngày giờ cụ thể (ví dụ: "Đặt lịch xem căn hộ [Tên Căn Hộ] vào lúc [Giờ] ngày [Ngày]"). Khi nhận tin nhắn này, hãy lập tức trích xuất ngày giờ và ID căn hộ tương ứng để gọi tool create_booking_draft.
6. Trả lời ngắn gọn, lịch sự, trực diện, không dài dòng. Không dùng markdown quá phức tạp ngoài dạng gạch đầu dòng.`

    const fullMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role,
        content: m.content || '',
        name: m.name,
        tool_call_id: m.tool_call_id,
        tool_calls: m.tool_calls,
      })),
    ]

    try {
      const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            messages: fullMessages,
            tools: this.getTools(),
            temperature: 0.3,
            stream: false,
          }),
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
          `Groq API request failed with status ${response.status}: ${errorText}`
        )
      }

      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null
            tool_calls?: Array<{
              id: string
              type: 'function'
              function: {
                name: string
                arguments: string | Record<string, unknown>
              }
            }>
          }
        }>
      }

      const choice = data.choices?.[0]?.message
      if (!choice) {
        throw new Error('Invalid response structure from Groq')
      }

      let parsedToolCalls: ToolCall[] | undefined
      if (choice.tool_calls && choice.tool_calls.length > 0) {
        parsedToolCalls = choice.tool_calls.map(tc => {
          let args: Record<string, unknown> = {}
          try {
            args =
              typeof tc.function.arguments === 'string'
                ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
                : tc.function.arguments
          } catch {
            this.logger.error(
              'Failed to parse tool call arguments:',
              tc.function.arguments
            )
          }
          return {
            id: tc.id,
            type: tc.type,
            function: {
              name: tc.function.name,
              arguments: args,
            },
          }
        })
      }

      return {
        content: choice.content || null,
        toolCalls: parsedToolCalls,
      }
    } catch (error) {
      this.logger.error('Error during chat completion with Groq:', error)
      return {
        content:
          'Xin lỗi, trợ lý AI đang gặp sự cố kết nối. Vui lòng thử lại sau ít phút.',
      }
    }
  }
}
