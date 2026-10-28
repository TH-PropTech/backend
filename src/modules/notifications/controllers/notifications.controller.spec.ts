import { BadRequestException, NotFoundException } from '@nestjs/common'
import { NotificationsController } from './notifications.controller'
import type { NotificationsService } from '../services/notifications.service'
import type { PushTokensService } from '../services/push-tokens.service'

type ServiceMock = Record<
  | 'getUserNotifications'
  | 'getUnreadCount'
  | 'markAllAsRead'
  | 'markAsRead'
  | 'deleteNotification',
  jest.Mock
>

type PushTokensMock = Record<'register' | 'unregister', jest.Mock>

const createController = (): {
  controller: NotificationsController
  service: ServiceMock
  pushTokens: PushTokensMock
} => {
  const pushTokens = {
    register: jest.fn().mockResolvedValue(undefined),
    unregister: jest.fn().mockResolvedValue(undefined),
  }
  const service = {
    getUserNotifications: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    getUnreadCount: jest.fn().mockResolvedValue({ count: 3 }),
    markAllAsRead: jest.fn().mockResolvedValue(undefined),
    markAsRead: jest.fn().mockResolvedValue({ isRead: true }),
    deleteNotification: jest.fn().mockResolvedValue(undefined),
  }
  return {
    controller: new NotificationsController(
      service as unknown as NotificationsService,
      pushTokens as unknown as PushTokensService
    ),
    service,
    pushTokens,
  }
}

type AnonymousCall = (controller: NotificationsController) => Promise<unknown>

const authed = { user: { _id: 'user-1' } } as never
const anonymous = { user: {} } as never

afterEach(() => jest.clearAllMocks())

describe('NotificationsController', () => {
  it('danh sách: truyền userId và query xuống service', async () => {
    const { controller, service } = createController()

    await controller.getNotifications(authed, { page: 2, limit: 10 })

    expect(service.getUserNotifications).toHaveBeenCalledWith('user-1', {
      page: 2,
      limit: 10,
    })
  })

  it('unread-count: trả số chưa đọc của user hiện tại', async () => {
    const { controller, service } = createController()

    await expect(controller.getUnreadCount(authed)).resolves.toEqual({
      count: 3,
    })
    expect(service.getUnreadCount).toHaveBeenCalledWith('user-1')
  })

  it('read-all: gọi service và trả success', async () => {
    const { controller, service } = createController()

    await expect(controller.markAllRead(authed)).resolves.toEqual({
      success: true,
    })
    expect(service.markAllAsRead).toHaveBeenCalledWith('user-1')
  })

  it('đánh dấu 1 thông báo: truyền id và userId', async () => {
    const { controller, service } = createController()

    await controller.markRead('n1', authed)

    expect(service.markAsRead).toHaveBeenCalledWith('n1', 'user-1')
  })

  it('xóa: truyền id và userId, trả success để client đọc được JSON', async () => {
    const { controller, service } = createController()

    await expect(controller.remove('n1', authed)).resolves.toEqual({
      success: true,
    })
    expect(service.deleteNotification).toHaveBeenCalledWith('n1', 'user-1')
  })

  it('xóa: lan truyền 404 từ service', async () => {
    const { controller, service } = createController()
    service.deleteNotification.mockRejectedValue(new NotFoundException())

    await expect(controller.remove('n1', authed)).rejects.toBeInstanceOf(
      NotFoundException
    )
  })

  it('đăng ký push token: truyền userId và dto, trả success', async () => {
    const { controller, pushTokens } = createController()
    const dto = { token: 'ExponentPushToken[x]', platform: 'ios' as const }

    await expect(controller.registerPushToken(authed, dto)).resolves.toEqual({
      success: true,
    })
    expect(pushTokens.register).toHaveBeenCalledWith('user-1', dto)
  })

  it('đăng ký push token: lan truyền 400 từ service', async () => {
    const { controller, pushTokens } = createController()
    pushTokens.register.mockRejectedValue(new BadRequestException())

    await expect(
      controller.registerPushToken(authed, { token: 'bad' })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('hủy push token: truyền userId và token, trả success', async () => {
    const { controller, pushTokens } = createController()

    await expect(
      controller.unregisterPushToken('ExponentPushToken[x]', authed)
    ).resolves.toEqual({ success: true })
    expect(pushTokens.unregister).toHaveBeenCalledWith(
      'user-1',
      'ExponentPushToken[x]'
    )
  })

  const anonymousCalls: Array<[string, AnonymousCall]> = [
    [
      'đăng ký push token',
      (c): Promise<unknown> => c.registerPushToken(anonymous, { token: 't' }),
    ],
    [
      'hủy push token',
      (c): Promise<unknown> => c.unregisterPushToken('t', anonymous),
    ],
    ['danh sách', (c): Promise<unknown> => c.getNotifications(anonymous, {})],
    ['unread-count', (c): Promise<unknown> => c.getUnreadCount(anonymous)],
    ['read-all', (c): Promise<unknown> => c.markAllRead(anonymous)],
    ['đọc 1', (c): Promise<unknown> => c.markRead('n1', anonymous)],
    ['xóa', (c): Promise<unknown> => c.remove('n1', anonymous)],
  ]

  it.each(anonymousCalls)(
    '%s: từ chối khi token không có _id',
    async (_name, call) => {
      const { controller } = createController()

      await expect(call(controller)).rejects.toThrow(
        'Không thể xác thực người dùng'
      )
    }
  )
})
