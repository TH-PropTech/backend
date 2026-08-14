import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { AiChatsService } from './ai-chats.service'
import { GroqAgentService } from './groq-agent.service'
import { ApartmentsService } from '../../apartments/apartments.service'
import { BookingsService } from '../../bookings/bookings.service'
import { User } from '../../users/schemas/user.schema'
import { RedisService } from '../../redis/redis.service'
import { ObjectId } from 'mongodb'

describe('AiChatsService', () => {
  let service: AiChatsService
  let groqAgentService: {
    chat: jest.Mock
  }
  let apartmentsService: {
    findAll: jest.Mock
    findOne: jest.Mock
  }
  let bookingsService: {
    create: jest.Mock
  }
  let userRepo: {
    findOne: jest.Mock
  }
  let redisService: {
    get: jest.Mock
    set: jest.Mock
    del: jest.Mock
  }

  const mockApartmentId = new ObjectId().toString()

  beforeEach(async () => {
    groqAgentService = {
      chat: jest.fn(),
    }
    apartmentsService = {
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({
        _id: new ObjectId(mockApartmentId),
        title: 'Vinhomes Central Park 2PN #102',
        status: 'available',
      }),
    }
    bookingsService = {
      create: jest.fn().mockResolvedValue({
        _id: new ObjectId(),
        apartmentTitle: 'Vinhomes Central Park 2PN #102',
        visitAt: new Date('2026-08-20T09:00:00.000Z'),
        method: 'onsite',
        tenantName: 'Nguyễn Văn A',
        tenantPhone: '0912345678',
        status: 'pending',
      }),
    }
    userRepo = {
      findOne: jest.fn().mockResolvedValue({
        _id: new ObjectId(),
        fullName: 'Chủ Nhà Lê Hoàng Minh',
        phone: '01209300567',
      }),
    }
    redisService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiChatsService,
        { provide: GroqAgentService, useValue: groqAgentService },
        { provide: ApartmentsService, useValue: apartmentsService },
        { provide: BookingsService, useValue: bookingsService },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile()

    service = module.get<AiChatsService>(AiChatsService)
  })

  describe('handleUserMessage - create_booking_draft with guest contact info', () => {
    it('Trích xuất và truyền đúng tenantName, tenantPhone cho BookingsService', async () => {
      // First turn: LLM calls tool create_booking_draft
      groqAgentService.chat
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'create_booking_draft',
                arguments: {
                  apartmentId: mockApartmentId,
                  visitAt: '2026-08-20T09:00:00.000Z',
                  method: 'onsite',
                  tenantName: 'Trần Văn B',
                  tenantPhone: '0901234567',
                },
              },
            },
          ],
        })
        // Second turn: LLM returns text confirmation
        .mockResolvedValueOnce({
          content:
            'Lịch hẹn xem nhà đã được đặt thành công! Bạn sẽ xem căn hộ Vinhomes Central Park vào lúc 09:00 ngày 20/08/2026.',
        })

      const sessionKey = { deviceId: 'device-test-123' }
      const onChunk = jest.fn()
      const result = await service.handleUserMessage(
        sessionKey,
        'Đặt lịch xem căn hộ Vinhomes lúc 09:00 ngày 20/08 [Xem trực tiếp] - Khách: Trần Văn B, SĐT: 0901234567',
        onChunk
      )

      expect(bookingsService.create).toHaveBeenCalledWith(null, {
        apartmentId: mockApartmentId,
        visitAt: '2026-08-20T09:00:00.000Z',
        method: 'onsite',
        tenantName: 'Trần Văn B',
        tenantPhone: '0901234567',
        note: 'Tạo tự động qua trợ lý ảo AI',
      })
      expect(result.content).toContain('đặt thành công')
    })
  })

  describe('PropertyCard Guardrail Sanitizer', () => {
    it('Đè câu xin lỗi mặc định thành câu chào danh sách khi tìm kiếm có kết quả', async () => {
      apartmentsService.findAll.mockResolvedValueOnce([
        {
          _id: new ObjectId(mockApartmentId),
          title: 'Vinhomes Central Park 2PN',
          priceMonthly: 18000000,
          location: 'Bình Thạnh',
          landlordId: mockApartmentId,
        },
      ])

      groqAgentService.chat
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_search',
              type: 'function',
              function: {
                name: 'search_apartments',
                arguments: { location: 'Bình Thạnh' },
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Xin lỗi, tôi không thể xử lý yêu cầu của bạn.',
        })

      const sessionKey = { deviceId: 'device-test-123' }
      const onChunk = jest.fn()
      const result = await service.handleUserMessage(
        sessionKey,
        'Tìm căn hộ Vinhomes 2PN',
        onChunk
      )

      expect(result.content).toBe(
        'Dưới đây là 1 căn hộ phù hợp với yêu cầu tìm kiếm của bạn:'
      )
      expect(result.metadata?.propertyCards?.length).toBe(1)
    })

    it('Guardrail Sanitizer: Tự động phục hồi chi tiết lịch hẹn khi create_booking_draft thành công nhưng LLM turn 2 trả về câu lỗi mặc định', async () => {
      groqAgentService.chat
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [
            {
              id: 'call_booking',
              type: 'function',
              function: {
                name: 'create_booking_draft',
                arguments: {
                  apartmentId: mockApartmentId,
                  visitAt: '14/08/2026 09:00',
                  method: 'onsite',
                  tenantName: 'Huy',
                  tenantPhone: '0937130759',
                },
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          content: 'Xin lỗi, tôi không thể xử lý yêu cầu của bạn.',
        })

      bookingsService.create.mockResolvedValue({
        _id: new ObjectId(),
        apartmentTitle: 'Vinhomes Central Park 2PN #102',
        visitAt: new Date(2026, 7, 14, 9, 0),
        method: 'onsite',
        tenantName: 'Huy',
        tenantPhone: '0937130759',
        status: 'pending',
      })

      const sessionKey = { deviceId: 'device-test-booking-guardrail' }
      const onChunk = jest.fn()
      const result = await service.handleUserMessage(
        sessionKey,
        'Đặt lịch xem căn hộ "Vinhomes Central Park - Căn hộ 2PN #102" vào lúc 09:00 ngày 14/08/2026 [Xem trực tiếp] - Khách: Huy, SĐT: 0937130759',
        onChunk
      )

      expect(result.content).toContain('Đặt lịch hẹn xem nhà nháp thành công!')
      expect(result.content).toContain('Vinhomes Central Park 2PN #102')
      expect(result.content).toContain('0937130759')
      expect(result.content).toContain('Chủ nhà sẽ chủ động liên hệ')
    })

    it('Xử lý an toàn khi request_booking được gọi nhưng không có căn hộ nào trong ngữ cảnh (không tự ý bốc căn đầu tiên trong DB)', async () => {
      apartmentsService.findAll.mockResolvedValue([])
      apartmentsService.findOne.mockRejectedValue(new Error('Not found'))

      groqAgentService.chat
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [
            {
              id: 'call_req_booking',
              type: 'function',
              function: {
                name: 'request_booking',
                arguments: {},
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          content:
            'Bạn muốn đặt lịch xem căn hộ nào ạ? Bạn vui lòng cho tôi biết khu vực hoặc ngân sách mong muốn để tôi gợi ý cho bạn nhé!',
        })

      const sessionKey = { deviceId: 'device-test-no-apt' }
      const onChunk = jest.fn()
      const result = await service.handleUserMessage(
        sessionKey,
        'Tôi muốn đặt lịch xem nhà',
        onChunk
      )

      expect(result.content).toContain('Bạn muốn đặt lịch xem căn hộ nào ạ?')
      expect(result.metadata?.bookingRequest).toBeUndefined()
    })
  })
})
