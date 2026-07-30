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
                anyOf: [{ type: 'number' }, { type: 'string' }],
                description:
                  'Giá thuê phòng tối đa hàng tháng bằng Việt Nam Đồng (VNĐ). Ví dụ: 15000000.',
              },
              bedrooms: {
                anyOf: [{ type: 'number' }, { type: 'string' }],
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
                  'Mã định danh MongoDB hoặc tiêu đề căn hộ thu được từ kết quả tìm kiếm.',
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

  async chat(
    messages: ChatMessage[],
    disableTools = false
  ): Promise<{
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

Quy tắc quan trọng về luồng xử lý (BẮT BUỘC TUÂN THỦ TỪNG BƯỚC):
1. BƯỚC TÌM KIẾM (Search Intent): Khi khách hàng gõ từ khóa tìm kiếm (ví dụ: "Tìm căn hộ Vinhomes 2PN"), bạn CHỈ ĐƯỢC GỌI tool \`search_apartments\`. TUYỆT ĐỐI KHÔNG tự ý gọi \`request_booking\` hay \`create_booking_draft\`. CHỈ điền các tham số lọc khi người dùng thực sự cung cấp. Tuyệt đối không tự ý giả định hay bịa thêm tham số. Khi giới thiệu kết quả, hãy mô tả ngắn gọn thông tin căn hộ kèm tên & SĐT chủ nhà từ tool.
2. BƯỚC HIỂN THỊ FORM ĐẶT LỊCH (Booking Request): Bạn CHỈ gọi tool \`request_booking\` khi người dùng thể hiện rõ ý định muốn đặt lịch xem một căn hộ cụ thể (ví dụ: bấm nút "Đặt lịch" hoặc nói "Cho tôi xem căn hộ này" / "Tôi muốn đặt lịch xem nhà").
   - KẾ THỪA CĂN HỘ TỪ LỊCH SỬ: Nếu khách hàng nói "Tôi muốn đặt lịch xem nhà" mà trước đó phiên chat từng nhắc đến/tìm kiếm căn hộ X, bạn ĐƯỢC PHÉP kế thừa ID căn hộ X đó để gọi tool \`request_booking\`.
   - KHI GỌI TOOL \`request_booking\`: Văn bản câu trả lời của bạn BẮT BUỘC CHỈ ĐƯỢC LÀ LỜI MỜI người dùng chọn ngày giờ (ví dụ: "Dưới đây là thẻ đặt lịch xem căn hộ [Tên căn hộ]. Bạn vui lòng chọn ngày và giờ phù hợp ở khung bên dưới:").
   - TUYỆT ĐỐI KHÔNG ĐƯỢC đọc các tin nhắn xác nhận lịch cũ trong lịch sử hội thoại để ghi "Lịch hẹn xem nhà đã được đặt thành công!" ở bước này vì người dùng đang yêu cầu lên lịch xem phòng MỚI, CHƯA chọn ngày giờ và CHƯA bấm nút xác nhận.
3. BƯỚC XÁC NHẬN ĐẶT LỊCH NHÁP (Confirm Booking Draft): Bạn CHỈ gọi tool \`create_booking_draft\` khi nhận được tin nhắn từ client chứa ngày giờ cụ thể được gửi từ Form chọn lịch (ví dụ: "Đặt lịch xem căn hộ [Tên] vào lúc [Giờ] ngày [Ngày]"). CHỈ KHI tool \`create_booking_draft\` đã thực thi xong, lúc này câu trả lời của bạn MỚI ĐƯỢC PHÉP thông báo: "Lịch hẹn xem nhà đã được đặt thành công! Bạn sẽ xem căn hộ [Tên căn hộ] vào lúc [Giờ] ngày [Ngày]...".
4. Khác:
   - TUYỆT ĐỐI KHÔNG hiển thị mã định danh kỹ thuật (ID căn hộ / MongoDB ObjectId) trong văn bản gửi cho khách hàng.
   - Nếu khách hàng hỏi quy trình, điều khoản hay FAQ chung chung, giải thích rõ bằng văn bản và không gọi bất kỳ tool nào.
   - Trả lời ngắn gọn, lịch sự, trực diện, không dài dòng.`

    // Safe sliding window: keep up to 5 user turns (including their subsequent tool calls & assistant replies)
    // to optimize token usage and avoid context dilution, while preserving tool calling structure.
    const MAX_USER_TURNS = 5
    let userTurnCount = 0
    let sliceIndex = 0

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg && msg.role === 'user') {
        userTurnCount++
        if (userTurnCount > MAX_USER_TURNS) {
          sliceIndex = i + 1
          break
        }
      }
    }
    const slicedMessages = messages.slice(sliceIndex)

    const fullMessages = [
      { role: 'system', content: systemPrompt },
      ...slicedMessages.map(m => ({
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
            ...(disableTools ? {} : { tools: this.getTools() }),
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
        ...(parsedToolCalls ? { toolCalls: parsedToolCalls } : {}),
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
