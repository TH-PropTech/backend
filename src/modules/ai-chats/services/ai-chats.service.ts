import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { AiChat, ChatMessage } from '../schemas/ai-chat.schema'
import {
  GroqAgentService,
  ChatMessage as LLMChatMessage,
} from './groq-agent.service'
import { ApartmentsService } from '../../apartments/apartments.service'
import { BookingsService } from '../../bookings/bookings.service'
import { User } from '../../users/schemas/user.schema'
import { ObjectId } from 'mongodb'

interface SearchApartmentsArgs {
  location?: string
  bedrooms?: number
  maxPrice?: number
}

interface CreateBookingDraftArgs {
  apartmentId: string
  visitAt: string
  method?: 'onsite' | 'video'
}

@Injectable()
export class AiChatsService {
  private readonly logger = new Logger(AiChatsService.name)

  constructor(
    @InjectRepository(AiChat)
    private readonly aiChatRepository: Repository<AiChat>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly groqAgentService: GroqAgentService,
    private readonly apartmentsService: ApartmentsService,
    private readonly bookingsService: BookingsService
  ) {}

  async getOrCreateSession(sessionKey: {
    userId?: string
    deviceId?: string
  }): Promise<AiChat> {
    const { userId, deviceId } = sessionKey

    let chat: AiChat | null = null

    if (userId) {
      chat = await this.aiChatRepository.findOne({ where: { userId } })
    } else if (deviceId) {
      chat = await this.aiChatRepository.findOne({ where: { deviceId } })
    }

    if (!chat) {
      chat = this.aiChatRepository.create({
        userId: userId || undefined,
        deviceId: deviceId || undefined,
        messages: [],
      })
      await this.aiChatRepository.save(chat)
    }

    return chat
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
      metadata,
    }
    chat.messages.push(newMessage)

    if (chat.messages.length > 50) {
      chat.messages = chat.messages.slice(chat.messages.length - 50)
    }
    return this.aiChatRepository.save(chat)
  }

  async clearHistory(sessionKey: {
    userId?: string
    deviceId?: string
  }): Promise<void> {
    const chat = await this.getOrCreateSession(sessionKey)
    chat.messages = []
    await this.aiChatRepository.save(chat)
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

    // 4. Handle Tool Calls if LLM requests them
    while (
      response.toolCalls &&
      response.toolCalls.length > 0 &&
      loopLimit > 0
    ) {
      loopLimit--
      const toolCall = response.toolCalls[0]
      this.logger.log(
        `LLM requested tool call: ${toolCall.function.name} with args ${JSON.stringify(toolCall.function.arguments)}`
      )

      let toolResultContent = ''

      if (toolCall.function.name === 'search_apartments') {
        const args = toolCall.function
          .arguments as unknown as SearchApartmentsArgs
        const location = args.location
        const bedrooms = args.bedrooms
        const maxPrice = args.maxPrice // in VNĐ

        // Convert maxPrice from VNĐ to Millions VNĐ for ApartmentsService
        const filterMaxPrice = maxPrice ? maxPrice / 1000000 : undefined

        const apartments = await this.apartmentsService.findAll({
          search: location,
          bedrooms,
          maxPrice: filterMaxPrice,
        })

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
                    landlordPhone = landlord.phone || ''
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

          // Extract first apartment to return as metadata for visual card rendering
          const firstApt = apartmentsWithLandlord[0]
          const firstAptId = firstApt._id ? firstApt._id.toString() : 'unknown'
          metadata = {
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
          }
        } else {
          toolResultContent = 'Không tìm thấy căn hộ nào phù hợp với yêu cầu.'
        }
      } else if (toolCall.function.name === 'create_booking_draft') {
        const args = toolCall.function
          .arguments as unknown as CreateBookingDraftArgs
        const apartmentId = args.apartmentId
        const visitAt = args.visitAt
        const method = args.method || 'onsite'

        try {
          const booking = await this.bookingsService.create(
            sessionKey.userId || null,
            {
              apartmentId,
              visitAt,
              method,
              note: 'Tạo tự động qua trợ lý ảo AI',
            }
          )
          const bookingId = booking._id ? booking._id.toString() : 'unknown'
          const formattedVisitAt = booking.visitAt
            ? booking.visitAt.toString()
            : 'unknown'
          toolResultContent = `Đặt lịch hẹn xem nhà nháp thành công! Chi tiết lịch hẹn:\n- ID lịch: ${bookingId}\n- Tên căn hộ: ${booking.apartmentTitle}\n- Thời gian: ${formattedVisitAt}\n- Trạng thái: ${booking.status}`
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : 'Unknown error'
          this.logger.error('Failed to create booking draft via tool:', e)
          toolResultContent = `Có lỗi khi đặt lịch hẹn: ${errMsg}`
        }
      } else if (toolCall.function.name === 'request_booking') {
        const args = toolCall.function.arguments as unknown as {
          apartmentId: string
        }
        const apartmentId = args.apartmentId

        let apartmentTitle = 'Căn hộ'
        try {
          const apt = await this.apartmentsService.findOne(apartmentId)
          if (apt) {
            apartmentTitle = apt.title
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e)
          this.logger.error(
            `Failed to fetch apartment for booking request card: ${errMsg}`
          )
        }

        toolResultContent = `Đã hiển thị thẻ chọn ngày và giờ đặt lịch xem căn hộ "${apartmentTitle}" cho khách hàng.`
        metadata = {
          bookingRequest: {
            apartmentId,
            apartmentTitle,
          },
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

      // Call LLM again with tool results
      response = await this.groqAgentService.chat(llmMessages)
    }

    const finalAnswer =
      response.content || 'Xin lỗi, tôi không thể xử lý yêu cầu của bạn.'

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
