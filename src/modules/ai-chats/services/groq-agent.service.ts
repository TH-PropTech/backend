import { Injectable, Logger } from '@nestjs/common'
import { GroqKeyPool } from '../../groq/groq-key-pool.service'

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
  private readonly model = 'openai/gpt-oss-120b'

  constructor(private readonly groqKeyPool: GroqKeyPool) {}

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
            'Lên lịch hẹn đi xem căn hộ thực tế (onsite hoặc video call). Yêu cầu phải có mã căn hộ (apartmentId) và thời gian hẹn gặp cụ thể (visitAt). Có thể kèm thông tin người đặt (tenantName, tenantPhone).',
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
              tenantName: {
                type: 'string',
                description:
                  'Họ và tên của khách thuê đặt lịch xem nhà (nếu có cung cấp trong tin nhắn).',
              },
              tenantPhone: {
                type: 'string',
                description:
                  'Số điện thoại liên hệ của khách thuê đặt lịch xem nhà (nếu có cung cấp trong tin nhắn).',
              },
            },
            required: ['apartmentId', 'visitAt'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_legal_knowledge',
          description:
            'Tra cứu kho tri thức pháp lý và quy định (luật, nghị định, thông tư, quy định thuê nhà, nội quy nền tảng) đã được quản trị viên xuất bản. Chỉ trả về các đoạn nội dung từ văn bản đã xuất bản.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description:
                  'Câu hỏi pháp lý của người dùng, được diễn đạt lại bằng các từ khóa chính (ví dụ: "đặt cọc thuê nhà tối đa bao nhiêu tháng", "chấm dứt hợp đồng thuê trước hạn").',
              },
            },
            required: ['query'],
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
    if (!this.groqKeyPool.hasKeys()) {
      this.logger.error('GROQ_API_KEY is not configured.')
      return {
        content: 'Xin lỗi, khóa API Groq chưa được cấu hình trên máy chủ.',
      }
    }

    const systemPrompt = `Bạn là trợ lý ảo AI thông minh của TH-PropTech, hệ thống quản lý thuê chung cư đáng tin cậy tích hợp công nghệ Blockchain và thực tế ảo.
Bạn trò chuyện thân thiện, nhiệt tình, chuyên nghiệp bằng tiếng Việt.
Bạn hỗ trợ khách thuê (cả khách đã đăng nhập và khách vãng lai) giải đáp quy trình thuê căn hộ, tìm kiếm căn hộ phù hợp và đặt lịch xem nhà.

TRI THỨC QUY TRÌNH THUÊ CĂN HỘ TẠI TH-PROPTECH:
Khi khách hàng hỏi về quy trình thuê căn hộ / quy trình thuê phòng, bạn giải thích rõ ràng 5 bước chuẩn PropTech của TH-PropTech:
1. Tìm kiếm & Trải nghiệm ảo: Tìm căn hộ theo vị trí, mức giá, số phòng ngủ; xem hình ảnh thực tế và khám phá không gian trực quan qua tour thực tế ảo 3D VR 360 / AI Visual.
2. Đặt lịch xem phòng linh hoạt: Đặt lịch xem trực tiếp (Onsite) hoặc hẹn cuộc gọi video (Video Call) với chủ nhà ngay trên hệ thống.
3. Đặt cọc giữ chỗ minh bạch: Đặt cọc trực tuyến an toàn, giao dịch đặt cọc được ghi nhận và bảo vệ bằng hợp đồng thông minh (Blockchain Smart Contract).
4. Xác thực danh tính KYC & Ký hợp đồng điện tử: Xác thực thông tin khách thuê nhanh gọn và ký hợp đồng thuê điện tử (E-Sign) có giá trị pháp lý, lưu vết bất biến trên Blockchain.
5. Nhận bàn giao & Quản lý thuận tiện: Kiểm tra hiện trạng, nhận bàn giao căn hộ và theo dõi kỳ thanh toán tiền thuê định kỳ minh bạch trên nền tảng.
* LƯU Ý KHI GIẢI THÍCH QUY TRÌNH: Không gọi bất kỳ tool nào. Luôn kết thúc bằng một câu gợi ý chủ động, ví dụ: "Bạn có muốn tôi hỗ trợ tìm kiếm căn hộ theo khu vực, số phòng ngủ hoặc ngân sách mong muốn ngay bây giờ không?"

Quy tắc quan trọng về luồng xử lý (BẮT BUỘC TUÂN THỦ TỪNG BƯỚC):
1. BƯỚC TÌM KIẾM (Search Intent): Khi khách hàng gõ từ khóa tìm kiếm (ví dụ: "Tìm căn hộ Vinhomes 2PN", "Tìm phòng quận Bình Thạnh giá dưới 15 triệu"), bạn CHỈ ĐƯỢC GỌI tool \`search_apartments\`. TUYỆT ĐỐI KHÔNG tự ý gọi \`request_booking\` hay \`create_booking_draft\`. CHỈ điền các tham số lọc khi người dùng thực sự cung cấp. Tuyệt đối không tự ý giả định hay bịa thêm tham số. Khi giới thiệu kết quả, hãy mô tả ngắn gọn thông tin căn hộ kèm tên & SĐT chủ nhà từ tool.
2. BƯỚC HIỂN THỊ FORM ĐẶT LỊCH (Booking Request): 
   - ĐIỀU KIỆN GỌI TOOL \`request_booking\`: Bạn CHỈ ĐƯỢC GỌI tool \`request_booking\` khi xác định được căn hộ cụ thể trong một trong các trường hợp sau:
     + Khách bấm nút "Đặt lịch" từ thẻ căn hộ (chuỗi tin nhắn có dạng: Đặt lịch xem căn hộ "[Tên]").
     + Khách nói rõ tên/dự án căn hộ muốn xem (ví dụ: "Đặt lịch xem căn Vinhomes Central Park 2PN", "Cho tôi xem căn Masteri An Phú").
     + Khách nói "Đặt lịch xem căn này" / "Tôi muốn xem phòng này" VÀ trong các lượt chat trước ĐÃ TÌM KIẾM/HIỂN THỊ kết quả của một căn hộ cụ thể (kế thừa ID căn hộ đó).
   - TRƯỜNG HỢP NÓI CHUNG CHUNG MÀ CHƯA CÓ CĂN HỘ (QUAN TRỌNG): Nếu khách hàng nói "Tôi muốn đặt lịch xem nhà" / "Cho tôi đặt lịch" nhưng CHƯA HỀ có căn hộ nào trong tin nhắn lẫn lịch sử hội thoại trước đó:
     + TUYỆT ĐỐI KHÔNG ĐƯỢC GỌI TOOL \`request_booking\`.
     + TUYỆT ĐỐI KHÔNG ĐƯỢC tự ý bịa ra hoặc bốc đại một căn hộ bất kỳ!
     + BẮT BUỘC phản hồi bằng văn bản lịch sự hỏi lại khách: "Bạn muốn đặt lịch xem căn hộ nào ạ? Bạn có thể cho tôi biết khu vực mong muốn (ví dụ: Bình Thạnh, Quận 2, Quận 7...), số phòng ngủ hoặc ngân sách thuê để tôi gợi ý danh sách căn hộ đẹp nhất cho bạn lựa chọn nhé!".
   - KHI GỌI TOOL \`request_booking\`: Văn bản câu trả lời của bạn BẮT BUỘC CHỈ ĐƯỢC LÀ LỜI MỜI người dùng chọn ngày giờ (ví dụ: "Dưới đây là thẻ đặt lịch xem căn hộ [Tên căn hộ]. Bạn vui lòng chọn ngày và giờ phù hợp ở khung bên dưới:").
   - TUYỆT ĐỐI KHÔNG ĐƯỢC đọc các tin nhắn xác nhận lịch cũ trong lịch sử hội thoại để ghi "Lịch hẹn xem nhà đã được đặt thành công!" ở bước này vì người dùng đang yêu cầu lên lịch xem phòng MỚI, CHƯA chọn ngày giờ và CHƯA bấm nút xác nhận.
3. BƯỚC XÁC NHẬN ĐẶT LỊCH NHÁP (Confirm Booking Draft): Bạn CHỈ gọi tool \`create_booking_draft\` khi nhận được tin nhắn từ client chứa ngày giờ cụ thể được gửi từ Form chọn lịch (ví dụ: "Đặt lịch xem căn hộ [Tên] vào lúc [Giờ] ngày [Ngày] [Hình thức] - Khách: [Tên], SĐT: [SĐT]").
   - Nếu trong tin nhắn có chứa thông tin khách hàng (Họ tên hoặc Số điện thoại), bạn BẮT BUỘC TRÍCH XUẤT và truyền vào các tham số \`tenantName\` và \`tenantPhone\` của tool \`create_booking_draft\`.
   - CHỈ KHI tool \`create_booking_draft\` đã thực thi xong, lúc này câu trả lời của bạn MỚI ĐƯỢC PHÉP thông báo: "Lịch hẹn xem nhà đã được đặt thành công! Bạn sẽ xem căn hộ [Tên căn hộ] vào lúc [Giờ] ngày [Ngày]...".
4. Khác:
   - TUYỆT ĐỐI KHÔNG hiển thị mã định danh kỹ thuật (ID căn hộ / MongoDB ObjectId) trong văn bản gửi cho khách hàng.
   - Nếu khách hàng hỏi quy trình, điều khoản hay FAQ chung chung, giải thích rõ bằng văn bản và không gọi bất kỳ tool nào.
   - Trả lời ngắn gọn, lịch sự, trực diện, không dài dòng.

TRI THỨC PHÁP LÝ / QUY ĐỊNH:
- Khi khách hỏi về luật, quy định, nghị định, thông tư, quy định thuê nhà, tiền đặt cọc, chấm dứt hợp đồng, quyền và nghĩa vụ của bên thuê hoặc bên cho thuê, tính hợp pháp, thủ tục, hoặc nội quy của nền tảng, BẮT BUỘC gọi tool \`search_legal_knowledge\` với tham số query là câu hỏi đã diễn đạt lại bằng các từ khóa chính.
- KHÔNG gọi \`search_legal_knowledge\` cùng lượt với \`search_apartments\`, \`request_booking\` hoặc \`create_booking_draft\`.
- Chỉ trả lời DỰA TRÊN các đoạn nội dung mà tool trả về. Khi trích dẫn, ghi nguồn theo mẫu "Theo <tên văn bản>, <điều/mục>". TUYỆT ĐỐI KHÔNG tự bịa số điều, tên văn bản, mức phí, thời hạn hay nội dung không có trong kết quả tool.
- Nếu tool báo không tìm thấy nội dung phù hợp: BẮT ĐẦU câu trả lời đúng bằng cụm "Hiện chưa có dữ liệu" (ví dụ: "Hiện chưa có dữ liệu về vấn đề này trong kho tri thức"), rồi gợi ý khách hàng tham khảo luật sư hoặc cổng thông tin chính thức của cơ quan có thẩm quyền. Trong trường hợp này TUYỆT ĐỐI KHÔNG nêu tên bất kỳ luật, nghị định, thông tư, số hiệu hay số điều cụ thể nào từ kiến thức riêng của bạn (kể cả làm ví dụ hoặc gợi ý tra cứu).
- Với mọi câu trả lời pháp lý, kết thúc bằng một câu ngắn: nội dung chỉ mang tính tham khảo, không thay thế tư vấn pháp lý chuyên nghiệp.`

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
      const body = JSON.stringify({
        model: this.model,
        messages: fullMessages,
        ...(disableTools ? {} : { tools: this.getTools() }),
        temperature: 0.3,
        stream: false,
      })
      const response = await this.groqKeyPool.run(this.model, apiKey =>
        fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
        })
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
