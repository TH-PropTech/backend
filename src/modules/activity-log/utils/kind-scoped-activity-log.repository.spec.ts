import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import type { BlockchainLog } from '../../fabric/schemas/blockchain-log.schema'
import type { ActivityLog } from '../schemas/activity-log.schema'
import { KindScopedActivityLogRepository } from './kind-scoped-activity-log.repository'
import { ActivityLogMemoryRepository } from './activity-log-memory-repository.fixtures'
import { toAiConsultationLog } from './legacy-log.mapper'
import type { AiConsultationLog } from '../../ai/schemas/ai-consultation-log.schema'
import { toBlockchainLog } from './legacy-log.mapper'

describe('KindScopedActivityLogRepository', () => {
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    countBy: jest.fn(),
    update: jest.fn(),
    save: jest.fn(),
  }
  const asRepository = repo as unknown as Repository<ActivityLog>
  const build = (
    kind: 'blockchain' | 'job-run' = 'blockchain'
  ): KindScopedActivityLogRepository<BlockchainLog> =>
    new KindScopedActivityLogRepository(asRepository, kind, toBlockchainLog)

  beforeEach(() => {
    jest.clearAllMocks()
    repo.find.mockResolvedValue([])
    repo.findOne.mockResolvedValue(null)
    repo.countBy.mockResolvedValue(0)
  })

  it('adds the kind to every find/findOne/count where and keeps the caller options', async () => {
    const repository = build()
    await repository.find({
      where: { contractId: 'c-1' },
      order: { createdAt: 'DESC' },
    })
    await repository.findOne({ where: { logId: 'call-1' } })
    await repository.count({ where: {} })

    expect(repo.find).toHaveBeenCalledWith({
      where: { contractId: 'c-1', kind: 'blockchain' },
      order: { createdAt: 'DESC' },
    })
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { logId: 'call-1', kind: 'blockchain' },
    })
    // Mongo `countBy` nhận filter thô: không được bọc trong `{ where }` (sẽ luôn đếm 0).
    expect(repo.countBy).toHaveBeenCalledWith({ kind: 'blockchain' })
  })

  it('cannot be widened or redirected by a caller-supplied kind', async () => {
    const repository = build('job-run')

    await repository.find({ where: { kind: 'http', jobName: 'j' } })

    expect(repo.find).toHaveBeenCalledWith({
      where: { kind: 'job-run', jobName: 'j' },
    })
  })

  it('returns legacy-shaped rows without kind or fields of other kinds', async () => {
    const id = new ObjectId()
    repo.find.mockResolvedValueOnce([
      {
        _id: id,
        kind: 'blockchain',
        txHash: 'sim_1',
        contractId: 'c-1',
        userId: 'u-http-only',
        createdAt: new Date(1),
        updatedAt: new Date(2),
      },
    ])

    const [row] = await build().find({ where: { contractId: 'c-1' } })

    expect(row).toEqual({
      _id: id,
      txHash: 'sim_1',
      contractId: 'c-1',
      createdAt: new Date(1),
    })
    expect(row).not.toHaveProperty('kind')
    expect(row).not.toHaveProperty('updatedAt')
    expect(row).not.toHaveProperty('userId')
  })

  it('stamps the kind on save, persists only defined fields and returns the legacy shape', async () => {
    const repository = build()
    const log = {
      action: 'recordDeposit',
      txHash: 'sim_1',
      contractId: null,
      details: {},
      unusedUndefined: undefined,
    } as unknown as BlockchainLog
    repo.save.mockImplementation((row: Record<string, unknown>) =>
      Promise.resolve({ ...row, _id: new ObjectId(), createdAt: new Date(3) })
    )

    const saved = await repository.save(log)

    expect(repo.save).toHaveBeenCalledWith({
      action: 'recordDeposit',
      txHash: 'sim_1',
      contractId: null,
      details: {},
      kind: 'blockchain',
    })
    const { _id: savedId, ...savedRest } = saved
    expect(savedId).toBeInstanceOf(ObjectId)
    expect(savedRest).toEqual({
      action: 'recordDeposit',
      txHash: 'sim_1',
      contractId: null,
      details: {},
      createdAt: new Date(3),
    })
    expect(saved).not.toHaveProperty('kind')
  })

  it('throws instead of silently overwriting a caller kind that differs from the facade kind', async () => {
    const repository = build()

    await expect(
      repository.save({ txHash: 'a', kind: 'http' } as unknown as BlockchainLog)
    ).rejects.toThrow(
      'activity log kind mismatch: expected blockchain, got http'
    )
    await expect(
      repository.saveAll([
        { txHash: 'b', kind: 'job-run' } as unknown as BlockchainLog,
      ])
    ).rejects.toThrow('activity log kind mismatch')
    expect(repo.save).not.toHaveBeenCalled()
  })

  it('accepts an entity whose kind already equals the facade kind', async () => {
    repo.save.mockImplementation((row: Record<string, unknown>) =>
      Promise.resolve({ ...row, _id: new ObjectId() })
    )

    await build().save({
      txHash: 'a',
      kind: 'blockchain',
    } as unknown as BlockchainLog)

    expect(repo.save).toHaveBeenCalledWith({
      txHash: 'a',
      kind: 'blockchain',
    })
  })

  it('saves many rows at once with the kind stamped on each and returns legacy shapes', async () => {
    repo.save.mockImplementation((rows: Array<Record<string, unknown>>) =>
      Promise.resolve(rows.map(row => ({ ...row, _id: new ObjectId() })))
    )

    const saved = await build().saveAll([
      { txHash: 'a', action: 'x' },
      { txHash: 'b', action: 'y' },
    ])

    expect(repo.save).toHaveBeenCalledWith([
      { txHash: 'a', action: 'x', kind: 'blockchain' },
      { txHash: 'b', action: 'y', kind: 'blockchain' },
    ])
    expect(saved).toHaveLength(2)
    const { _id: secondId, ...secondRest } = saved[1] ?? {}
    expect(secondId).toBeInstanceOf(ObjectId)
    expect(secondRest).toEqual({
      txHash: 'b',
      action: 'y',
    })
  })

  it('updates only inside its own kind', async () => {
    await build().update({ txHash: 'sim_1' }, { status: 'confirmed' })

    expect(repo.update).toHaveBeenCalledWith(
      { txHash: 'sim_1', kind: 'blockchain' },
      { status: 'confirmed' }
    )
  })

  it('creates a legacy-shaped plain object without touching the database', () => {
    const created = build().create({ txHash: 'x', action: 'a' })

    expect(created).toEqual({ txHash: 'x', action: 'a' })
    expect(repo.save).not.toHaveBeenCalled()
  })

  describe('với fake lưu trữ thực thi insert/update', () => {
    it('gán _id sinh khi insert vào object của caller; save lần hai là UPDATE, không tạo document trùng', async () => {
      const store = new ActivityLogMemoryRepository()
      const repository = new KindScopedActivityLogRepository(
        store as unknown as Repository<ActivityLog>,
        'ai-consultation',
        toAiConsultationLog
      )
      const log = {
        logId: 'call-1',
        status: 'pending',
        messages: [],
      } as unknown as AiConsultationLog

      const first = await repository.save(log)
      expect(log._id).toBeInstanceOf(ObjectId)
      expect(log._id).toEqual(first._id)
      expect(log.createdAt).toBeInstanceOf(Date)

      log.status = 'email_sent'
      const second = await repository.save(log)

      expect(store.docs).toHaveLength(1)
      expect(store.docs[0]?.status).toBe('email_sent')
      expect(second._id).toEqual(log._id)
      expect(log).not.toHaveProperty('kind')
      expect(second).not.toHaveProperty('kind')
    })

    it('updateAtomic chỉ khớp và ghi trong cùng kind', async () => {
      const store = new ActivityLogMemoryRepository()
      store.seed({ kind: 'http', logId: 'same', messages: [] })
      store.seed({ kind: 'ai-consultation', logId: 'same', messages: [] })
      const repository = new KindScopedActivityLogRepository(
        store as unknown as Repository<ActivityLog>,
        'ai-consultation',
        toAiConsultationLog
      )

      const matched = await repository.updateAtomic(
        { logId: 'same' },
        { $set: { notes: 'ghi' } }
      )

      expect(matched).toBe(1)
      expect(store.docs[0]).not.toHaveProperty('notes')
      expect(store.docs[1]?.notes).toBe('ghi')
    })
  })
})
