import { ObjectId } from 'mongodb'
import { LedgerAuditQueryService } from './ledger-audit-query.service'

describe('LedgerAuditQueryService PROP-399 evidence families (task 5.5)', () => {
  function build(
    logs: Array<Record<string, unknown>>,
    outbox: Array<Record<string, unknown>> = []
  ): LedgerAuditQueryService {
    return new LedgerAuditQueryService(
      { find: jest.fn().mockResolvedValue(logs) } as never,
      { find: jest.fn().mockResolvedValue(outbox) } as never,
      { get: jest.fn().mockReturnValue(false) } as never
    )
  }

  function log(
    action: string,
    extra: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      _id: new ObjectId(),
      action,
      eventType: action,
      contractId: 'contract-1',
      networkMode: 'fabric',
      status: 'confirmed',
      txHash: 'tx-real',
      blockNumber: 7,
      createdAt: new Date('2030-01-02T00:00:00.000Z'),
      ...extra,
    }
  }

  it.each([
    ['recordMoveInSettlement', 'payment', /quyết toán/i],
    ['recordHandover', 'contract', /bàn giao/i],
    ['publishGovernanceSnapshot', 'contract', /cấu hình|quản trị/i],
  ])(
    'labels %s with its own category and description (never the generic ledger bucket that drives the contract summary)',
    async (action, category, description) => {
      const events = await build([log(action)]).getContractEvents('contract-1')
      expect(events).toHaveLength(1)
      expect(events[0]?.category).toBe(category)
      expect(events[0]?.description).toMatch(description)
      expect(events[0]?.description).not.toMatch(/Giao dịch .* được ghi nhận/)
    }
  )

  it('keeps authentic Fabric tx/block values but hides block numbers and marks simulation', async () => {
    const [fabricEvent] = await build([
      log('recordHandover'),
    ]).getContractEvents('contract-1')
    expect(fabricEvent).toMatchObject({ txHash: 'tx-real', blockNumber: 7 })

    const [simEvent] = await build([
      log('recordHandover', { networkMode: 'simulation', blockNumber: 7 }),
    ]).getContractEvents('contract-1')
    expect(simEvent?.blockNumber).toBeNull()
    expect(simEvent?.networkMode).toBe('simulation')
    expect(simEvent?.description).toContain('Chế độ mô phỏng')
  })

  it('describes outbox items that wait for a prerequisite or a chaincode upgrade', async () => {
    const outbox = (errorCode: string): Record<string, unknown> => ({
      _id: new ObjectId(),
      aggregateType: 'contract',
      aggregateId: 'contract-1',
      eventType: 'contract.activated',
      status: 'pending',
      txHash: null,
      networkMode: null,
      blockNumber: null,
      errorCode,
      createdAt: new Date('2030-01-01T00:00:00.000Z'),
      updatedAt: new Date('2030-01-01T00:00:00.000Z'),
    })
    const [waiting] = await build(
      [],
      [outbox('DEPENDENCY_PENDING')]
    ).getContractEvents('contract-1')
    expect(waiting?.description).toMatch(/tiền đề/i)
    const [upgrade] = await build(
      [],
      [outbox('CHAINCODE_UPGRADE_REQUIRED')]
    ).getContractEvents('contract-1')
    expect(upgrade?.description).toMatch(/nâng cấp/i)
  })
})
