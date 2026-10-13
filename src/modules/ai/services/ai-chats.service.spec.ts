import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { AiChatsService } from './ai-chats.service'
import {
  GROQ_CONNECTION_ERROR_REPLY,
  GroqAgentService,
  ToolCall,
} from './groq-agent.service'
import { ApartmentsService } from '../../properties/services/apartments.service'
import { BookingsService } from '../../bookings/services/bookings.service'
import { User } from '../../users/schemas/user.schema'
import { RedisService } from '../../health/services/redis.service'
import { ObjectId } from 'mongodb'
import { LEGAL_KNOWLEDGE_SEARCH } from '../../legal/utils/legal-knowledge.types'

describe('AiChatsService', () => {
  let service: AiChatsService
  let legalSearch: { search: jest.Mock }
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
    legalSearch = {
      search: jest.fn().mockResolvedValue([]),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiChatsService,
        { provide: GroqAgentService, useValue: groqAgentService },
        { provide: ApartmentsService, useValue: apartmentsService },
        { provide: BookingsService, useValue: bookingsService },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: RedisService, useValue: redisService },
        { provide: LEGAL_KNOWLEDGE_SEARCH, useValue: legalSearch },
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
    jest.setTimeout(15_000)
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

  describe('search_legal_knowledge tool', () => {
    const getSecondCallMessages = (): Array<{
      role: string
      content: string
      tool_call_id?: string
    }> =>
      (groqAgentService.chat.mock.calls as unknown[][])[1]?.[0] as Array<{
        role: string
        content: string
        tool_call_id?: string
      }>

    const legalToolCall = (
      query: unknown
    ): { content: null; toolCalls: ToolCall[] } => ({
      content: null,
      toolCalls: [
        {
          id: 'call_legal',
          type: 'function' as const,
          function: {
            name: 'search_legal_knowledge',
            arguments: { query },
          },
        },
      ],
    })

    const sampleHits = [
      {
        docId: 'doc1',
        title: 'Bộ luật Dân sự 2015',
        docNumber: '91/2015/QH13',
        issuer: 'Quốc hội',
        heading: 'Điều 472. Hợp đồng thuê tài sản',
        text: 'Bên thuê phải trả tiền thuê đúng thời hạn đã thỏa thuận.',
        score: 3.2,
        sourceUrl: 'https://thuvienphapluat.vn/van-ban/bo-luat-dan-su',
        fetchedAt: '2026-10-11T03:15:00.000Z',
      },
      {
        docId: 'doc2',
        title: 'Quy định nội bộ nền tảng',
        heading: 'Mục 2. Đặt cọc',
        text: 'Tiền đặt cọc không vượt quá 2 tháng tiền thuê.',
        score: 2.1,
      },
    ]

    it('Bỏ legalCitations khi câu trả lời mở đầu bằng "Hiện chưa có dữ liệu"', async () => {
      legalSearch.search.mockResolvedValueOnce(sampleHits)
      groqAgentService.chat
        .mockResolvedValueOnce(legalToolCall('thuế thu nhập cá nhân'))
        .mockResolvedValueOnce({
          content:
            'Hiện chưa có dữ liệu về vấn đề này trong kho tri thức. Bạn nên hỏi luật sư.',
        })

      const result = await service.handleUserMessage(
        { deviceId: 'device-legal-nodata' },
        'Thuế thu nhập cá nhân tính thế nào?'
      )

      expect(result.metadata?.legalCitations).toBeUndefined()
    })

    it('Thử lại một lần khi mô hình từ chối dù đã có đoạn liên quan, và giữ legalCitations nếu trả lời được', async () => {
      legalSearch.search.mockResolvedValueOnce(sampleHits)
      groqAgentService.chat
        .mockResolvedValueOnce(legalToolCall('đặt cọc thuê nhà 2026'))
        .mockResolvedValueOnce({
          content: 'Hiện chưa có dữ liệu về thay đổi năm 2026.',
        })
        .mockResolvedValueOnce({
          content:
            'Theo Bộ luật Dân sự 2015, Điều 472, bên thuê phải trả tiền thuê đúng hạn. Kho tri thức chưa có bản so sánh với năm 2025.',
        })

      const result = await service.handleUserMessage(
        { deviceId: 'device-legal-retry' },
        'Luật thuê nhà 2026 có gì thay đổi so với 2025?'
      )

      expect(groqAgentService.chat).toHaveBeenCalledTimes(3)
      const retryCall = (groqAgentService.chat.mock.calls as unknown[][])[2]
      expect(retryCall?.[1]).toBe(true)
      const retryMessages = (retryCall?.[0] ?? []) as Array<{
        role: string
        content: string
        tool_calls?: unknown
      }>
      // Question plus excerpts only: no tool-call history to tempt another tool call.
      expect(retryMessages.map(m => m.role)).toEqual(['user', 'system'])
      expect(retryMessages.some(m => m.tool_calls)).toBe(false)
      expect(retryMessages[0]?.content).toContain('thay đổi so với 2025')
      expect(retryMessages[1]?.content).toContain(
        '[1] Văn bản: Bộ luật Dân sự 2015'
      )
      expect(result.content).toContain('Theo Bộ luật Dân sự 2015')
      expect(result.metadata?.legalCitations?.length).toBeGreaterThan(0)
    })

    it('Cả hai lượt đều từ chối nhưng kho có văn bản đủ liên quan: trả danh sách văn bản liên quan và giữ trích dẫn', async () => {
      legalSearch.search.mockResolvedValueOnce([
        { ...sampleHits[0]!, score: 32 },
        { ...sampleHits[1]!, score: 28 },
      ])
      groqAgentService.chat
        .mockResolvedValueOnce(legalToolCall('thay đổi 2026'))
        .mockResolvedValueOnce({
          content: 'Hiện chưa có dữ liệu về vấn đề này.',
        })
        .mockResolvedValueOnce({
          content: 'Hiện chưa có dữ liệu về vấn đề này.',
        })

      const result = await service.handleUserMessage(
        { deviceId: 'device-legal-fallback' },
        'Luật thuê nhà 2026 có gì thay đổi?'
      )

      expect(result.content).toContain('có các văn bản liên quan')
      expect(result.content).toContain('**Bộ luật Dân sự 2015**')
      expect(result.metadata?.legalCitations?.length).toBeGreaterThan(0)
    })

    it('Không dùng câu báo lỗi kết nối của lượt thử lại làm câu trả lời', async () => {
      legalSearch.search.mockResolvedValueOnce(sampleHits)
      groqAgentService.chat
        .mockResolvedValueOnce(legalToolCall('đặt cọc'))
        .mockResolvedValueOnce({
          content: 'Hiện chưa có dữ liệu về vấn đề này.',
        })
        .mockResolvedValueOnce({ content: GROQ_CONNECTION_ERROR_REPLY })

      const result = await service.handleUserMessage(
        { deviceId: 'device-legal-retry-3' },
        'Đặt cọc thuê nhà thế nào?'
      )

      expect(result.content).toMatch(/^Hiện chưa có dữ liệu/)
    })

    it('Giữ nguyên câu từ chối khi thử lại vẫn không có nội dung', async () => {
      legalSearch.search.mockResolvedValueOnce(sampleHits)
      groqAgentService.chat
        .mockResolvedValueOnce(legalToolCall('luật vũ trụ'))
        .mockResolvedValueOnce({
          content: 'Hiện chưa có dữ liệu về vấn đề này.',
        })
        .mockResolvedValueOnce({
          content: 'Hiện chưa có dữ liệu về vấn đề này.',
        })

      const result = await service.handleUserMessage(
        { deviceId: 'device-legal-retry-2' },
        'Luật vũ trụ quy định gì?'
      )

      expect(result.content).toMatch(/^Hiện chưa có dữ liệu/)
      expect(result.metadata?.legalCitations).toBeUndefined()
    })

    it('Thực thi tool, đưa nội dung đánh số vào LLM và gắn legalCitations vào metadata', async () => {
      legalSearch.search.mockResolvedValueOnce(sampleHits)
      groqAgentService.chat
        .mockResolvedValueOnce(
          legalToolCall('đặt cọc thuê nhà tối đa bao nhiêu')
        )
        .mockResolvedValueOnce({
          content:
            'Theo Quy định nội bộ nền tảng, Mục 2. Đặt cọc, tiền đặt cọc không vượt quá 2 tháng tiền thuê. Nội dung chỉ mang tính tham khảo, không thay thế tư vấn pháp lý chuyên nghiệp.',
        })

      const result = await service.handleUserMessage(
        { deviceId: 'device-legal-1' },
        'Tiền đặt cọc thuê nhà tối đa bao nhiêu?',
        jest.fn()
      )

      expect(legalSearch.search).toHaveBeenCalledWith(
        'đặt cọc thuê nhà tối đa bao nhiêu',
        4
      )
      const secondCallMessages = getSecondCallMessages()
      const toolMessage = secondCallMessages[secondCallMessages.length - 1]
      expect(toolMessage?.role).toBe('tool')
      expect(toolMessage?.tool_call_id).toBe('call_legal')
      expect(toolMessage?.content).toContain('[1] Văn bản: Bộ luật Dân sự 2015')
      expect(toolMessage?.content).toContain('Số hiệu: 91/2015/QH13')
      expect(toolMessage?.content).toContain(
        'Điều/mục: Điều 472. Hợp đồng thuê tài sản'
      )
      expect(toolMessage?.content).toContain(
        '[2] Văn bản: Quy định nội bộ nền tảng'
      )
      expect(toolMessage?.content).toContain(
        'Nguồn: https://thuvienphapluat.vn/van-ban/bo-luat-dan-su'
      )
      expect(toolMessage?.content).toContain('Cập nhật từ nguồn: 2026-10-11')

      expect(result.metadata?.legalCitations).toEqual([
        {
          title: 'Bộ luật Dân sự 2015',
          heading: 'Điều 472. Hợp đồng thuê tài sản',
          url: 'https://thuvienphapluat.vn/van-ban/bo-luat-dan-su',
          issuer: 'Quốc hội',
          fetchedAt: '2026-10-11T03:15:00.000Z',
        },
        {
          title: 'Quy định nội bộ nền tảng',
          heading: 'Mục 2. Đặt cọc',
        },
      ])
      expect(result.metadata?.propertyCards).toBeUndefined()
      expect(result.metadata?.bookingRequest).toBeUndefined()
    })

    it('Không có kết quả: trả thông báo không tìm thấy và không gắn citation', async () => {
      legalSearch.search.mockResolvedValueOnce([])
      groqAgentService.chat
        .mockResolvedValueOnce(legalToolCall('luật vũ trụ'))
        .mockResolvedValueOnce({
          content: 'Hiện chưa có dữ liệu về vấn đề này.',
        })

      const result = await service.handleUserMessage(
        { deviceId: 'device-legal-2' },
        'Luật vũ trụ quy định gì?',
        jest.fn()
      )

      const secondCallMessages = getSecondCallMessages()
      expect(secondCallMessages[secondCallMessages.length - 1]?.content).toBe(
        'Không tìm thấy nội dung phù hợp trong kho tri thức pháp lý.'
      )
      expect(result.metadata?.legalCitations).toBeUndefined()
      expect(result.content).toBe('Hiện chưa có dữ liệu về vấn đề này.')
    })

    it('Lỗi khi tìm kiếm: không làm hỏng luồng chat và trả thông báo không tìm thấy', async () => {
      legalSearch.search.mockRejectedValueOnce(new Error('index down'))
      groqAgentService.chat
        .mockResolvedValueOnce(legalToolCall('đặt cọc'))
        .mockResolvedValueOnce({ content: 'Xin thử lại sau.' })

      const result = await service.handleUserMessage(
        { deviceId: 'device-legal-3' },
        'Đặt cọc thế nào?',
        jest.fn()
      )

      expect(result.content).toBe('Xin thử lại sau.')
      expect(result.metadata?.legalCitations).toBeUndefined()
    })

    it('Thiếu searcher (module chưa đăng ký): trả thông báo không tìm thấy, không gọi search', async () => {
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
      const serviceWithoutSearch = module.get<AiChatsService>(AiChatsService)

      groqAgentService.chat
        .mockResolvedValueOnce(legalToolCall('đặt cọc'))
        .mockResolvedValueOnce({ content: 'Hiện chưa có dữ liệu.' })

      const result = await serviceWithoutSearch.handleUserMessage(
        { deviceId: 'device-legal-4' },
        'Đặt cọc thế nào?',
        jest.fn()
      )

      expect(legalSearch.search).not.toHaveBeenCalled()
      const secondCallMessages = getSecondCallMessages()
      expect(secondCallMessages[secondCallMessages.length - 1]?.content).toBe(
        'Không tìm thấy nội dung phù hợp trong kho tri thức pháp lý.'
      )
      expect(result.metadata?.legalCitations).toBeUndefined()
    })
  })
})
