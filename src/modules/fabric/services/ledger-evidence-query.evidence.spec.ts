import { ObjectId } from 'mongodb'
import { LedgerEvidenceQueryService } from './ledger-evidence-query.service'
import type { LedgerOutbox } from '../schemas/ledger-outbox.schema'

describe('LedgerEvidenceQueryService PROP-399 evidence families (task 5.5)', () => {
  const settlementId = new ObjectId().toHexString()
  const snapshotId = new ObjectId().toHexString()
  const HASH = 'b'.repeat(64)

  function build(mode: 'fabric' | 'simulation' = 'fabric'): {
    service: LedgerEvidenceQueryService
    outboxRepository: { find: jest.Mock }
    logRepository: { find: jest.Mock }
  } {
    const outboxRepository = { find: jest.fn().mockResolvedValue([]) }
    const logRepository = { find: jest.fn().mockResolvedValue([]) }
    const service = new LedgerEvidenceQueryService(
      logRepository as never,
      outboxRepository as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {
        getStatus: jest.fn().mockReturnValue({
          mode,
          connectionState: mode === 'fabric' ? 'connected' : 'disabled',
          ready: true,
        }),
      } as never,
      { get: jest.fn().mockReturnValue(undefined) } as never
    )
    return { service, outboxRepository, logRepository }
  }

  function outbox(
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    extra: Partial<LedgerOutbox> = {}
  ): LedgerOutbox {
    return {
      _id: new ObjectId(),
      aggregateType,
      aggregateId,
      eventType,
      status: 'confirmed',
      txHash: 'tx-real',
      networkMode: 'fabric',
      blockNumber: 12,
      confirmedAt: new Date('2030-01-02T00:00:00.000Z'),
      payloadHash: HASH,
      payload: { action: 'x', args: ['SECRET-ARG'] },
      attempts: 1,
      dependencyKey: null,
      errorCode: null,
      ...extra,
    } as unknown as LedgerOutbox
  }

  it('also queries the settlement, handover and governance aggregates the contract references', async () => {
    const { service, outboxRepository } = build()
    await service.getContractLedgerEvidence('contract-1', {
      depositAgreementId: undefined,
      settlementId,
      governanceSnapshotRef: {
        snapshotId,
        version: 2,
        manifestHash: HASH,
      },
    } as never)

    const queried = outboxRepository.find.mock.calls.map(
      ([query]: [{ where: { aggregateType: string; aggregateId: string } }]) =>
        `${query.where.aggregateType}:${query.where.aggregateId}`
    )
    expect(queried).toEqual(
      expect.arrayContaining([
        `move-in-settlement:${settlementId}`,
        `move-in-handover:${settlementId}`,
        `governance-snapshot:${snapshotId}`,
      ])
    )
  })

  it('maps the new families to sanitized participant events (no args, short refs, hash only)', async () => {
    const { service, outboxRepository } = build()
    outboxRepository.find.mockImplementation(
      ({ where }: { where: { aggregateType: string } }) =>
        Promise.resolve(
          where.aggregateType === 'move-in-settlement'
            ? [outbox('move-in-settlement', settlementId, 'move-in.settled')]
            : where.aggregateType === 'move-in-handover'
              ? [outbox('move-in-handover', settlementId, 'handover.completed')]
              : where.aggregateType === 'governance-snapshot'
                ? [
                    outbox(
                      'governance-snapshot',
                      snapshotId,
                      'governance.published'
                    ),
                  ]
                : []
        )
    )

    const evidence = await service.getContractLedgerEvidence('contract-1', {
      settlementId,
      governanceSnapshotRef: { snapshotId, version: 1, manifestHash: HASH },
    })

    expect(
      evidence.events.map(event => `${event.aggregateType}/${event.eventType}`)
    ).toEqual(
      expect.arrayContaining([
        'move-in-settlement/move-in.settled',
        'move-in-handover/handover.completed',
        'governance-snapshot/governance.published',
      ])
    )
    const settled = evidence.events.find(
      event => event.eventType === 'move-in.settled'
    )
    expect(settled).toMatchObject({
      status: 'confirmed',
      txId: 'tx-real',
      blockNumber: 12,
      payloadHash: HASH,
      aggregateRef: settlementId.slice(-6),
    })
    expect(JSON.stringify(evidence)).not.toContain('SECRET-ARG')
    expect(JSON.stringify(evidence)).not.toContain(settlementId)
  })

  it('never reports a block number for simulation and maps terminal failures', async () => {
    const { service, outboxRepository } = build('simulation')
    outboxRepository.find.mockImplementation(
      ({ where }: { where: { aggregateType: string } }) =>
        Promise.resolve(
          where.aggregateType === 'move-in-handover'
            ? [
                outbox('move-in-handover', settlementId, 'handover.completed', {
                  status: 'failed',
                  networkMode: 'simulation',
                  blockNumber: 99,
                  errorCode: 'TERMINAL_CONFLICT',
                }),
              ]
            : []
        )
    )
    const evidence = await service.getContractLedgerEvidence('contract-1', {
      settlementId,
    })
    const event = evidence.events.find(
      e => e.aggregateType === 'move-in-handover'
    )
    expect(event).toMatchObject({
      status: 'failed-terminal',
      networkMode: 'simulation',
      blockNumber: null,
      errorCode: 'TERMINAL_CONFLICT',
      explorerUrl: null,
    })
  })

  it('shows every parent of a multi-parent activation in dependsOn (refs shortened)', async () => {
    const { service, outboxRepository } = build()
    outboxRepository.find.mockImplementation(
      ({ where }: { where: { aggregateType: string } }) =>
        Promise.resolve(
          where.aggregateType === 'contract'
            ? [
                outbox('contract', 'contract-1', 'contract.activated', {
                  dependencyKey: 'deposit:abcdef123456:deposit.paid',
                  dependencyKeys: [
                    'deposit:abcdef123456:deposit.paid',
                    `governance-snapshot:${snapshotId}:governance.published`,
                  ],
                }),
              ]
            : []
        )
    )
    const evidence = await service.getContractLedgerEvidence('contract-1', {
      depositAgreementId: undefined,
    } as never)
    const activation = evidence.events.find(
      event => event.eventType === 'contract.activated'
    )
    expect(activation?.dependsOn).toBe(
      `deposit:123456:deposit.paid,governance-snapshot:${snapshotId.slice(-6)}:governance.published`
    )
  })

  it('maps blockchain logs of the new families by their reference fields', async () => {
    const { service, logRepository } = build()
    logRepository.find.mockImplementation(
      ({ where }: { where: Record<string, string> }) =>
        Promise.resolve(
          where.contractId === 'contract-1'
            ? [
                {
                  _id: new ObjectId(),
                  action: 'recordHandover',
                  eventType: 'recordHandover',
                  contractId: 'contract-1',
                  settlementId,
                  handoverRevision: 1,
                  payloadHash: HASH,
                  networkMode: 'fabric',
                  status: 'confirmed',
                  txHash: 'tx-real',
                  blockNumber: 8,
                  details: { args: ['SECRET-ARG'] },
                  createdAt: new Date('2030-01-03T00:00:00.000Z'),
                },
              ]
            : []
        )
    )
    const evidence = await service.getContractLedgerEvidence('contract-1', {
      settlementId,
    })
    expect(evidence.events[0]).toMatchObject({
      aggregateType: 'move-in-handover',
      payloadHash: HASH,
      blockNumber: 8,
    })
    expect(JSON.stringify(evidence)).not.toContain('SECRET-ARG')
  })

  it('does not issue extra queries for a legacy contract without settlement or governance references', async () => {
    const { service, outboxRepository } = build()
    await service.getContractLedgerEvidence('contract-1', {
      depositAgreementId: undefined,
    } as never)
    expect(outboxRepository.find).toHaveBeenCalledTimes(1)
  })
})
