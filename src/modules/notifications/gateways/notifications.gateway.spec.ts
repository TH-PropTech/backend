import { Logger } from '@nestjs/common'
import type { WebSocket } from 'ws'
import { NotificationsGateway } from './notifications.gateway'
import type { NotificationCreatedEvent } from './notifications.publisher'

type MessageHandler = () => void

class FakeSocket {
  readonly send = jest.fn()
  readonly close = jest.fn()
  readonly ping = jest.fn()
  readonly terminate = jest.fn()
  readonly on = jest.fn((event: string, handler: MessageHandler) => {
    if (event === 'pong') this.pongHandler = handler
  })
  readyState = 1
  private pongHandler?: MessageHandler

  emitPong(): void {
    this.pongHandler?.()
  }

  asClient(): WebSocket {
    return this as unknown as WebSocket
  }
}

const token = 'access-token-must-not-be-logged'

const createEvent = (userId: string): NotificationCreatedEvent => ({
  userId,
  unreadCount: 4,
  notification: {
    _id: 'n1',
    title: 'Có lịch hẹn mới',
    body: 'Nội dung',
    type: 'BOOKING',
    isRead: false,
    data: { bookingId: 'B1' },
    createdAt: '2026-10-25T03:00:00.000Z',
  },
})

const expectedMessage = (event: NotificationCreatedEvent): string =>
  JSON.stringify({
    event: 'notification.created',
    data: {
      notification: event.notification,
      unreadCount: event.unreadCount,
    },
  })

describe('NotificationsGateway', () => {
  let verify: jest.Mock
  let gateway: NotificationsGateway

  const connect = (userId?: string): FakeSocket => {
    const socket = new FakeSocket()
    gateway.handleConnection(socket.asClient())
    if (userId) {
      verify.mockReturnValueOnce({ _id: userId })
      gateway.handleAuth(socket.asClient(), { token })
    }
    return socket
  }

  beforeEach(() => {
    jest.useFakeTimers()
    verify = jest.fn()
    gateway = new NotificationsGateway({ verify } as never)
  })

  afterEach(() => {
    gateway.onApplicationShutdown()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('đóng kết nối chưa xác thực với mã 4401 sau 5 giây', () => {
    const socket = connect()

    jest.advanceTimersByTime(5_000)

    expect(socket.close).toHaveBeenCalledWith(4401, 'Unauthorized')
  })

  it('không đóng kết nối đã xác thực khi hết 5 giây', () => {
    const socket = connect('user-1')

    jest.advanceTimersByTime(5_000)

    expect(socket.close).not.toHaveBeenCalled()
  })

  it('từ chối JWT sai và không ghi token vào log', () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined)
    verify.mockImplementation(() => {
      throw new Error('invalid token')
    })
    const socket = connect()

    gateway.handleAuth(socket.asClient(), { token })

    expect(socket.close).toHaveBeenCalledWith(4401, 'Unauthorized')
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token)
  })

  it.each([
    ['không có token', {}],
    ['token không phải chuỗi', { token: 123 }],
  ])('từ chối auth khi %s', (_name, body) => {
    const socket = connect()

    gateway.handleAuth(socket.asClient(), body)

    expect(socket.close).toHaveBeenCalledWith(4401, 'Unauthorized')
  })

  it('từ chối JWT hợp lệ nhưng thiếu _id', () => {
    const socket = connect()
    verify.mockReturnValueOnce({})

    gateway.handleAuth(socket.asClient(), { token })

    expect(socket.close).toHaveBeenCalledWith(4401, 'Unauthorized')
  })

  it('chỉ gửi tới đúng user, không gửi cho user khác hay socket chưa xác thực', async () => {
    const owner = connect('user-1')
    const other = connect('user-2')
    const anonymous = connect()
    const event = createEvent('user-1')

    await gateway.publish(event)

    expect(owner.send).toHaveBeenCalledWith(expectedMessage(event))
    expect(other.send).not.toHaveBeenCalled()
    expect(anonymous.send).not.toHaveBeenCalled()
  })

  it('gửi tới mọi kết nối đang mở của cùng một user', async () => {
    const tabA = connect('user-1')
    const tabB = connect('user-1')

    await gateway.publish(createEvent('user-1'))

    expect(tabA.send).toHaveBeenCalledTimes(1)
    expect(tabB.send).toHaveBeenCalledTimes(1)
  })

  it('bỏ qua socket không còn ở trạng thái OPEN', async () => {
    const closing = connect('user-1')
    closing.readyState = 3

    await gateway.publish(createEvent('user-1'))

    expect(closing.send).not.toHaveBeenCalled()
  })

  it('không gửi nữa sau khi socket ngắt kết nối', async () => {
    const socket = connect('user-1')

    gateway.handleDisconnect(socket.asClient())
    await gateway.publish(createEvent('user-1'))

    expect(socket.send).not.toHaveBeenCalled()
  })

  it('lỗi gửi tới một socket không làm hỏng việc gửi cho socket khác', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined)
    const broken = connect('user-1')
    const healthy = connect('user-1')
    broken.send.mockImplementation(() => {
      throw new Error('socket write failed')
    })

    await expect(
      gateway.publish(createEvent('user-1'))
    ).resolves.toBeUndefined()

    expect(healthy.send).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
  })

  it('heartbeat: ping định kỳ và terminate socket không trả lời pong', () => {
    gateway.afterInit()
    const alive = connect('user-1')
    const dead = connect('user-2')

    jest.advanceTimersByTime(30_000)
    expect(alive.ping).toHaveBeenCalledTimes(1)
    expect(dead.ping).toHaveBeenCalledTimes(1)

    alive.emitPong()
    jest.advanceTimersByTime(30_000)

    expect(dead.terminate).toHaveBeenCalledTimes(1)
    expect(alive.terminate).not.toHaveBeenCalled()
  })

  it('tắt ứng dụng: terminate mọi socket và dừng heartbeat', () => {
    gateway.afterInit()
    const socket = connect('user-1')

    gateway.onApplicationShutdown()
    jest.advanceTimersByTime(60_000)

    expect(socket.terminate).toHaveBeenCalledTimes(1)
    expect(socket.ping).not.toHaveBeenCalled()
  })
})
