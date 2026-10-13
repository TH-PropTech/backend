import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { getRepositoryToken } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { LedgerAuditQueryService } from './ledger-audit-query.service'
import { BlockchainLog } from '../schemas/blockchain-log.schema'
import { LedgerOutbox } from '../schemas/ledger-outbox.schema'

describe('LedgerAuditQueryService', () => {
  let service: LedgerAuditQueryService
  let logRepo: jest.Mocked<Repository<BlockchainLog>>
  let outboxRepo: jest.Mocked<Repository<LedgerOutbox>>
  let configService: { get: jest.Mock }

  beforeEach(async () => {
    const mockLogRepo = {
      find: jest.fn(),
    }
    const mockOutboxRepo = {
      find: jest.fn(),
    }
    configService = {
      get: jest.fn((key: string) =>
        key === 'fabric.enabled' ? false : undefined
      ),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerAuditQueryService,
        {
          provide: getRepositoryToken(BlockchainLog),
          useValue: mockLogRepo,
        },
        {
          provide: getRepositoryToken(LedgerOutbox),
          useValue: mockOutboxRepo,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    }).compile()

    service = module.get<LedgerAuditQueryService>(LedgerAuditQueryService)
    logRepo = module.get(getRepositoryToken(BlockchainLog))
    outboxRepo = module.get(getRepositoryToken(LedgerOutbox))
  })

  it('should query and project audit events from outbox and blockchain logs', async () => {
    const outboxId = new ObjectId('507f1f77bcf86cd799439011')
    const logId = new ObjectId('507f1f77bcf86cd799439022')

    outboxRepo.find.mockResolvedValue([
      {
        _id: outboxId,
        aggregateType: 'contract',
        aggregateId: 'contract-123',
        eventType: 'contract.activated',
        status: 'pending',
        txHash: null,
        createdAt: new Date('2026-09-14T08:00:00Z'),
        updatedAt: new Date('2026-09-14T08:00:00Z'),
      } as LedgerOutbox,
    ])

    logRepo.find.mockResolvedValue([
      {
        _id: logId,
        contractId: 'contract-123',
        action: 'createContract',
        status: 'confirmed',
        networkMode: 'simulation',
        txHash: '0xabc123',
        blockNumber: 0,
        createdAt: new Date('2026-09-14T07:55:00Z'),
      } as BlockchainLog,
    ])

    const events = await service.getContractEvents('contract-123')

    expect(events).toHaveLength(2)
    expect(events[0]!.id).toBe(`outbox-${outboxId.toString()}`)
    expect(events[0]!.status).toBe('pending')
    expect(events[0]!.category).toBe('ledger')
    expect(events[0]!.blockNumber).toBeNull()

    expect(events[1]!.id).toBe(`log-${logId.toString()}`)
    expect(events[1]!.networkMode).toBe('simulation')
    expect(events[1]!.blockNumber).toBeNull() // block 0 in simulation mapped to null
    expect(events[1]!.description).toContain('Chế độ mô phỏng')
  })

  it('should return empty list if no logs or outbox exist for contract', async () => {
    outboxRepo.find.mockResolvedValue([])
    logRepo.find.mockResolvedValue([])

    const events = await service.getContractEvents('contract-empty')
    expect(events).toEqual([])
  })

  it('projects an outbox event as Fabric when typed configuration enables Fabric', async () => {
    const outboxId = new ObjectId('507f1f77bcf86cd799439033')
    configService.get.mockImplementation((key: string) =>
      key === 'fabric.enabled' ? true : undefined
    )
    outboxRepo.find.mockResolvedValue([
      {
        _id: outboxId,
        aggregateType: 'contract',
        aggregateId: 'contract-fabric',
        eventType: 'contract.activated',
        status: 'pending',
        txHash: null,
        createdAt: new Date('2026-09-14T08:00:00Z'),
        updatedAt: new Date('2026-09-14T08:00:00Z'),
      } as LedgerOutbox,
    ])
    logRepo.find.mockResolvedValue([])

    const events = await service.getContractEvents('contract-fabric')

    expect(events).toHaveLength(1)
    expect(events[0]!.networkMode).toBe('fabric')
  })

  it('marks failed ledger events terminal and describes manual recovery', async () => {
    const outboxId = new ObjectId('507f1f77bcf86cd799439044')
    outboxRepo.find.mockResolvedValue([
      {
        _id: outboxId,
        aggregateType: 'contract',
        aggregateId: 'contract-failed',
        eventType: 'contract.activated',
        status: 'failed',
        errorCode: 'ATTEMPTS_EXHAUSTED',
        txHash: null,
        createdAt: new Date('2026-09-14T08:00:00Z'),
        updatedAt: new Date('2026-09-14T08:00:00Z'),
      } as LedgerOutbox,
    ])
    logRepo.find.mockResolvedValue([])

    const events = await service.getContractEvents('contract-failed')

    expect(events[0]!.retryable).toBe(false)
    expect(events[0]!.description).toContain('retry thủ công')
    expect(events[0]!.description).not.toContain('tự động thử lại')
  })
})
