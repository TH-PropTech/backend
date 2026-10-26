import { BadRequestException } from '@nestjs/common'
import { PushTokensService } from './push-tokens.service'
import type { PushToken } from '../schemas/push-token.schema'

interface RepositoryMock {
  findOne: jest.Mock
  find: jest.Mock
  deleteMany: jest.Mock
  create: jest.Mock
  save: jest.Mock
}

const VALID_TOKEN = 'ExponentPushToken[abcdefghijklmnopqrstuv]'

const createRepository = (
  existing: Partial<PushToken> | null = null
): RepositoryMock => ({
  findOne: jest.fn().mockResolvedValue(existing),
  find: jest.fn().mockResolvedValue([]),
  deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
  create: jest.fn((value: Partial<PushToken>) => value),
  save: jest.fn((value: Partial<PushToken>) => Promise.resolve(value)),
})

const createService = (repository: RepositoryMock): PushTokensService =>
  new PushTokensService(repository as never)

afterEach(() => jest.clearAllMocks())

describe('PushTokensService.register', () => {
  it('lưu token mới cho user kèm platform', async () => {
    const repository = createRepository(null)
    const service = createService(repository)

    await service.register('user-1', { token: VALID_TOKEN, platform: 'ios' })

    expect(repository.save).toHaveBeenCalledWith({
      userId: 'user-1',
      token: VALID_TOKEN,
      platform: 'ios',
    })
  })

  it('lưu platform null khi client không gửi', async () => {
    const repository = createRepository(null)
    const service = createService(repository)

    await service.register('user-1', { token: VALID_TOKEN })

    expect(repository.save).toHaveBeenCalledWith({
      userId: 'user-1',
      token: VALID_TOKEN,
      platform: null,
    })
  })

  it('xóa token cùng giá trị đang gắn với user khác (máy đổi tài khoản)', async () => {
    const repository = createRepository(null)
    const service = createService(repository)

    await service.register('user-1', { token: VALID_TOKEN })

    expect(repository.deleteMany).toHaveBeenCalledWith({
      token: VALID_TOKEN,
      userId: { $ne: 'user-1' },
    })
  })

  it('đăng ký lại cùng cặp (user, token) không tạo bản ghi mới', async () => {
    const repository = createRepository({
      userId: 'user-1',
      token: VALID_TOKEN,
      platform: 'ios',
    })
    const service = createService(repository)

    await service.register('user-1', { token: VALID_TOKEN, platform: 'ios' })

    expect(repository.save).not.toHaveBeenCalled()
  })

  it('cập nhật platform khi token cũ đổi nền tảng', async () => {
    const repository = createRepository({
      userId: 'user-1',
      token: VALID_TOKEN,
      platform: 'ios',
    })
    const service = createService(repository)

    await service.register('user-1', {
      token: VALID_TOKEN,
      platform: 'android',
    })

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ token: VALID_TOKEN, platform: 'android' })
    )
  })

  it('ném 400 và không đụng DB khi token không phải Expo push token', async () => {
    const repository = createRepository(null)
    const service = createService(repository)

    await expect(
      service.register('user-1', { token: 'not-a-token' })
    ).rejects.toBeInstanceOf(BadRequestException)

    expect(repository.deleteMany).not.toHaveBeenCalled()
    expect(repository.save).not.toHaveBeenCalled()
  })
})

describe('PushTokensService.unregister', () => {
  it('chỉ xóa token của chính user', async () => {
    const repository = createRepository()
    const service = createService(repository)

    await service.unregister('user-1', VALID_TOKEN)

    expect(repository.deleteMany).toHaveBeenCalledWith({
      userId: 'user-1',
      token: VALID_TOKEN,
    })
  })

  it('không ném lỗi khi token không tồn tại (idempotent)', async () => {
    const repository = createRepository()
    repository.deleteMany.mockResolvedValue({ deletedCount: 0 })
    const service = createService(repository)

    await expect(
      service.unregister('user-1', VALID_TOKEN)
    ).resolves.toBeUndefined()
  })
})

describe('PushTokensService.findTokensByUser', () => {
  it('trả danh sách chuỗi token của user', async () => {
    const repository = createRepository()
    repository.find.mockResolvedValue([
      { token: 'a' },
      { token: 'b' },
    ] as PushToken[])
    const service = createService(repository)

    await expect(service.findTokensByUser('user-1')).resolves.toEqual([
      'a',
      'b',
    ])
    expect(repository.find).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    })
  })

  it('trả mảng rỗng khi user chưa có thiết bị nào', async () => {
    const service = createService(createRepository())

    await expect(service.findTokensByUser('user-1')).resolves.toEqual([])
  })
})

describe('PushTokensService.removeTokens', () => {
  it('xóa mọi bản ghi có token trong danh sách', async () => {
    const repository = createRepository()
    const service = createService(repository)

    await service.removeTokens(['a', 'b'])

    expect(repository.deleteMany).toHaveBeenCalledWith({
      token: { $in: ['a', 'b'] },
    })
  })

  it('bỏ qua khi danh sách rỗng', async () => {
    const repository = createRepository()
    const service = createService(repository)

    await service.removeTokens([])

    expect(repository.deleteMany).not.toHaveBeenCalled()
  })
})
