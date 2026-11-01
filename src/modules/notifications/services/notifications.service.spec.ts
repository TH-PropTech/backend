import { Logger, NotFoundException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { NotificationsService } from './notifications.service'
import type { Notification } from '../schemas/notification.schema'

interface RepositoryMock {
  findOne: jest.Mock
  findAndCount: jest.Mock
  countDocuments: jest.Mock
  updateMany: jest.Mock
  deleteOne: jest.Mock
  create: jest.Mock
  save: jest.Mock
}

const createRepository = (
  existing: Partial<Notification> | null = null
): RepositoryMock => ({
  findOne: jest.fn().mockResolvedValue(existing),
  findAndCount: jest.fn().mockResolvedValue([[], 0]),
  countDocuments: jest.fn().mockResolvedValue(0),
  updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  create: jest.fn((value: Partial<Notification>) => value),
  save: jest.fn((value: Partial<Notification>) => Promise.resolve(value)),
})

const createService = (repository: RepositoryMock): NotificationsService =>
  new NotificationsService(repository as never)

afterEach(() => jest.clearAllMocks())

describe('NotificationsService.createNotificationOnce', () => {
  it('tạo thông báo kèm dedupeKey khi user chưa nhận khóa đó', async () => {
    const repository = createRepository(null)
    const service = createService(repository)

    const result = await service.createNotificationOnce(
      'user-1',
      'flow:c1:deposit:done',
      'Đã xác nhận cọc',
      'Nội dung',
      'contract-flow',
      { contractId: 'c1' }
    )

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { userId: 'user-1', dedupeKey: 'flow:c1:deposit:done' },
    })
    expect(result).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        dedupeKey: 'flow:c1:deposit:done',
        type: 'contract-flow',
        data: { contractId: 'c1' },
        isRead: false,
      })
    )
    expect(repository.save).toHaveBeenCalledTimes(1)
  })

  it('không tạo lại khi user đã nhận cùng dedupeKey', async () => {
    const repository = createRepository({
      userId: 'user-1',
      dedupeKey: 'flow:c1:deposit:done',
    })
    const service = createService(repository)

    const result = await service.createNotificationOnce(
      'user-1',
      'flow:c1:deposit:done',
      'Đã xác nhận cọc',
      'Nội dung',
      'contract-flow'
    )

    expect(result).toBeNull()
    expect(repository.save).not.toHaveBeenCalled()
  })
})

describe('NotificationsService.getUserNotifications', () => {
  it('phân trang ở DB bằng skip/take và trả tổng số trang', async () => {
    const repository = createRepository()
    repository.findAndCount.mockResolvedValue([[{ title: 'a' }], 45])
    const service = createService(repository)

    const result = await service.getUserNotifications('user-1', {
      page: 2,
      limit: 20,
    })

    expect(repository.findAndCount).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      order: { createdAt: 'DESC' },
      skip: 20,
      take: 20,
    })
    expect(result).toEqual({
      items: [{ title: 'a' }],
      total: 45,
      page: 2,
      limit: 20,
      totalPages: 3,
    })
  })

  it('dùng mặc định page=1, limit=20 khi query rỗng', async () => {
    const repository = createRepository()
    const service = createService(repository)

    const result = await service.getUserNotifications('user-1', {})

    expect(repository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 })
    )
    expect(result).toEqual(expect.objectContaining({ total: 0, totalPages: 0 }))
  })

  it.each([
    ['true', true],
    ['false', false],
  ])('lọc isRead=%s', async (raw, expected) => {
    const repository = createRepository()
    const service = createService(repository)

    await service.getUserNotifications('user-1', { isRead: raw })

    expect(repository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', isRead: expected },
      })
    )
  })
})

describe('NotificationsService.getUnreadCount', () => {
  it('đếm tổng chưa đọc của đúng user, không phụ thuộc phân trang', async () => {
    const repository = createRepository()
    repository.countDocuments.mockResolvedValue(35)
    const service = createService(repository)

    const result = await service.getUnreadCount('user-1')

    expect(repository.countDocuments).toHaveBeenCalledWith({
      userId: 'user-1',
      isRead: false,
    })
    expect(result).toEqual({ count: 35 })
  })

  it('trả 0 khi chưa có thông báo', async () => {
    const service = createService(createRepository())

    await expect(service.getUnreadCount('user-1')).resolves.toEqual({
      count: 0,
    })
  })
})

describe('NotificationsService.markAsRead', () => {
  const id = new ObjectId().toHexString()

  it('đánh dấu đã đọc thông báo của chính user', async () => {
    const repository = createRepository({ userId: 'user-1', isRead: false })
    const service = createService(repository)

    const result = await service.markAsRead(id, 'user-1')

    expect(result.isRead).toBe(true)
    expect(repository.save).toHaveBeenCalledTimes(1)
  })

  it('404 khi id không hợp lệ', async () => {
    const service = createService(createRepository())

    await expect(service.markAsRead('abc', 'user-1')).rejects.toBeInstanceOf(
      NotFoundException
    )
  })

  it('404 khi không tìm thấy', async () => {
    const service = createService(createRepository(null))

    await expect(service.markAsRead(id, 'user-1')).rejects.toBeInstanceOf(
      NotFoundException
    )
  })

  it('404 và không đổi dữ liệu khi thông báo của user khác', async () => {
    const repository = createRepository({ userId: 'user-2', isRead: false })
    const service = createService(repository)

    await expect(service.markAsRead(id, 'user-1')).rejects.toBeInstanceOf(
      NotFoundException
    )
    expect(repository.save).not.toHaveBeenCalled()
  })
})

describe('NotificationsService.markAllAsRead', () => {
  it('đánh dấu tất cả bằng một lệnh updateMany', async () => {
    const repository = createRepository()
    const service = createService(repository)

    await service.markAllAsRead('user-1')

    expect(repository.updateMany).toHaveBeenCalledTimes(1)
    expect(repository.updateMany).toHaveBeenCalledWith(
      { userId: 'user-1', isRead: false },
      { $set: { isRead: true } }
    )
    expect(repository.save).not.toHaveBeenCalled()
  })
})

describe('NotificationsService.deleteNotification', () => {
  const id = new ObjectId().toHexString()

  it('xóa thông báo của chính user', async () => {
    const repository = createRepository()
    const service = createService(repository)

    await service.deleteNotification(id, 'user-1')

    expect(repository.deleteOne).toHaveBeenCalledWith({
      _id: new ObjectId(id),
      userId: 'user-1',
    })
  })

  it('404 khi id không hợp lệ và không chạm DB', async () => {
    const repository = createRepository()
    const service = createService(repository)

    await expect(
      service.deleteNotification('abc', 'user-1')
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(repository.deleteOne).not.toHaveBeenCalled()
  })

  it('404 khi không xóa được bản ghi nào (của user khác hoặc không có)', async () => {
    const repository = createRepository()
    repository.deleteOne.mockResolvedValue({ deletedCount: 0 })
    const service = createService(repository)

    await expect(
      service.deleteNotification(id, 'user-1')
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('NotificationsService.updateBookingNotificationStatus', () => {
  it('chỉ cập nhật thông báo BOOKING có đúng bookingId, một lệnh updateMany', async () => {
    const repository = createRepository()
    const service = createService(repository)

    await service.updateBookingNotificationStatus('B1', 'confirmed')

    expect(repository.updateMany).toHaveBeenCalledTimes(1)
    expect(repository.updateMany).toHaveBeenCalledWith(
      { type: 'BOOKING', 'data.bookingId': 'B1' },
      { $set: { isRead: true, 'data.status': 'confirmed' } }
    )
  })
})

describe('NotificationsService realtime publish', () => {
  const savedId = new ObjectId()
  const createdAt = new Date('2026-10-25T03:00:00.000Z')

  const setup = (): {
    repository: RepositoryMock
    publisher: { publish: jest.Mock }
    service: NotificationsService
  } => {
    const repository = createRepository(null)
    repository.save.mockImplementation((value: Partial<Notification>) =>
      Promise.resolve({ ...value, _id: savedId, createdAt })
    )
    repository.countDocuments.mockResolvedValue(7)
    const publisher = { publish: jest.fn().mockResolvedValue(undefined) }
    return {
      repository,
      publisher,
      service: new NotificationsService(repository as never, publisher),
    }
  }

  it('createNotification phát sự kiện kèm unreadCount sau khi lưu', async () => {
    const { service, publisher } = setup()

    await service.createNotification(
      'user-1',
      'Tiêu đề',
      'Nội dung',
      'BOOKING',
      {
        bookingId: 'B1',
      }
    )

    expect(publisher.publish).toHaveBeenCalledWith({
      userId: 'user-1',
      unreadCount: 7,
      notification: {
        _id: savedId.toHexString(),
        title: 'Tiêu đề',
        body: 'Nội dung',
        type: 'BOOKING',
        isRead: false,
        data: { bookingId: 'B1' },
        createdAt: '2026-10-25T03:00:00.000Z',
      },
    })
  })

  it('createNotificationOnce phát sự kiện khi tạo mới', async () => {
    const { service, publisher } = setup()

    await service.createNotificationOnce('user-1', 'k1', 'T', 'B', 'flow')

    expect(publisher.publish).toHaveBeenCalledTimes(1)
  })

  it('createNotificationOnce không phát khi đã tồn tại dedupeKey', async () => {
    const { service, publisher, repository } = setup()
    repository.findOne.mockResolvedValue({ userId: 'user-1', dedupeKey: 'k1' })

    const result = await service.createNotificationOnce(
      'user-1',
      'k1',
      'T',
      'B',
      'flow'
    )

    expect(result).toBeNull()
    expect(publisher.publish).not.toHaveBeenCalled()
  })

  it('lỗi publisher không làm thất bại việc lưu và được ghi log', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined)
    const { service, publisher } = setup()
    publisher.publish.mockRejectedValue(new Error('socket down'))

    const result = await service.createNotification('user-1', 'T', 'B', 'flow')

    expect(result).toEqual(expect.objectContaining({ userId: 'user-1' }))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('socket down'))
  })

  it('lỗi đếm chưa đọc cũng không làm thất bại việc lưu', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { service, publisher, repository } = setup()
    repository.countDocuments.mockRejectedValue(new Error('db down'))

    const result = await service.createNotification('user-1', 'T', 'B', 'flow')

    expect(result).toEqual(expect.objectContaining({ userId: 'user-1' }))
    expect(publisher.publish).not.toHaveBeenCalled()
  })
})

describe('NotificationsService push delivery', () => {
  const setup = (): {
    repository: RepositoryMock
    publisher: { publish: jest.Mock }
    push: { sendToUser: jest.Mock }
    service: NotificationsService
  } => {
    const repository = createRepository(null)
    repository.save.mockImplementation((value: Partial<Notification>) =>
      Promise.resolve({
        ...value,
        _id: new ObjectId(),
        createdAt: new Date('2026-10-25T03:00:00.000Z'),
      })
    )
    const publisher = { publish: jest.fn().mockResolvedValue(undefined) }
    const push = { sendToUser: jest.fn().mockResolvedValue(undefined) }
    return {
      repository,
      publisher,
      push,
      service: new NotificationsService(
        repository as never,
        publisher,
        push as never
      ),
    }
  }

  it('createNotification gửi push kèm tiêu đề, nội dung và data', async () => {
    const { service, push } = setup()

    await service.createNotification(
      'user-1',
      'Tiêu đề',
      'Nội dung',
      'BOOKING',
      {
        link: '/bookings',
      }
    )

    expect(push.sendToUser).toHaveBeenCalledWith('user-1', {
      title: 'Tiêu đề',
      body: 'Nội dung',
      data: { link: '/bookings' },
    })
  })

  it('createNotificationOnce gửi push khi tạo mới', async () => {
    const { service, push } = setup()

    await service.createNotificationOnce('user-1', 'k1', 'T', 'B', 'flow')

    expect(push.sendToUser).toHaveBeenCalledTimes(1)
  })

  it('createNotificationOnce không gửi push khi đã tồn tại dedupeKey', async () => {
    const { service, push, repository } = setup()
    repository.findOne.mockResolvedValue({ userId: 'user-1', dedupeKey: 'k1' })

    await service.createNotificationOnce('user-1', 'k1', 'T', 'B', 'flow')

    expect(push.sendToUser).not.toHaveBeenCalled()
  })

  it('realtime lỗi vẫn gửi push', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { service, publisher, push } = setup()
    publisher.publish.mockRejectedValue(new Error('socket down'))

    await service.createNotification('user-1', 'T', 'B', 'flow')

    expect(push.sendToUser).toHaveBeenCalledTimes(1)
  })

  it('push lỗi vẫn phát realtime và không làm thất bại việc lưu', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { service, publisher, push } = setup()
    push.sendToUser.mockRejectedValue(new Error('expo down'))

    const result = await service.createNotification('user-1', 'T', 'B', 'flow')

    expect(result).toEqual(expect.objectContaining({ userId: 'user-1' }))
    expect(publisher.publish).toHaveBeenCalledTimes(1)
  })

  it('không có PushService thì chỉ lưu và phát realtime', async () => {
    const repository = createRepository(null)
    repository.save.mockImplementation((value: Partial<Notification>) =>
      Promise.resolve({ ...value, _id: new ObjectId(), createdAt: new Date() })
    )
    const publisher = { publish: jest.fn().mockResolvedValue(undefined) }
    const service = new NotificationsService(repository as never, publisher)

    await expect(
      service.createNotification('user-1', 'T', 'B', 'flow')
    ).resolves.toEqual(expect.objectContaining({ userId: 'user-1' }))
  })

  it('tôn trọng tùy chọn tắt push của người dùng', async () => {
    const repository = createRepository(null)
    repository.save.mockImplementation((value: Partial<Notification>) =>
      Promise.resolve({ ...value, _id: new ObjectId(), createdAt: new Date() })
    )
    const publisher = { publish: jest.fn().mockResolvedValue(undefined) }
    const push = { sendToUser: jest.fn().mockResolvedValue(undefined) }
    const userRepo = {
      findOne: jest.fn().mockResolvedValue({
        _id: new ObjectId(),
        notificationPreferences: { email: true, push: false },
      }),
    }

    const service = new NotificationsService(
      repository as never,
      publisher,
      push as never,
      userRepo as never
    )

    await service.createNotification('user-1', 'T', 'B', 'flow')

    expect(publisher.publish).toHaveBeenCalledTimes(1)
    expect(push.sendToUser).not.toHaveBeenCalled()
  })

  it('tôn trọng tùy chọn bật push của người dùng hoặc mặc định', async () => {
    const repository = createRepository(null)
    repository.save.mockImplementation((value: Partial<Notification>) =>
      Promise.resolve({ ...value, _id: new ObjectId(), createdAt: new Date() })
    )
    const publisher = { publish: jest.fn().mockResolvedValue(undefined) }
    const push = { sendToUser: jest.fn().mockResolvedValue(undefined) }
    const userRepo = {
      findOne: jest.fn().mockResolvedValue({
        _id: new ObjectId(),
        notificationPreferences: { email: true, push: true },
      }),
    }

    const service = new NotificationsService(
      repository as never,
      publisher,
      push as never,
      userRepo as never
    )

    await service.createNotification('user-1', 'T', 'B', 'flow')

    expect(push.sendToUser).toHaveBeenCalledTimes(1)
  })
})
