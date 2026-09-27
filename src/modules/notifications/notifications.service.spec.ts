import { NotificationsService } from './notifications.service'
import type { Notification } from './schemas/notification.schema'

describe('NotificationsService.createNotificationOnce', () => {
  const createService = (
    existing: Partial<Notification> | null
  ): {
    service: NotificationsService
    repository: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock }
  } => {
    const repository = {
      findOne: jest.fn().mockResolvedValue(existing),
      create: jest.fn((value: Partial<Notification>) => value),
      save: jest.fn((value: Partial<Notification>) => Promise.resolve(value)),
    }
    return {
      service: new NotificationsService(repository as never),
      repository,
    }
  }

  afterEach(() => jest.clearAllMocks())

  it('tạo thông báo kèm dedupeKey khi user chưa nhận khóa đó', async () => {
    const { service, repository } = createService(null)

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
    const { service, repository } = createService({
      userId: 'user-1',
      dedupeKey: 'flow:c1:deposit:done',
    })

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
