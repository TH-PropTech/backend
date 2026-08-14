import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { NotFoundException, BadRequestException } from '@nestjs/common'
import { BookingsService } from './bookings.service'
import { Booking } from './schemas/booking.schema'
import { Apartment } from '../apartments/schemas/apartment.schema'
import { User } from '../users/schemas/user.schema'
import { NotificationsService } from '../notifications/notifications.service'
import { ObjectId } from 'mongodb'

describe('BookingsService', () => {
  let service: BookingsService
  let bookingRepo: {
    create: jest.Mock
    save: jest.Mock
    findOne: jest.Mock
    find: jest.Mock
  }
  let apartmentRepo: {
    findOne: jest.Mock
    find: jest.Mock
  }
  let userRepo: {
    findOne: jest.Mock
  }
  let notificationsService: {
    createNotification: jest.Mock
  }

  const mockApartmentId = new ObjectId().toString()
  const mockLandlordId = new ObjectId().toString()
  const mockTenantId = new ObjectId().toString()

  const mockApartment: Partial<Apartment> = {
    _id: new ObjectId(mockApartmentId),
    title: 'Vinhomes Central Park 2PN #102',
    landlordId: mockLandlordId,
  }

  beforeEach(async () => {
    bookingRepo = {
      create: jest.fn((dto: Partial<Booking>): Booking => dto as Booking),
      save: jest.fn(
        (booking: Booking): Promise<Booking> =>
          Promise.resolve({
            ...booking,
            _id: new ObjectId(),
          })
      ),
      findOne: jest.fn(),
      find: jest.fn(),
    }

    apartmentRepo = {
      findOne: jest.fn().mockResolvedValue(mockApartment),
      find: jest.fn().mockResolvedValue([mockApartment]),
    }

    userRepo = {
      findOne: jest.fn().mockResolvedValue({
        _id: new ObjectId(mockTenantId),
        fullName: 'Nguyễn Văn A',
        phone: '0912345678',
      }),
    }

    notificationsService = {
      createNotification: jest.fn().mockResolvedValue({}),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getRepositoryToken(Booking), useValue: bookingRepo },
        { provide: getRepositoryToken(Apartment), useValue: apartmentRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile()

    service = module.get<BookingsService>(BookingsService)
  })

  describe('create', () => {
    it('Happy path: Khách đăng nhập tạo lịch hẹn xem nhà thành công', async () => {
      const result = await service.create(mockTenantId, {
        apartmentId: mockApartmentId,
        visitAt: '2026-08-20T09:00:00.000Z',
        method: 'onsite',
        note: 'Xem phòng sáng',
      })

      expect(result).toBeDefined()
      expect(bookingRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          apartmentId: mockApartmentId,
          apartmentTitle: mockApartment.title,
          landlordId: mockLandlordId,
          tenantId: mockTenantId,
          tenantName: 'Nguyễn Văn A',
          tenantPhone: '0912345678',
          method: 'onsite',
          status: 'pending',
        })
      )
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        mockLandlordId,
        'Yêu cầu đặt lịch hẹn mới',
        expect.stringContaining('0912345678'),
        'BOOKING',
        expect.any(Object)
      )
    })

    it('Guest flow: Khách vãng lai chưa đăng nhập có cung cấp Tên và SĐT', async () => {
      const result = await service.create(null, {
        apartmentId: mockApartmentId,
        visitAt: '2026-08-20T09:00:00.000Z',
        method: 'video',
        tenantName: 'Khách Vãng Lai B',
        tenantPhone: '0987654321',
        note: 'Tạo tự động qua AI Chatbot',
      })

      expect(result).toBeDefined()
      expect(bookingRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'anonymous',
          tenantName: 'Khách Vãng Lai B',
          tenantPhone: '0987654321',
          method: 'video',
        })
      )
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        mockLandlordId,
        'Yêu cầu đặt lịch hẹn mới',
        expect.stringContaining('0987654321'),
        'BOOKING',
        expect.any(Object)
      )
    })

    it('Negative: Ném NotFoundException khi không tìm thấy căn hộ', async () => {
      apartmentRepo.findOne.mockResolvedValue(null)
      apartmentRepo.find.mockResolvedValue([])

      await expect(
        service.create(null, {
          apartmentId: new ObjectId().toString(),
          visitAt: '2026-08-20T09:00:00.000Z',
          method: 'onsite',
        })
      ).rejects.toThrow(NotFoundException)
    })

    it('Negative: Ném BadRequestException khi căn hộ chưa có chủ nhà', async () => {
      apartmentRepo.findOne.mockResolvedValue({
        _id: new ObjectId(),
        title: 'Căn hộ không chủ',
        landlordId: undefined,
      })

      await expect(
        service.create(null, {
          apartmentId: mockApartmentId,
          visitAt: '2026-08-20T09:00:00.000Z',
          method: 'onsite',
        })
      ).rejects.toThrow(BadRequestException)
    })

    it('Negative: Ném BadRequestException khi chủ nhà tự đặt lịch căn hộ của mình', async () => {
      await expect(
        service.create(mockLandlordId, {
          apartmentId: mockApartmentId,
          visitAt: '2026-08-20T09:00:00.000Z',
          method: 'onsite',
        })
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('parseVisitAt', () => {
    it('Phân tích đúng định dạng ngày tháng Việt Nam DD/MM/YYYY HH:mm', () => {
      const date = service.parseVisitAt('14/08/2026 09:30')
      expect(date.getFullYear()).toBe(2026)
      expect(date.getMonth()).toBe(7) // August is index 7
      expect(date.getDate()).toBe(14)
      expect(date.getHours()).toBe(9)
      expect(date.getMinutes()).toBe(30)
    })

    it('Phân tích đúng định dạng DD-MM-YYYY', () => {
      const date = service.parseVisitAt('14-08-2026')
      expect(date.getFullYear()).toBe(2026)
      expect(date.getMonth()).toBe(7)
      expect(date.getDate()).toBe(14)
    })

    it('Phân tích đúng định dạng chuẩn ISO 8601', () => {
      const date = service.parseVisitAt('2026-08-14T09:00:00.000Z')
      expect(date.getTime()).not.toBeNaN()
      expect(date.toISOString()).toBe('2026-08-14T09:00:00.000Z')
    })

    it('Fallback an toàn khi nhận chuỗi rỗng hoặc không hợp lệ', () => {
      const date1 = service.parseVisitAt('')
      const date2 = service.parseVisitAt('invalid-date-string')
      expect(date1.getTime()).not.toBeNaN()
      expect(date2.getTime()).not.toBeNaN()
    })
  })
})
