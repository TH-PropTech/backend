import { ObjectId } from 'mongodb'
import { LedgerEvidenceQueryService } from './ledger-evidence-query.service'
import { LedgerOutbox } from '../schemas/ledger-outbox.schema'

describe('LedgerEvidenceQueryService', () => {
  let service: LedgerEvidenceQueryService
  let logRepository: { find: jest.Mock }
  let outboxRepository: { find: jest.Mock }
  let depositAgreementRepository: { findOne: jest.Mock }
  let paymentRepository: { find: jest.Mock }
  let amendmentRepository: { find: jest.Mock }
  let fabricService: { getStatus: jest.Mock }
  let configService: { get: jest.Mock }

  beforeEach(() => {
    logRepository = { find: jest.fn().mockResolvedValue([]) }
    outboxRepository = { find: jest.fn().mockResolvedValue([]) }
    depositAgreementRepository = { findOne: jest.fn().mockResolvedValue(null) }
    paymentRepository = { find: jest.fn().mockResolvedValue([]) }
    amendmentRepository = { find: jest.fn().mockResolvedValue([]) }
    fabricService = {
      getStatus: jest.fn().mockReturnValue({
        mode: 'simulation',
        connectionState: 'disabled',
        ready: true,
      }),
    }
    configService = { get: jest.fn().mockReturnValue(undefined) }

    service = new LedgerEvidenceQueryService(
      logRepository as never,
      outboxRepository as never,
      depositAgreementRepository as never,
      paymentRepository as never,
      amendmentRepository as never,
      fabricService as never,
      configService as never
    )
  })

  describe('signing provider', () => {
    const activation = (providers: Array<string | undefined>): unknown => ({
      _id: new ObjectId(),
      aggregateType: 'contract',
      aggregateId: 'contract-123456',
      eventType: 'contract.activated',
      status: 'confirmed',
      attempts: 1,
      payloadHash: 'a'.repeat(64),
      payload: {
        action: 'createContract',
        args: ['PII-ARG'],
        metadata: {
          details: {
            evidenceEnvelope: {
              signatures: {
                tenant: { provider: providers[0] },
                landlord: { provider: providers[1] },
              },
            },
          },
        },
      },
    })

    async function signingProviderFor(
      events: unknown[]
    ): Promise<string | null> {
      outboxRepository.find.mockImplementation(
        ({ where }: { where: Record<string, string> }) =>
          Promise.resolve(where.aggregateType === 'contract' ? events : [])
      )
      const evidence = await service.getContractLedgerEvidence(
        'contract-123456',
        {}
      )
      return evidence.signingProvider
    }

    it('flags a contract signed through the dev-test path', async () => {
      await expect(
        signingProviderFor([activation(['dev-test', 'dev-test'])])
      ).resolves.toBe('dev-test')
    })

    it('reports smartca when both parties signed with SmartCA', async () => {
      await expect(
        signingProviderFor([activation(['smartca', 'smartca'])])
      ).resolves.toBe('smartca')
    })

    it('reports no provider before activation or for a contract anchored before ABI 3', async () => {
      await expect(signingProviderFor([])).resolves.toBeNull()
      await expect(
        signingProviderFor([activation([undefined, undefined])])
      ).resolves.toBeNull()
    })
  })

  it('aggregates contract, deposit, payment and amendment events without exposing payload args or PII', async () => {
    const depositId = new ObjectId()
    const paymentId = new ObjectId()
    const amendmentId = new ObjectId()
    const outboxId = new ObjectId()
    const logId = new ObjectId()
    const payloadHash = 'a'.repeat(64)

    paymentRepository.find.mockResolvedValue([{ _id: paymentId }])
    amendmentRepository.find.mockResolvedValue([{ _id: amendmentId }])
    depositAgreementRepository.findOne.mockResolvedValue({ _id: depositId })
    outboxRepository.find.mockImplementation(
      ({ where }: { where: Record<string, string> }) => {
        if (where.aggregateType === 'contract') {
          return Promise.resolve([
            {
              _id: outboxId,
              aggregateType: 'contract',
              aggregateId: 'contract-123456',
              eventType: 'contract.activated',
              status: 'confirmed',
              txHash: 'sim_tx_1',
              networkMode: 'simulation',
              blockNumber: null,
              confirmedAt: new Date('2026-09-14T10:00:00Z'),
              payloadHash,
              payload: { args: ['secret-cccd'] },
              attempts: 1,
              dependencyKey: null,
              errorCode: null,
            } as LedgerOutbox,
          ])
        }
        return Promise.resolve([])
      }
    )
    logRepository.find.mockImplementation(
      ({ where }: { where: Record<string, string> }) => {
        if (where.contractId === 'contract-123456') {
          return Promise.resolve([
            {
              _id: logId,
              action: 'createContract',
              eventType: 'createContract',
              contractId: 'contract-123456',
              paymentId: null,
              depositId: null,
              networkMode: 'simulation',
              status: 'confirmed',
              txHash: 'sim_tx_1',
              blockNumber: null,
              network: 'Simulation (Offline)',
              details: { args: ['secret-cccd'], contractHash: payloadHash },
              createdAt: new Date('2026-09-14T09:00:00Z'),
            },
          ])
        }
        return Promise.resolve([])
      }
    )

    const evidence = await service.getContractLedgerEvidence(
      'contract-123456',
      { depositAgreementId: depositId.toHexString() }
    )

    expect(evidence.networkMode).toBe('simulation')
    expect(evidence.explorerAvailable).toBe(false)
    expect(evidence.events).toHaveLength(2)
    expect(evidence.events[0]!.aggregateRef).toBe('123456')
    expect(evidence.events[0]!.payloadHash).toBe(payloadHash)
    expect(evidence.events.every(event => event.explorerUrl === null)).toBe(
      true
    )
    expect(JSON.stringify(evidence)).not.toContain('secret-cccd')
    expect(JSON.stringify(evidence)).not.toContain('args')
  })

  it('builds an explorer URL only for a Fabric transaction with a configured template', async () => {
    const outboxId = new ObjectId()
    fabricService.getStatus.mockReturnValue({
      mode: 'fabric',
      connectionState: 'connected',
      ready: true,
    })
    configService.get.mockReturnValue('https://explorer.test/tx/{txId}')
    outboxRepository.find.mockImplementation(
      ({ where }: { where: Record<string, string> }) =>
        where.aggregateType === 'contract'
          ? Promise.resolve([
              {
                _id: outboxId,
                aggregateType: 'contract',
                aggregateId: 'contract-123456',
                eventType: 'contract.activated',
                status: 'confirmed',
                txHash: 'fabric/tx 1',
                networkMode: 'fabric',
                blockNumber: 18,
                confirmedAt: new Date('2026-09-14T10:00:00Z'),
                payloadHash: 'b'.repeat(64),
                attempts: 1,
                dependencyKey: null,
                errorCode: null,
              } as LedgerOutbox,
            ])
          : Promise.resolve([])
    )

    const evidence = await service.getContractLedgerEvidence(
      'contract-123456',
      { depositAgreementId: null }
    )

    expect(evidence.explorerAvailable).toBe(true)
    expect(evidence.events[0]!.explorerUrl).toBe(
      'https://explorer.test/tx/fabric%2Ftx%201'
    )
    expect(evidence.events[0]!.blockNumber).toBe(18)
  })
})
