import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { AiChat, ChatMessage } from '../schemas/ai-chat.schema'
import {
  GroqAgentService,
  ChatMessage as LLMChatMessage,
} from './groq-agent.service'
import { ApartmentsService } from '../../apartments/apartments.service'
import { ApartmentFilterDto } from '../../apartments/dto/apartment-filter.dto'
import { BookingsService } from '../../bookings/bookings.service'
import { User } from '../../users/schemas/user.schema'
import { ObjectId } from 'mongodb'
import { RedisService } from '../../redis/redis.service'

interface SearchApartmentsArgs {
  location?: string
  bedrooms?: number | string
  maxPrice?: number | string
}

interface CreateBookingDraftArgs {
  apartmentId: string
  visitAt: string
  method?: 'onsite' | 'video'
  tenantName?: string
  tenantPhone?: string
}

@Injectable()
export class AiChatsService {
  private readonly logger = new Logger(AiChatsService.name)

  constructor(
    private readonly redisService: RedisService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly groqAgentService: GroqAgentService,
    private readonly apartmentsService: ApartmentsService,
    private readonly bookingsService: BookingsService
  ) {}

  private formatPhoneNumber(phone?: string): string {
    if (!phone) return ''
    let cleaned = phone.replace(/\D/g, '')
    if (cleaned.startsWith('84')) {
      cleaned = '0' + cleaned.slice(2)
    }
    // Chuyển đổi đầu số Mobifone 11 số cũ (0120, 0121, 0122, 0126, 0128) sang 10 số chuẩn
    if (cleaned.startsWith('0120') && cleaned.length === 11) {
      cleaned = '070' + cleaned.slice(4)
    } else if (cleaned.startsWith('0121') && cleaned.length === 11) {
      cleaned = '079' + cleaned.slice(4)
    } else if (cleaned.startsWith('0122') && cleaned.length === 11) {
      cleaned = '077' + cleaned.slice(4)
    } else if (cleaned.startsWith('0126') && cleaned.length === 11) {
      cleaned = '076' + cleaned.slice(4)
    } else if (cleaned.startsWith('0128') && cleaned.length === 11) {
      cleaned = '078' + cleaned.slice(4)
    }
    return cleaned
  }

  private async resolveApartmentId(
    sessionKey: { userId?: string; deviceId?: string },
    inputApartmentId?: string
  ): Promise<string | null> {
    if (inputApartmentId && inputApartmentId.trim() !== '') {
      // 1. Kiểm tra nếu inputApartmentId là ObjectId 24-hex và thực sự tồn tại trong DB
      if (ObjectId.isValid(inputApartmentId)) {
        try {
          const apt = await this.apartmentsService.findOne(inputApartmentId)
          if (apt && apt._id) {
            return apt._id.toString()
          }
        } catch {
          // ID 24-hex không tồn tại trong DB, tiếp tục tra cứu
        }
      }

      // 2. Tra cứu fuzzy theo tiêu đề/tên dự án trong Database từ input
      try {
        const apartments = await this.apartmentsService.findAll({
          search: inputApartmentId,
        })
        const firstApt = apartments?.[0]
        if (firstApt && firstApt._id) {
          return firstApt._id.toString()
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        this.logger.warn(`Lỗi tra cứu apartmentId theo tiêu đề: ${errMsg}`)
      }

      // 3. Trích xuất tên căn hộ trong ngoặc kép nếu có
      const titleMatch = inputApartmentId.match(/["'“]([^"'”]+)["'”]/)
      if (titleMatch && titleMatch[1]) {
        try {
          const apartments = await this.apartmentsService.findAll({
            search: titleMatch[1],
          })
          const firstApt = apartments?.[0]
          if (firstApt && firstApt._id) {
            return firstApt._id.toString()
          }
        } catch {
          // Ignore
        }
      }
    }

    // 4. Tra cứu trong lịch sử Redis Session gần nhất (với kiểm tra tồn tại thực tế trong DB)
    try {
      const chat = await this.getOrCreateSession(sessionKey)
      if (chat.messages && chat.messages.length > 0) {
        for (let i = chat.messages.length - 1; i >= 0; i--) {
          const msg = chat.messages[i]
          const meta = msg?.metadata
          const candidateId =
            meta?.bookingRequest?.apartmentId ||
            meta?.propertyCard?.id ||
            meta?.propertyCards?.[0]?.id

          if (candidateId && ObjectId.isValid(candidateId)) {
            try {
              const apt = await this.apartmentsService.findOne(candidateId)
              if (apt && apt._id) {
                return apt._id.toString()
              }
            } catch {
              // ID trong lịch sử không còn tồn tại trong DB, tiếp tục tìm ở tin nhắn cũ hơn
            }
          }
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      this.logger.warn(`Lỗi tra cứu apartmentId từ session metadata: ${errMsg}`)
    }

    return null
  }

  private getRedisKey(sessionKey: {
    userId?: string
    deviceId?: string
  }): string {
    const { userId, deviceId } = sessionKey
    return `ai-chat:session:${userId || deviceId}`
  }

  async getOrCreateSession(sessionKey: {
    userId?: string
    deviceId?: string
  }): Promise<AiChat> {
    const { userId, deviceId } = sessionKey
    const key = this.getRedisKey(sessionKey)

    const cached = await this.redisService.get(key)
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as AiChat
        if (parsed.createdAt) parsed.createdAt = new Date(parsed.createdAt)
        if (parsed.updatedAt) parsed.updatedAt = new Date(parsed.updatedAt)
        if (parsed.messages) {
          parsed.messages.forEach(m => {
            if (m.timestamp) m.timestamp = new Date(m.timestamp)
          })
        }
        return parsed
      } catch {
        this.logger.error(`Failed to parse cached chat session for key: ${key}`)
      }
    }

    const newChat: AiChat = {
      ...(userId ? { userId } : {}),
      ...(deviceId ? { deviceId } : {}),
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    await this.redisService.set(key, JSON.stringify(newChat), 3600)
    return newChat
  }

  async addMessage(
    sessionKey: { userId?: string; deviceId?: string },
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata?: ChatMessage['metadata']
  ): Promise<AiChat> {
    const chat = await this.getOrCreateSession(sessionKey)
    const newMessage: ChatMessage = {
      role,
      content,
      timestamp: new Date(),
      ...(metadata ? { metadata } : {}),
    }
    chat.messages.push(newMessage)

    if (chat.messages.length > 50) {
      chat.messages = chat.messages.slice(chat.messages.length - 50)
    }
    chat.updatedAt = new Date()

    const key = this.getRedisKey(sessionKey)
    await this.redisService.set(key, JSON.stringify(chat), 3600)
    return chat
  }

  async clearHistory(sessionKey: {
    userId?: string
    deviceId?: string
  }): Promise<void> {
    const key = this.getRedisKey(sessionKey)
    await this.redisService.del(key)
  }

  async handleUserMessage(
    sessionKey: { userId?: string; deviceId?: string },
    text: string,
    onChunk: (text: string) => void
  ): Promise<{ content: string; metadata?: ChatMessage['metadata'] }> {
    // 1. Add user message to history
    await this.addMessage(sessionKey, 'user', text)

    // 2. Load full history for LLM context
    const chat = await this.getOrCreateSession(sessionKey)
    const llmMessages: LLMChatMessage[] = chat.messages.map(m => ({
      role: m.role,
      content: m.content,
    }))

    this.logger.log(
      `Processing message for session (userId: ${sessionKey.userId || 'none'}, deviceId: ${sessionKey.deviceId || 'none'})`
    )

    // 3. Call Groq LLM
    let response = await this.groqAgentService.chat(llmMessages)

    let loopLimit = 3
    let metadata: ChatMessage['metadata'] = undefined
    let disableTools = false
    let lastBookingSuccessContent = ''

    // 4. Handle Tool Calls if LLM requests them
    while (
      response.toolCalls &&
      response.toolCalls.length > 0 &&
      loopLimit > 0
    ) {
      loopLimit--
      const toolCall = response.toolCalls[0]
      if (!toolCall) break

      this.logger.log(
        `LLM requested tool call: ${toolCall.function.name} with args ${JSON.stringify(toolCall.function.arguments)}`
      )

      let toolResultContent = ''

      if (toolCall.function.name === 'search_apartments') {
        const args = toolCall.function
          .arguments as unknown as SearchApartmentsArgs
        const location = args.location
        const bedrooms =
          args.bedrooms !== undefined &&
          args.bedrooms !== null &&
          args.bedrooms !== ''
            ? Number(args.bedrooms)
            : undefined
        const maxPrice =
          args.maxPrice !== undefined &&
          args.maxPrice !== null &&
          args.maxPrice !== ''
            ? Number(args.maxPrice)
            : undefined

        // Convert maxPrice from VNĐ to Millions VNĐ for ApartmentsService
        const filterMaxPrice = maxPrice ? maxPrice / 1000000 : undefined

        const filter: ApartmentFilterDto = {
          ...(location ? { search: location } : {}),
          ...(bedrooms !== undefined ? { bedrooms } : {}),
          ...(filterMaxPrice !== undefined ? { maxPrice: filterMaxPrice } : {}),
        }

        const apartments = await this.apartmentsService.findAll(filter)

        if (apartments && apartments.length > 0) {
          // Fetch landlord details for each apartment
          const apartmentsWithLandlord = await Promise.all(
            apartments.map(async apt => {
              let landlordName = 'Chưa xác định'
              let landlordPhone = ''
              if (apt.landlordId) {
                try {
                  const landlord = await this.userRepository.findOne({
                    where: { _id: new ObjectId(apt.landlordId) },
                  })
                  if (landlord) {
                    landlordName = landlord.fullName || 'Chưa xác định'
                    landlordPhone = this.formatPhoneNumber(landlord.phone)
                  }
                } catch (err) {
                  const errorObject = err as Record<string, unknown>
                  const errMsg =
                    errorObject && typeof errorObject.message === 'string'
                      ? errorObject.message
                      : String(err)
                  this.logger.error(
                    `Failed to fetch landlord details for chatbot: ${errMsg}`
                  )
                }
              }
              return {
                ...apt,
                landlordName,
                landlordPhone,
              }
            })
          )

          toolResultContent =
            `Tìm thấy ${apartmentsWithLandlord.length} căn hộ:\n` +
            apartmentsWithLandlord
              .map(apt => {
                const aptId = apt._id ? apt._id.toString() : 'unknown'
                return `- ID: ${aptId}, Tiêu đề: ${apt.title}, Giá: ${apt.priceMonthly}đ/tháng, Diện tích: ${apt.area}m2, Địa chỉ: ${apt.location || ''}, Chủ nhà: ${apt.landlordName}, SĐT chủ nhà: ${apt.landlordPhone}`
              })
              .join('\n')

          // Map all search results to return as metadata for visual carousel rendering
          const propertyCards = apartmentsWithLandlord.map(apt => {
            const aptId = apt._id ? apt._id.toString() : 'unknown'
            return {
              id: aptId,
              title: apt.title,
              price: apt.priceMonthly,
              image:
                apt.gallery?.[0] ||
                'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=600&q=80',
              location: apt.location || 'Bình Thạnh, TP.HCM',
              landlordName: apt.landlordName,
              landlordPhone: apt.landlordPhone,
            }
          })

          // Maintain backward compatibility by keeping single propertyCard as the first result
          const firstApt = apartmentsWithLandlord[0]
          if (firstApt) {
            const firstAptId = firstApt._id
              ? firstApt._id.toString()
              : 'unknown'

            metadata = {
              ...(metadata || {}),
              propertyCard: {
                id: firstAptId,
                title: firstApt.title,
                price: firstApt.priceMonthly,
                image:
                  firstApt.gallery?.[0] ||
                  'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=600&q=80',
                location: firstApt.location || 'Bình Thạnh, TP.HCM',
                landlordName: firstApt.landlordName,
                landlordPhone: firstApt.landlordPhone,
              },
              propertyCards,
            }
          }
        } else {
          toolResultContent = 'Không tìm thấy căn hộ nào phù hợp với yêu cầu.'
        }
      } else if (toolCall.function.name === 'create_booking_draft') {
        const args = toolCall.function
          .arguments as unknown as CreateBookingDraftArgs
        const inputApartmentId = args.apartmentId
        const visitAt = args.visitAt
        const method = args.method || 'onsite'
        const tenantName = args.tenantName
        const tenantPhone = args.tenantPhone

        const resolvedApartmentId = await this.resolveApartmentId(
          sessionKey,
          inputApartmentId
        )

        if (!resolvedApartmentId) {
          toolResultContent = `Không tìm thấy thông tin căn hộ với tham số "${inputApartmentId}". Bạn vui lòng hướng dẫn khách hàng chọn lại căn hộ từ danh sách gợi ý để đặt lịch xem phòng.`
        } else {
          try {
            const booking = await this.bookingsService.create(
              sessionKey.userId || null,
              {
                apartmentId: resolvedApartmentId,
                visitAt,
                method,
                tenantName: tenantName ?? null,
                tenantPhone: tenantPhone ?? null,
                note: 'Tạo tự động qua trợ lý ảo AI',
              }
            )
            const bookingId = booking._id ? booking._id.toString() : 'unknown'
            const formattedVisitAt = booking.visitAt
              ? new Date(booking.visitAt).toLocaleString('vi-VN')
              : 'unknown'
            const contactInfo = booking.tenantPhone
              ? `\n- Khách đặt: ${booking.tenantName || 'Khách vãng lai'} (${booking.tenantPhone})`
              : ''
            toolResultContent = `Đặt lịch hẹn xem nhà nháp thành công! Chi tiết lịch hẹn:\n- ID lịch: ${bookingId}\n- Tên căn hộ: ${booking.apartmentTitle}\n- Thời gian: ${formattedVisitAt}\n- Hình thức: ${booking.method === 'video' ? 'Video Call' : 'Xem trực tiếp'}${contactInfo}\n- Trạng thái: ${booking.status}`
            lastBookingSuccessContent = toolResultContent
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : 'Unknown error'
            this.logger.error('Failed to create booking draft via tool:', e)
            toolResultContent = `Không thể đặt lịch hẹn cho căn hộ này: ${errMsg}`
          }
        }
      } else if (toolCall.function.name === 'request_booking') {
        const args = toolCall.function.arguments as unknown as {
          apartmentId: string
        }
        const inputApartmentId = args?.apartmentId

        const resolvedApartmentId = await this.resolveApartmentId(
          sessionKey,
          inputApartmentId
        )

        if (!resolvedApartmentId) {
          toolResultContent = `Chưa xác định được căn hộ cần đặt lịch xem. Hãy phản hồi lịch sự hỏi người dùng muốn đặt lịch xem căn hộ nào (hỏi khu vực, số phòng ngủ, mức giá) hoặc gợi ý tìm kiếm căn hộ trước.`
        } else {
          try {
            const apt =
              await this.apartmentsService.findOne(resolvedApartmentId)
            if (apt) {
              const realAptId = apt._id
                ? apt._id.toString()
                : resolvedApartmentId
              toolResultContent = `Đã hiển thị thẻ chọn ngày và giờ đặt lịch xem căn hộ "${apt.title}" cho khách hàng.`
              metadata = {
                ...(metadata || {}),
                bookingRequest: {
                  apartmentId: realAptId,
                  apartmentTitle: apt.title,
                },
              }
            } else {
              toolResultContent = `Không tìm thấy thông tin căn hộ với ID "${inputApartmentId}".`
            }
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e)
            this.logger.error(
              `Failed to fetch apartment for booking request card: ${errMsg}`
            )
            toolResultContent = `Lỗi hệ thống khi tìm căn hộ: ${errMsg}`
          }
        }
      }

      // Add tool output back to messages for LLM context
      llmMessages.push({
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.function.name,
              arguments: JSON.stringify(toolCall.function.arguments),
            },
          },
        ],
      })

      llmMessages.push({
        role: 'tool',
        name: toolCall.function.name,
        tool_call_id: toolCall.id,
        content: toolResultContent,
      })

      if (toolResultContent.startsWith('Lỗi:')) {
        disableTools = true
      }

      // Call LLM again with tool results
      response = await this.groqAgentService.chat(llmMessages, disableTools)

      if (disableTools) {
        break
      }
    }

    let finalAnswer =
      response.content || 'Xin lỗi, tôi không thể xử lý yêu cầu của bạn.'

    // Guardrail Sanitizer: Nếu metadata có bookingRequest (mở Form chọn ngày/giờ),
    // nhưng câu thoại do LLM sinh ra bị nhiễm ngữ cảnh cũ và báo "đã được đặt thành công"
    if (metadata?.bookingRequest) {
      const title = metadata.bookingRequest.apartmentTitle || 'căn hộ'
      const isFalseClaim =
        finalAnswer.toLowerCase().includes('đã được đặt thành công') ||
        finalAnswer.toLowerCase().includes('đã đặt thành công') ||
        finalAnswer.toLowerCase().includes('bạn sẽ xem căn hộ')
      if (isFalseClaim || !finalAnswer.trim()) {
        finalAnswer = `Dưới đây là thẻ lên lịch xem căn hộ "${title}". Bạn vui lòng lựa chọn ngày và giờ xem phòng phù hợp ở khung bên dưới nhé:`
      }
    }

    // Guardrail Sanitizer: Nếu vừa thực thi tool create_booking_draft thành công,
    // nhưng câu thoại do LLM trả về bị rỗng hoặc là câu báo lỗi mặc định ("Xin lỗi...")
    if (lastBookingSuccessContent) {
      const isFallbackError =
        finalAnswer === 'Xin lỗi, tôi không thể xử lý yêu cầu của bạn.' ||
        !finalAnswer.trim() ||
        finalAnswer.toLowerCase().includes('không thể xử lý') ||
        finalAnswer.toLowerCase().includes('xin lỗi')
      if (isFallbackError) {
        finalAnswer = `${lastBookingSuccessContent}\n\nChủ nhà sẽ chủ động liên hệ với bạn để xác nhận lịch hẹn trước khi đến xem phòng.`
      }
    }

    // Guardrail Sanitizer: Nếu metadata có propertyCard hoặc propertyCards (kết quả tìm kiếm căn hộ),
    // nhưng câu thoại do LLM trả về bị rỗng hoặc là câu báo lỗi mặc định
    if (
      metadata?.propertyCard ||
      (metadata?.propertyCards && metadata.propertyCards.length > 0)
    ) {
      const isFallbackError =
        finalAnswer === 'Xin lỗi, tôi không thể xử lý yêu cầu của bạn.' ||
        !finalAnswer.trim()
      if (isFallbackError) {
        const count = metadata.propertyCards?.length || 1
        finalAnswer = `Dưới đây là ${count} căn hộ phù hợp với yêu cầu tìm kiếm của bạn:`
      }
    }

    // 5. Save assistant reply to history
    await this.addMessage(sessionKey, 'assistant', finalAnswer, metadata)

    // 6. Simulate streaming response to the client
    const words = finalAnswer.split(' ')
    let currentText = ''
    for (let i = 0; i < words.length; i++) {
      currentText += (i === 0 ? '' : ' ') + words[i]
      onChunk(currentText)
      await new Promise(resolve => setTimeout(resolve, 30)) // 30ms typing delay per word
    }

    return { content: finalAnswer, metadata }
  }
}
