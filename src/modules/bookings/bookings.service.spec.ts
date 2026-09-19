import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { NotFoundException } from '@nestjs/common'
import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { ObjectId } from 'mongodb'
import { BookingsService } from './bookings.service'
import { Booking } from './schemas/booking.schema'
import { Apartment } from '../apartments/schemas/apartment.schema'
import { User } from '../users/schemas/user.schema'
import { NotificationsService } from '../notifications/notifications.service'
import { BookingQueryDto } from './dto/booking-query.dto'

describe('BookingsService', () => {
  let service: BookingsService

  const mockBookingRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
  }

  const mockApartmentRepository = {
    findOne: jest.fn(),
  }

  const mockUserRepository = {
    find: jest.fn(),
  }

  const mockNotificationsService = {
    createNotification: jest.fn(),
    updateBookingNotificationStatus: jest.fn(),
  }

  const validObjectIdStr = '507f1f77bcf86cd799439011'
  const mockBooking: Booking = {
    _id: new ObjectId(validObjectIdStr),
    apartmentId: 'apt-001',
    apartmentTitle: 'Căn hộ Vinhomes Central Park',
    landlordId: 'landlord-123',
    tenantId: 'tenant-456',
    tenantName: 'Nguyễn Văn A',
    tenantPhone: '0901234567',
    visitAt: new Date('2026-09-25T10:00:00.000Z'),
    method: 'onsite',
    note: 'Cần xem kỹ ban công',
    status: 'pending',
    rejectedReason: null,
    consultantId: null,
    createdAt: new Date('2026-09-19T08:00:00.000Z'),
    updatedAt: new Date('2026-09-19T08:00:00.000Z'),
  }

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        {
          provide: getRepositoryToken(Booking),
          useValue: mockBookingRepository,
        },
        {
          provide: getRepositoryToken(Apartment),
          useValue: mockApartmentRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
      ],
    }).compile()

    service = module.get<BookingsService>(BookingsService)
  })

  describe('Phase 1: IDOR Protection in findOneById', () => {
    it('cho phép khách thuê chính chủ xem thông tin lịch hẹn của mình', async () => {
      mockBookingRepository.findOne.mockResolvedValue(mockBooking)

      const result = await service.findOneById(validObjectIdStr, {
        userId: 'tenant-456',
        roles: ['tenant'],
      })

      expect(result).toBeDefined()
      expect(result.tenantId).toBe('tenant-456')
      expect(result.apartmentTitle).toBe('Căn hộ Vinhomes Central Park')
    })

    it('cho phép chủ nhà chính chủ xem thông tin lịch hẹn gửi tới căn hộ của mình', async () => {
      mockBookingRepository.findOne.mockResolvedValue(mockBooking)

      const result = await service.findOneById(validObjectIdStr, {
        userId: 'landlord-123',
        roles: ['landlord'],
      })

      expect(result).toBeDefined()
      expect(result.landlordId).toBe('landlord-123')
    })

    it('cho phép nhân viên vận hành (staff) xem lịch hẹn bất kỳ', async () => {
      mockBookingRepository.findOne.mockResolvedValue(mockBooking)

      const result = await service.findOneById(validObjectIdStr, {
        userId: 'staff-999',
        roles: ['staff'],
      })

      expect(result).toBeDefined()
      expect(result._id.toString()).toBe(validObjectIdStr)
    })

    it('cho phép quản trị viên (admin) xem lịch hẹn bất kỳ', async () => {
      mockBookingRepository.findOne.mockResolvedValue(mockBooking)

      const result = await service.findOneById(validObjectIdStr, {
        userId: 'admin-001',
        roles: ['admin'],
      })

      expect(result).toBeDefined()
      expect(result._id.toString()).toBe(validObjectIdStr)
    })

    it('trả về NotFoundException (HTTP 404) khi người lạ cố tình xem lịch hẹn của người khác (IDOR Attempt)', async () => {
      mockBookingRepository.findOne.mockResolvedValue(mockBooking)

      await expect(
        service.findOneById(validObjectIdStr, {
          userId: 'stranger-999',
          roles: ['tenant'],
        })
      ).rejects.toThrow(NotFoundException)
    })

    it('trả về NotFoundException (HTTP 404) khi không tìm thấy lịch hẹn hoặc ID không tồn tại', async () => {
      mockBookingRepository.findOne.mockResolvedValue(null)

      await expect(
        service.findOneById('507f1f77bcf86cd799439099', {
          userId: 'staff-123',
          roles: ['staff'],
        })
      ).rejects.toThrow(NotFoundException)
    })

    it('trả về NotFoundException khi ID không phải là ObjectId hợp lệ', async () => {
      await expect(
        service.findOneById('invalid-mongo-id', {
          userId: 'staff-123',
          roles: ['staff'],
        })
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('Phase 2: Server-side Pagination & Status Counts in findAll', () => {
    it('truy vấn phân trang đúng skip/take và trả về statusCounts chính xác', async () => {
      const pageItems = [
        {
          ...mockBooking,
          _id: new ObjectId('507f1f77bcf86cd799439011'),
          tenantName: '',
          landlordId: '507f1f77bcf86cd799439022',
          tenantId: '507f1f77bcf86cd799439033',
        },
      ]

      mockBookingRepository.find.mockResolvedValue(pageItems)
      mockBookingRepository.count
        .mockResolvedValueOnce(55) // total for query
        .mockResolvedValueOnce(10) // pending
        .mockResolvedValueOnce(25) // confirmed
        .mockResolvedValueOnce(5) // rejected
        .mockResolvedValueOnce(8) // cancelled
        .mockResolvedValueOnce(7) // completed

      mockUserRepository.find.mockResolvedValue([
        {
          _id: new ObjectId('507f1f77bcf86cd799439022'),
          fullName: 'Trần Văn Landlord',
          phone: '0911222333',
          email: 'landlord@thproptech.vn',
        },
        {
          _id: new ObjectId('507f1f77bcf86cd799439033'),
          fullName: 'Lê Thị Tenant',
          phone: '0988777666',
          email: 'tenant@thproptech.vn',
        },
      ])

      const result = await service.findAll({
        status: 'confirmed',
        page: 2,
        limit: 10,
      })

      // Verify skip and take sent to bookingRepository.find
      expect(mockBookingRepository.find).toHaveBeenCalledWith({
        where: { status: 'confirmed' },
        order: { createdAt: 'DESC' },
        skip: 10,
        take: 10,
      })

      // Verify pagination results
      expect(result.total).toBe(55)
      expect(result.page).toBe(2)
      expect(result.limit).toBe(10)
      expect(result.totalPages).toBe(6)

      // Verify status counts
      expect(result.statusCounts).toEqual({
        pending: 10,
        confirmed: 25,
        rejected: 5,
        cancelled: 8,
        completed: 7,
      })

      // Verify user enrichment on current page items
      const firstItem = result.items[0]
      expect(firstItem).toBeDefined()
      expect(firstItem?.landlordName).toBe('Trần Văn Landlord')
      expect(firstItem?.tenantName).toBe('Lê Thị Tenant')
      expect(firstItem?.tenantEmail).toBe('tenant@thproptech.vn')
    })

    it('xử lý khi không có bản ghi nào trả về', async () => {
      mockBookingRepository.find.mockResolvedValue([])
      mockBookingRepository.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)

      const result = await service.findAll({
        page: 1,
        limit: 20,
      })

      expect(result.items).toEqual([])
      expect(result.total).toBe(0)
      expect(result.totalPages).toBe(0)
      expect(mockUserRepository.find).not.toHaveBeenCalled()
    })
  })

  describe('Phase 2: BookingQueryDto Validation', () => {
    it('báo lỗi validation khi limit vượt quá 100 (e.g. limit=500)', async () => {
      const dto = plainToInstance(BookingQueryDto, {
        limit: 500,
        page: 1,
      })

      const errors = await validate(dto)
      expect(errors.length).toBeGreaterThan(0)
      const limitError = errors.find(err => err.property === 'limit')
      expect(limitError).toBeDefined()
      expect(limitError?.constraints).toHaveProperty('max')
    })

    it('báo lỗi validation khi page nhỏ hơn 1 (e.g. page=0 hoặc âm)', async () => {
      const dto = plainToInstance(BookingQueryDto, {
        page: 0,
        limit: 20,
      })

      const errors = await validate(dto)
      expect(errors.length).toBeGreaterThan(0)
      const pageError = errors.find(err => err.property === 'page')
      expect(pageError).toBeDefined()
      expect(pageError?.constraints).toHaveProperty('min')
    })

    it('vượt qua validation khi page và limit hợp lệ trong khoảng cho phép', async () => {
      const dto = plainToInstance(BookingQueryDto, {
        page: 1,
        limit: 20,
        status: 'pending',
      })

      const errors = await validate(dto)
      expect(errors.length).toBe(0)
    })
  })
})
