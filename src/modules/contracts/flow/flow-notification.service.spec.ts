import { ObjectId } from 'mongodb'
import { NotificationsService } from '../../notifications/notifications.service'
import type { Notification } from '../../notifications/schemas/notification.schema'
import type { ContractFlowStageDto } from '../dto/contract-view.dto'
import { FlowNotificationService } from './flow-notification.service'

describe('FlowNotificationService', () => {
  const contractId = new ObjectId().toHexString()
  const agreementId = new ObjectId().toHexString()

  const stage = (
    key: ContractFlowStageDto['key'],
    status: ContractFlowStageDto['status']
  ): ContractFlowStageDto => ({ key, status, blockers: [], completedAt: null })

  type TestContext = {
    service: FlowNotificationService
    saved: Array<Partial<Notification>>
    viewService: { getForActor: jest.Mock }
    contractRepository: { findOne: jest.Mock }
  }

  const createContext = (stages: ContractFlowStageDto[]): TestContext => {
    const saved: Array<Partial<Notification>> = []
    const notificationRepository = {
      findOne: jest.fn(
        ({ where }: { where: { userId: string; dedupeKey: string } }) =>
          Promise.resolve(
            saved.find(
              item =>
                item.userId === where.userId &&
                item.dedupeKey === where.dedupeKey
            ) ?? null
          )
      ),
      create: jest.fn((value: Partial<Notification>) => value),
      save: jest.fn((value: Partial<Notification>) => {
        saved.push(value)
        return Promise.resolve(value)
      }),
    }
    const viewService = {
      getForActor: jest.fn().mockResolvedValue({
        parties: {
          tenant: { id: 'tenant-1' },
          landlord: { id: 'landlord-1' },
        },
        flow: { stages },
      }),
    }
    const contractRepository = {
      findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(contractId) }),
    }
    const service = new FlowNotificationService(
      viewService as never,
      new NotificationsService(notificationRepository as never),
      contractRepository as never
    )
    return { service, saved, viewService, contractRepository }
  }

  afterEach(() => jest.clearAllMocks())

  it('gửi một thông báo cho mỗi bên khi stage done hoặc blocked, bỏ qua active/upcoming', async () => {
    const { service, saved, viewService } = createContext([
      stage('document', 'done'),
      stage('deposit', 'blocked'),
      stage('signing', 'active'),
      stage('ledger', 'upcoming'),
    ])

    await service.notifyForContract(contractId)

    expect(viewService.getForActor).toHaveBeenCalledWith(
      contractId,
      'system',
      true
    )
    expect(saved.map(item => [item.userId, item.dedupeKey])).toEqual([
      ['tenant-1', `flow:${contractId}:document:done`],
      ['landlord-1', `flow:${contractId}:document:done`],
      ['tenant-1', `flow:${contractId}:deposit:blocked`],
      ['landlord-1', `flow:${contractId}:deposit:blocked`],
    ])
    expect(saved[0]).toEqual(
      expect.objectContaining({
        type: 'contract-flow',
        data: { contractId, stage: 'document', state: 'done' },
      })
    )
  })

  it('callback cọc xử lý lặp chỉ tạo tối đa một thông báo "Đã xác nhận cọc" mỗi bên', async () => {
    const { service, saved } = createContext([
      stage('document', 'done'),
      stage('deposit', 'done'),
    ])

    await service.notifyForDepositAgreement(agreementId)
    await service.notifyForDepositAgreement(agreementId)

    const depositNotices = saved.filter(item =>
      item.dedupeKey?.endsWith(':deposit:done')
    )
    expect(depositNotices.map(item => item.title)).toEqual([
      'Đã xác nhận cọc',
      'Đã xác nhận cọc',
    ])
    expect(saved).toHaveLength(4)
  })

  it('bỏ qua khi thỏa thuận cọc chưa liên kết hợp đồng', async () => {
    const { service, saved, contractRepository, viewService } = createContext([
      stage('deposit', 'done'),
    ])
    contractRepository.findOne.mockResolvedValueOnce(null)

    await service.notifyForDepositAgreement(agreementId)

    expect(contractRepository.findOne).toHaveBeenCalledWith({
      where: { depositAgreementId: agreementId },
    })
    expect(viewService.getForActor).not.toHaveBeenCalled()
    expect(saved).toEqual([])
  })

  it('không làm hỏng giao dịch khi đọc view lỗi', async () => {
    const { service, viewService, saved } = createContext([])
    viewService.getForActor.mockRejectedValueOnce(new Error('DB_DOWN'))
    const warn = jest
      .spyOn(
        (service as unknown as { logger: { warn: () => void } }).logger,
        'warn'
      )
      .mockImplementation(() => undefined)

    await expect(service.notifyForContract(contractId)).resolves.toBeUndefined()

    expect(saved).toEqual([])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('FLOW_NOTIFICATION_FAILED')
    )
  })

  it('không gửi khi view không có flow', async () => {
    const { service, viewService, saved } = createContext([])
    viewService.getForActor.mockResolvedValueOnce({
      parties: { tenant: { id: 'tenant-1' }, landlord: { id: 'landlord-1' } },
    })

    await service.notifyForContract(contractId)

    expect(saved).toEqual([])
  })
})
