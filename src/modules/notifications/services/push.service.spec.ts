import { Logger } from '@nestjs/common'
import { PushService } from './push.service'

const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]'
const TOKEN_B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]'

interface TokensMock {
  findTokensByUser: jest.Mock
  removeTokens: jest.Mock
}

interface ExpoMock {
  chunkPushNotifications: jest.Mock
  sendPushNotificationsAsync: jest.Mock
}

const createTokens = (tokens: string[]): TokensMock => ({
  findTokensByUser: jest.fn().mockResolvedValue(tokens),
  removeTokens: jest.fn().mockResolvedValue(undefined),
})

/** Mỗi tin là một lô riêng để kiểm tra việc gửi từng lô độc lập. */
const createExpo = (): ExpoMock => ({
  chunkPushNotifications: jest.fn((messages: unknown[]) =>
    messages.map(message => [message])
  ),
  sendPushNotificationsAsync: jest.fn((chunk: unknown[]) =>
    Promise.resolve(chunk.map(() => ({ status: 'ok', id: 'ticket' })))
  ),
})

const createService = (tokens: TokensMock, expo: ExpoMock): PushService =>
  new PushService(tokens as never, expo)

const payload = {
  title: 'Tiêu đề',
  body: 'Nội dung',
  data: { link: '/bookings' },
}

let warnSpy: jest.SpyInstance

beforeEach(() => {
  warnSpy = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined)
})

afterEach(() => {
  jest.clearAllMocks()
})

describe('PushService.sendToUser', () => {
  it('gửi một tin cho mỗi thiết bị của user kèm tiêu đề, nội dung và data', async () => {
    const tokens = createTokens([TOKEN_A, TOKEN_B])
    const expo = createExpo()
    const service = createService(tokens, expo)

    await service.sendToUser('user-1', payload)

    expect(tokens.findTokensByUser).toHaveBeenCalledWith('user-1')
    const sent = expo.sendPushNotificationsAsync.mock.calls.flatMap(
      ([chunk]) => chunk as unknown[]
    )
    expect(sent).toEqual([
      expect.objectContaining({
        to: TOKEN_A,
        title: 'Tiêu đề',
        body: 'Nội dung',
        data: { link: '/bookings' },
        sound: 'default',
      }),
      expect.objectContaining({ to: TOKEN_B }),
    ])
  })

  it('không gọi Expo khi user chưa đăng ký thiết bị nào', async () => {
    const expo = createExpo()
    const service = createService(createTokens([]), expo)

    await service.sendToUser('user-1', payload)

    expect(expo.sendPushNotificationsAsync).not.toHaveBeenCalled()
  })

  it('bỏ qua token sai định dạng', async () => {
    const expo = createExpo()
    const service = createService(createTokens(['bad-token', TOKEN_A]), expo)

    await service.sendToUser('user-1', payload)

    const sent = expo.sendPushNotificationsAsync.mock.calls.flatMap(
      ([chunk]) => chunk as Array<{ to: string }>
    )
    expect(sent.map(message => message.to)).toEqual([TOKEN_A])
  })

  it('xóa token khi Expo báo DeviceNotRegistered', async () => {
    const tokens = createTokens([TOKEN_A, TOKEN_B])
    const expo = createExpo()
    expo.sendPushNotificationsAsync.mockImplementation((chunk: unknown[]) => {
      const [message] = chunk as Array<{ to: string }>
      return Promise.resolve(
        message?.to === TOKEN_A
          ? [
              {
                status: 'error',
                message: 'gone',
                details: { error: 'DeviceNotRegistered' },
              },
            ]
          : [{ status: 'ok', id: 'ticket' }]
      )
    })
    const service = createService(tokens, expo)

    await service.sendToUser('user-1', payload)

    expect(tokens.removeTokens).toHaveBeenCalledWith([TOKEN_A])
  })

  it('không xóa token khi lỗi khác DeviceNotRegistered, chỉ ghi log', async () => {
    const tokens = createTokens([TOKEN_A])
    const expo = createExpo()
    expo.sendPushNotificationsAsync.mockResolvedValue([
      {
        status: 'error',
        message: 'too big',
        details: { error: 'MessageTooBig' },
      },
    ])
    const service = createService(tokens, expo)

    await service.sendToUser('user-1', payload)

    expect(tokens.removeTokens).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('một lô gửi lỗi không chặn các lô còn lại', async () => {
    const expo = createExpo()
    expo.sendPushNotificationsAsync
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([{ status: 'ok', id: 'ticket' }])
    const service = createService(createTokens([TOKEN_A, TOKEN_B]), expo)

    await expect(service.sendToUser('user-1', payload)).resolves.toBeUndefined()

    expect(expo.sendPushNotificationsAsync).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('không ném lỗi khi đọc token thất bại', async () => {
    const tokens = createTokens([])
    tokens.findTokensByUser.mockRejectedValue(new Error('db down'))
    const expo = createExpo()
    const service = createService(tokens, expo)

    await expect(service.sendToUser('user-1', payload)).resolves.toBeUndefined()

    expect(expo.sendPushNotificationsAsync).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('không ném lỗi khi xóa token chết thất bại', async () => {
    const tokens = createTokens([TOKEN_A])
    tokens.removeTokens.mockRejectedValue(new Error('db down'))
    const expo = createExpo()
    expo.sendPushNotificationsAsync.mockResolvedValue([
      {
        status: 'error',
        message: 'gone',
        details: { error: 'DeviceNotRegistered' },
      },
    ])
    const service = createService(tokens, expo)

    await expect(service.sendToUser('user-1', payload)).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalled()
  })
})
