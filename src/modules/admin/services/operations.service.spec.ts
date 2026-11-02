import type { ReadCacheService } from '../../health/services/read-cache.service'
import { OperationsService } from './operations.service'

type Doc = Record<string, unknown>
type Pipeline = Array<Record<string, unknown>>

/** Giả lập hai dạng pipeline mà service dùng: $group theo status, và $group theo (ngày, status). */
function fakeRepository(docs: Doc[]): {
  aggregate: jest.Mock
  find: jest.Mock
} {
  const aggregate = jest.fn((pipeline: Pipeline) => ({
    toArray: (): Promise<unknown[]> =>
      Promise.resolve(runPipeline(docs, pipeline)),
  }))
  return { aggregate, find: jest.fn() }
}

function runPipeline(docs: Doc[], pipeline: Pipeline): unknown[] {
  const match = pipeline.find(stage => '$match' in stage) as
    | { $match: { at: { $gte: Date } } }
    | undefined
  const selected = match
    ? docs.filter(
        doc =>
          new Date((doc.visitAt ?? doc.createdAt) as Date) >=
          match.$match.at.$gte
      )
    : docs
  const group = (
    pipeline.find(stage => '$group' in stage) as {
      $group: { _id: unknown }
    }
  ).$group

  const counts = new Map<string, { _id: unknown; count: number }>()
  for (const doc of selected) {
    const id =
      typeof group._id === 'string'
        ? doc.status
        : {
            day: localDay(new Date((doc.visitAt ?? doc.createdAt) as Date)),
            status: doc.status,
          }
    const key = JSON.stringify(id)
    const entry = counts.get(key) ?? { _id: id, count: 0 }
    entry.count += 1
    counts.set(key, entry)
  }
  return [...counts.values()]
}

function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function createService(
  kycCounts: {
    pending: number
    verified: number
    rejected: number
    total: number
  },
  data: { bookings?: Doc[]; apartments?: Doc[]; tickets?: Doc[] } = {}
): {
  service: OperationsService
  kycService: { countByStatus: jest.Mock }
  repositories: Record<'booking' | 'apartment' | 'ticket', { find: jest.Mock }>
} {
  const kycService = {
    countByStatus: jest.fn().mockResolvedValue(kycCounts),
  }
  const booking = fakeRepository(data.bookings ?? [])
  const apartment = fakeRepository(data.apartments ?? [])
  const ticket = fakeRepository(data.tickets ?? [])
  const readCache = {
    wrap: jest.fn(
      (
        _namespace: string,
        _parts: Record<string, unknown>,
        loader: () => Promise<unknown>
      ) => loader()
    ),
  }
  const service = Object.create(
    OperationsService.prototype
  ) as OperationsService
  Reflect.set(service, 'logger', { log: jest.fn() })
  Reflect.set(service, 'bookingRepo', booking)
  Reflect.set(service, 'apartmentRepo', apartment)
  Reflect.set(service, 'ticketRepo', ticket)
  Reflect.set(service, 'kycService', kycService)
  Reflect.set(service, 'readCache', readCache as unknown as ReadCacheService)
  return {
    service,
    kycService,
    repositories: { booking, apartment, ticket },
  }
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

describe('OperationsService read side (tính ở phía DB)', () => {
  const noKyc = { pending: 0, verified: 0, rejected: 0, total: 0 }
  const bookings: Doc[] = [
    { status: 'pending' },
    { status: 'confirmed' },
    { status: 'confirmed' },
    { status: 'cancelled' },
    { status: 'rejected' },
    { status: 'completed' },
  ]
  const apartments: Doc[] = [
    { status: 'pending' },
    { status: 'available' },
    { status: 'available' },
    { status: 'rented' },
    { status: 'rejected' },
  ]
  const tickets: Doc[] = [
    { status: 'open' },
    { status: 'in_progress' },
    { status: 'waiting_staff' },
    { status: 'resolved' },
    { status: 'closed' },
    { status: 'closed' },
  ]

  it('cho số liệu giống cách đếm cũ trên cùng dữ liệu', async () => {
    const { service } = createService(noKyc, { bookings, apartments, tickets })

    const stats = await service.getStats()

    expect(stats.bookings).toEqual({
      total: 6,
      pending: 1,
      confirmed: 2,
      cancelled: 2,
      completed: 1,
    })
    expect(stats.apartments).toEqual({
      total: 5,
      pending: 1,
      available: 2,
      rejected: 1,
    })
    expect(stats.tickets).toEqual({
      total: 6,
      open: 1,
      inProgress: 2,
      resolved: 3,
    })
  })

  it('không còn nạp toàn bộ document vào bộ nhớ', async () => {
    const { service, repositories } = createService(noKyc, {
      bookings,
      apartments,
      tickets,
    })

    await service.getStats()
    await service.getChartData(7)

    for (const repository of Object.values(repositories)) {
      expect(repository.find).not.toHaveBeenCalled()
    }
  })

  it('gom biểu đồ theo ngày và trạng thái giống cách lọc cũ', async () => {
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const longAgo = new Date(today)
    longAgo.setDate(longAgo.getDate() - 30)
    const { service } = createService(noKyc, {
      bookings: [
        { status: 'pending', visitAt: today },
        { status: 'confirmed', visitAt: today },
        { status: 'completed', visitAt: yesterday },
        { status: 'cancelled', visitAt: yesterday },
        { status: 'rejected', createdAt: yesterday },
        { status: 'confirmed', visitAt: longAgo },
      ],
    })

    const chart = await service.getChartData(3)

    expect(chart.trend).toHaveLength(3)
    const [, yesterdayPoint, todayPoint] = chart.trend
    expect(todayPoint).toMatchObject({
      bookings: 2,
      pending: 1,
      confirmed: 1,
      cancelled: 0,
    })
    expect(yesterdayPoint).toMatchObject({
      bookings: 3,
      pending: 0,
      confirmed: 1,
      cancelled: 2,
    })
    expect(
      chart.statusBreakdown.map(item => [item.status, item.count])
    ).toEqual([
      ['pending', 1],
      ['confirmed', 1],
      ['completed', 1],
      ['cancelled', 1],
      ['rejected', 1],
    ])
  })

  it('cache kết quả thống kê với TTL 60 giây', async () => {
    const { service } = createService(noKyc)
    const readCache = Reflect.get(service, 'readCache') as {
      wrap: jest.Mock
    }

    await service.getStats()
    await service.getChartData(7)

    expect(readCache.wrap).toHaveBeenNthCalledWith(
      1,
      'operations',
      { kind: 'stats' },
      expect.any(Function),
      60
    )
    expect(readCache.wrap).toHaveBeenNthCalledWith(
      2,
      'operations',
      { kind: 'chart', days: 7 },
      expect.any(Function),
      60
    )
  })
})
