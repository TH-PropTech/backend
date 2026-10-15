import { OperationsService } from './operations.service'

function createService(kycCounts: {
  pending: number
  verified: number
  rejected: number
  total: number
}): {
  service: OperationsService
  kycService: { countByStatus: jest.Mock }
} {
  const kycService = {
    countByStatus: jest.fn().mockResolvedValue(kycCounts),
  }
  const service = Object.create(
    OperationsService.prototype
  ) as OperationsService
  Reflect.set(service, 'logger', { log: jest.fn() })
  Reflect.set(service, 'bookingRepo', { find: jest.fn().mockResolvedValue([]) })
  Reflect.set(service, 'apartmentRepo', {
    find: jest.fn().mockResolvedValue([]),
  })
  Reflect.set(service, 'ticketRepo', { find: jest.fn().mockResolvedValue([]) })
  Reflect.set(service, 'kycService', kycService)
  return { service, kycService }
}

describe('OperationsService.getStats (KYC)', () => {
  it('lấy thống kê KYC từ KycService (users.kyc) với cùng hình dữ liệu', async () => {
    const { service, kycService } = createService({
      pending: 2,
      verified: 1,
      rejected: 1,
      total: 4,
    })

    const stats = await service.getStats()

    expect(kycService.countByStatus).toHaveBeenCalledTimes(1)
    expect(stats.kyc).toEqual({
      total: 4,
      pending: 2,
      verified: 1,
      rejected: 1,
    })
  })

  it('không có hồ sơ KYC thì các số đều bằng 0', async () => {
    const { service } = createService({
      pending: 0,
      verified: 0,
      rejected: 0,
      total: 0,
    })

    const stats = await service.getStats()

    expect(stats.kyc).toEqual({
      total: 0,
      pending: 0,
      verified: 0,
      rejected: 0,
    })
  })
})
