import { vi } from 'vitest'
import { connect } from '@hyperledger/fabric-gateway'
import { FabricService } from './fabric.service'
import { BlockchainLog } from '../schemas/blockchain-log.schema'

vi.mock('@hyperledger/fabric-gateway', () => ({
  connect: jest.fn(),
  signers: {
    newPrivateKeySigner: jest.fn(() => ({})),
  },
}))

vi.mock('@grpc/grpc-js', () => ({
  Client: jest.fn(() => ({
    close: jest.fn(),
  })),
  credentials: {
    createSsl: jest.fn(),
  },
}))

vi.mock('crypto', async () => {
  const actualCrypto = await vi.importActual<typeof import('crypto')>('crypto')
  return {
    ...actualCrypto,
    createPrivateKey: jest.fn(() => ({})),
  }
})

vi.mock('fs', async () => {
  const actualFs = await vi.importActual<typeof import('fs')>('fs')
  const { TEST_IDENTITY_CERT_PEM } = await vi.importActual<
    typeof import('../utils/fabric-identity.fixtures')
  >('../utils/fabric-identity.fixtures')
  return {
    ...actualFs,
    readFileSync: jest.fn((p: string) =>
      // PROP-399 D5: identity phải là chứng chỉ X.509 hợp lệ (hạn 2126) mới được dùng để dựng gateway.
      /cert.pem$/.test(p)
        ? Buffer.from(TEST_IDENTITY_CERT_PEM)
        : Buffer.from('mock-file-content:' + p)
    ),
    existsSync: jest.fn(() => true),
    statSync: jest.fn(() => ({ isDirectory: (): boolean => false })),
    readdirSync: jest.fn(() => ['test_sk']),
  }
})

const mockConnect = connect as jest.Mock

describe('FabricService', () => {
  let logRepository: {
    save: jest.Mock
    find: jest.Mock
  }
  let configService: {
    get: jest.Mock
    getOrThrow: jest.Mock
  }

  // Mỗi service khởi tạo bật một interval readiness; phải dừng sau mỗi test để timer
  // không chạy sau khi môi trường Jest bị teardown (ReferenceError → exit code 1 trên CI).
  let initSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    initSpy = jest.spyOn(FabricService.prototype, 'onModuleInit')
    logRepository = {
      save: jest.fn(entity => Promise.resolve({ ...entity, _id: 'log-1' })),
      find: jest.fn().mockResolvedValue([]),
    }
    configService = {
      get: jest.fn(),
      getOrThrow: jest.fn(),
    }
  })

  afterEach(() => {
    const started = initSpy.mock.contexts as FabricService[]
    initSpy.mockRestore()
    for (const service of started) service.onModuleDestroy()
  })

  function setupValidConfig(): void {
    configService.get.mockImplementation((key: string) => {
      if (key === 'fabric.enabled') return true
      return undefined
    })
    configService.getOrThrow.mockImplementation((key: string) => {
      const map: Record<string, string> = {
        FABRIC_MSP_ID: 'Org1MSP',
        FABRIC_CHANNEL_NAME: 'proptech-channel',
        FABRIC_CHAINCODE_NAME: 'proptech',
        FABRIC_CERT_PATH: 'cert.pem',
        FABRIC_KEY_PATH: 'key.pem',
        FABRIC_TLS_CERT_PATH: 'tls.crt',
        FABRIC_PEER_ENDPOINT: 'localhost:7051',
        FABRIC_PEER_HOST_ALIAS: 'peer0.org1.example.com',
      }
      if (map[key]) return map[key]
      throw new Error(`Missing config ${key}`)
    })
  }

  describe('1. simulation / disabled mode', () => {
    it('initializes in simulation mode when Fabric is disabled in typed configuration', async () => {
      configService.get.mockImplementation((key: string) =>
        key === 'fabric.enabled' ? false : undefined
      )
      const service = new FabricService(
        logRepository as never,
        configService as never
      )

      await service.onModuleInit()
      const status = service.getStatus()

      expect(status.mode).toBe('simulation')
      expect(status.connectionState).toBe('disabled')
      expect(status.ready).toBe(true)
      expect(status.errorCode).toBeNull()
    })

    it('submits simulated transaction with sim_ prefix and nullable blockNumber', async () => {
      configService.get.mockImplementation((key: string) =>
        key === 'fabric.enabled' ? false : undefined
      )
      const service = new FabricService(
        logRepository as never,
        configService as never
      )
      await service.onModuleInit()

      const result = await service.submitTransaction(
        'recordDeposit',
        ['dep-1', 'hash-1'],
        {
          contractId: 'c-1',
        }
      )

      expect(result.success).toBe(true)
      expect(result.networkMode).toBe('simulation')
      expect(result.txHash).toMatch(/^sim_[a-f0-9]{64}$/)
      expect(result.blockNumber).toBeNull()
      expect(logRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'blockchain',
          action: 'recordDeposit',
          networkMode: 'simulation',
          blockNumber: null,
          status: 'confirmed',
        })
      )
    })

    it('fills the PROP-399 blockchain-log reference fields from submit metadata (simulation)', async () => {
      configService.get.mockImplementation((key: string) =>
        key === 'fabric.enabled' ? false : undefined
      )
      const service = new FabricService(
        logRepository as never,
        configService as never
      )
      await service.onModuleInit()

      await service.submitTransaction('recordHandover', ['s-1'], {
        contractId: 'c-1',
        settlementId: 's-1',
        handoverRevision: 2,
        schemaVersion: 1,
        payloadHash: 'a'.repeat(64),
      })
      await service.submitTransaction('publishGovernanceSnapshot', ['g-1'], {
        governanceSnapshotId: 'g-1',
        schemaVersion: 1,
        payloadHash: 'b'.repeat(64),
      })

      expect(logRepository.save).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          contractId: 'c-1',
          settlementId: 's-1',
          handoverRevision: 2,
          schemaVersion: 1,
          payloadHash: 'a'.repeat(64),
          governanceSnapshotId: null,
        })
      )
      expect(logRepository.save).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          governanceSnapshotId: 'g-1',
          settlementId: null,
          handoverRevision: null,
          payloadHash: 'b'.repeat(64),
        })
      )
    })

    it('rebuilds read and verify results from persisted simulation logs after restart', async () => {
      configService.get.mockImplementation((key: string) =>
        key === 'fabric.enabled' ? false : undefined
      )
      const contractHash = 'a'.repeat(64)
      const writer = new FabricService(
        logRepository as never,
        configService as never
      )
      await writer.onModuleInit()
      await writer.submitTransaction('createContract', ['c-1'], {
        contractId: 'c-1',
        details: { contractHash },
      })

      const persistedLog = Object.assign(new BlockchainLog(), {
        action: 'createContract',
        contractId: 'c-1',
        paymentId: null,
        txHash: 'sim_persisted',
        blockNumber: null,
        network: 'Simulation (Offline)',
        networkMode: 'simulation' as const,
        status: 'confirmed' as const,
        details: { contractHash },
      })
      logRepository.find.mockResolvedValue([persistedLog])
      const reader = new FabricService(
        logRepository as never,
        configService as never
      )
      await reader.onModuleInit()

      await expect(
        reader.evaluateTransaction('readContract', ['c-1'])
      ).resolves.toEqual(
        expect.objectContaining({
          contractId: 'c-1',
          contractHash,
          networkMode: 'simulation',
        })
      )
      await expect(
        reader.evaluateTransaction('verifyContract', ['c-1', contractHash])
      ).resolves.toEqual(
        expect.objectContaining({ valid: true, isValid: true })
      )
      await expect(
        reader.evaluateTransaction('verifyContract', ['c-1', 'b'.repeat(64)])
      ).resolves.toEqual(
        expect.objectContaining({ valid: false, isValid: false })
      )
      // Trạng thái mô phỏng chỉ đọc loại 'blockchain' của activity_logs.
      expect(logRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { contractId: 'c-1', kind: 'blockchain' },
        })
      )
    })
  })

  describe('2. fabric / connected mode', () => {
    it('connects to gateway and evaluates healthcheck on init', async () => {
      setupValidConfig()
      const evaluateTransaction = jest
        .fn()
        .mockResolvedValue(Buffer.from(JSON.stringify({ abiVersion: 2 })))
      const getContract = jest.fn().mockReturnValue({ evaluateTransaction })
      const getNetwork = jest.fn().mockReturnValue({ getContract })
      const mockGateway = {
        getNetwork,
        close: jest.fn(),
      }
      mockConnect.mockReturnValue(mockGateway)

      const service = new FabricService(
        logRepository as never,
        configService as never
      )
      await service.onModuleInit()

      const status = service.getStatus()
      expect(status.mode).toBe('fabric')
      expect(status.connectionState).toBe('connected')
      expect(status.ready).toBe(true)
      expect(status.channel).toBe('proptech-channel')
      expect(status.chaincode).toBe('proptech')
      expect(status.chaincodeAbiVersion).toBe(2)
      expect(evaluateTransaction).toHaveBeenCalledWith('getChaincodeInfo')
    })

    it('reads chaincode ABI version 3 and falls back to 2 for unknown versions', async () => {
      for (const [advertised, expected] of [
        [3, 3],
        [1, 1],
        [4, 2],
      ] as const) {
        setupValidConfig()
        const evaluateTransaction = jest
          .fn()
          .mockResolvedValue(
            Buffer.from(JSON.stringify({ abiVersion: advertised }))
          )
        const getContract = jest.fn().mockReturnValue({ evaluateTransaction })
        const getNetwork = jest.fn().mockReturnValue({ getContract })
        mockConnect.mockReturnValue({ getNetwork, close: jest.fn() })

        const service = new FabricService(
          logRepository as never,
          configService as never
        )
        await service.onModuleInit()

        expect(service.getChaincodeAbiVersion()).toBe(expected)
        expect(service.getStatus().chaincodeAbiVersion).toBe(expected)
      }
    })

    it('reports FABRIC_CHAINCODE_INCOMPATIBLE when the deployed chaincode lacks getChaincodeInfo, without scanning the ledger (PROP-399 6.5)', async () => {
      setupValidConfig()
      const evaluateTransaction = jest
        .fn()
        .mockRejectedValue(
          new Error('function getChaincodeInfo does not exist')
        )
      const getContract = jest.fn().mockReturnValue({ evaluateTransaction })
      const getNetwork = jest.fn().mockReturnValue({ getContract })
      const close = jest.fn()
      mockConnect.mockReturnValue({ getNetwork, close })

      const service = new FabricService(
        logRepository as never,
        configService as never
      )
      await service.onModuleInit()

      expect(service.getStatus()).toEqual(
        expect.objectContaining({
          ready: false,
          connectionState: 'unavailable',
          errorCode: 'FABRIC_CHAINCODE_INCOMPATIBLE',
        })
      )
      expect(evaluateTransaction).toHaveBeenCalledWith('getChaincodeInfo')
      expect(evaluateTransaction).not.toHaveBeenCalledWith('getAllContracts')
      expect(close).toHaveBeenCalled()
    })

    describe('supportsEvidenceSchemaVersion (PROP-399 D2 capability)', () => {
      async function connectWith(info: Buffer | Error): Promise<FabricService> {
        setupValidConfig()
        const evaluateTransaction =
          info instanceof Error
            ? jest
                .fn()
                .mockRejectedValueOnce(info)
                .mockResolvedValueOnce(Buffer.from('[]'))
            : jest.fn().mockResolvedValue(info)
        const getContract = jest.fn().mockReturnValue({ evaluateTransaction })
        mockConnect.mockReturnValue({
          getNetwork: jest.fn().mockReturnValue({ getContract }),
          close: jest.fn(),
        })
        const service = new FabricService(
          logRepository as never,
          configService as never
        )
        await service.onModuleInit()
        return service
      }

      it('is true for every version in simulation mode (no chaincode to upgrade)', async () => {
        configService.get.mockImplementation((key: string) =>
          key === 'fabric.enabled' ? false : undefined
        )
        const service = new FabricService(
          logRepository as never,
          configService as never
        )
        await service.onModuleInit()
        expect(service.supportsEvidenceSchemaVersion(3)).toBe(true)
      })

      it('reads evidenceSchemaVersions advertised by getChaincodeInfo', async () => {
        const service = await connectWith(
          Buffer.from(
            JSON.stringify({ abiVersion: 2, evidenceSchemaVersions: [2, 3] })
          )
        )
        expect(service.supportsEvidenceSchemaVersion(2)).toBe(true)
        expect(service.supportsEvidenceSchemaVersion(3)).toBe(true)
        expect(service.supportsEvidenceSchemaVersion(4)).toBe(false)
      })

      it('assumes only v2 when the chaincode info does not advertise versions', async () => {
        const service = await connectWith(
          Buffer.from(JSON.stringify({ abiVersion: 2 }))
        )
        expect(service.supportsEvidenceSchemaVersion(2)).toBe(true)
        expect(service.supportsEvidenceSchemaVersion(3)).toBe(false)
      })

      it('assumes only v2 for an ABI v1 chaincode without getChaincodeInfo', async () => {
        const service = await connectWith(
          new Error('function getChaincodeInfo does not exist')
        )
        expect(service.supportsEvidenceSchemaVersion(3)).toBe(false)
      })

      it('ignores malformed advertised versions', async () => {
        const service = await connectWith(
          Buffer.from(
            JSON.stringify({
              abiVersion: 2,
              evidenceSchemaVersions: [3, 'x', -1, 1.5, null],
            })
          )
        )
        expect(service.supportsEvidenceSchemaVersion(3)).toBe(true)
        expect(service.supportsEvidenceSchemaVersion(2)).toBe(false)
      })
    })

    it('submits transaction and returns authentic txId from chaincode response', async () => {
      setupValidConfig()
      const submitTransaction = jest.fn().mockResolvedValue({
        getTransactionId: () => 'fabric-tx-999',
        getResult: () => Buffer.from(JSON.stringify({ note: 'ok' })),
        getStatus: () =>
          Promise.resolve({
            successful: true,
            code: 0,
            blockNumber: 77n,
            transactionId: 'fabric-tx-999',
          }),
      })
      const evaluateTransaction = jest.fn().mockResolvedValue(Buffer.from('[]'))
      const getContract = jest.fn().mockReturnValue({
        submitAsync: submitTransaction,
        evaluateTransaction,
      })
      const getNetwork = jest.fn().mockReturnValue({ getContract })
      const mockGateway = {
        getNetwork,
        close: jest.fn(),
      }
      mockConnect.mockReturnValue(mockGateway)

      const service = new FabricService(
        logRepository as never,
        configService as never
      )
      await service.onModuleInit()

      const result = await service.submitTransaction('createContract', [
        'c-1',
        'hash-1',
      ])
      expect(result.success).toBe(true)
      expect(result.networkMode).toBe('fabric')
      expect(result.txHash).toBe('fabric-tx-999')
      expect(result.blockNumber).toBe(77)
      expect(submitTransaction).toHaveBeenCalledWith('createContract', {
        arguments: ['c-1', 'hash-1'],
      })
      expect(logRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          txHash: 'fabric-tx-999',
          blockNumber: 77,
          networkMode: 'fabric',
          status: 'confirmed',
        })
      )
    })
  })

  describe('2b. PROP-399 log reference fields (fabric)', () => {
    it('fills the reference fields on a live Fabric log and ignores malformed metadata values', async () => {
      setupValidConfig()
      const submitTransaction = jest.fn().mockResolvedValue({
        getTransactionId: () => 'fabric-tx-7',
        getResult: () => Buffer.from('{}'),
        getStatus: () =>
          Promise.resolve({
            successful: true,
            code: 0,
            blockNumber: 5n,
            transactionId: 'fabric-tx-7',
          }),
      })
      const evaluateTransaction = jest.fn().mockResolvedValue(Buffer.from('[]'))
      const getContract = jest.fn().mockReturnValue({
        submitAsync: submitTransaction,
        evaluateTransaction,
      })
      mockConnect.mockReturnValue({
        getNetwork: jest.fn().mockReturnValue({ getContract }),
        close: jest.fn(),
      })
      const service = new FabricService(
        logRepository as never,
        configService as never
      )
      await service.onModuleInit()

      await service.submitTransaction('recordMoveInSettlement', ['s-1'], {
        contractId: 'c-1',
        settlementId: 's-1',
        schemaVersion: 1,
        payloadHash: 'not-a-hash',
        handoverRevision: 'x',
      } as never)

      expect(logRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          settlementId: 's-1',
          schemaVersion: 1,
          payloadHash: null,
          handoverRevision: null,
          txHash: 'fabric-tx-7',
        })
      )
    })
  })

  describe('3. fabric / unavailable mode', () => {
    it('sets state to unavailable and does NOT fall back to simulation when gateway fails', async () => {
      setupValidConfig()
      mockConnect.mockImplementation(() => {
        throw new Error('Connection refused 127.0.0.1:7051')
      })

      const service = new FabricService(
        logRepository as never,
        configService as never
      )
      await service.onModuleInit()

      const status = service.getStatus()
      expect(status.mode).toBe('fabric')
      expect(status.connectionState).toBe('unavailable')
      expect(status.ready).toBe(false)
      expect(status.errorCode).toBe('FABRIC_TUNNEL_UNREACHABLE')

      // Must reject submission instead of creating fake sim_* evidence!
      await expect(
        service.submitTransaction('createContract', ['c-1'])
      ).rejects.toThrow(/FABRIC_GATEWAY_UNAVAILABLE/)
      expect(logRepository.save).not.toHaveBeenCalled()
    })

    it('sets sanitized errorCode FABRIC_CONFIG_MISSING when configuration is incomplete', async () => {
      configService.get.mockImplementation((key: string) =>
        key === 'fabric.enabled' ? true : undefined
      )
      configService.getOrThrow.mockImplementation(() => {
        throw new Error('FABRIC_MSP_ID is missing')
      })

      const service = new FabricService(
        logRepository as never,
        configService as never
      )
      await service.onModuleInit()

      const status = service.getStatus()
      expect(status.mode).toBe('fabric')
      expect(status.connectionState).toBe('unavailable')
      expect(status.ready).toBe(false)
      expect(status.errorCode).toBe('FABRIC_CONFIG_MISSING')
    })

    it('successfully reconnects when peer/tunnel becomes reachable without service restart', async () => {
      setupValidConfig()
      // Initial startup fails
      mockConnect.mockImplementationOnce(() => {
        throw new Error('Connection refused 127.0.0.1:7051')
      })

      const service = new FabricService(
        logRepository as never,
        configService as never
      )
      await service.onModuleInit()
      expect(service.getStatus().connectionState).toBe('unavailable')

      // Peer becomes healthy
      const mockContract = {
        evaluateTransaction: jest.fn().mockResolvedValue(Buffer.from('[]')),
      }
      const mockNetwork = {
        getContract: jest.fn(() => mockContract),
      }
      const mockGateway = {
        getNetwork: jest.fn(() => mockNetwork),
        close: jest.fn(),
      }
      mockConnect.mockReturnValueOnce(mockGateway)

      // Reset cooldown and attempt reconnect
      service['lastReconnectAttempt'] = 0

      const reconnected = await service.tryReconnect()
      expect(reconnected).toBe(true)
      expect(service.getStatus().connectionState).toBe('connected')
      expect(service.getStatus().ready).toBe(true)
    })

    it('performs single-flight reconnect so concurrent attempts share one promise', async () => {
      setupValidConfig()
      mockConnect.mockImplementationOnce(() => {
        throw new Error('Connection refused 127.0.0.1:7051')
      })

      const service = new FabricService(
        logRepository as never,
        configService as never
      )
      await service.onModuleInit()

      // Reset cooldown and attempt reconnect
      service['lastReconnectAttempt'] = 0

      const mockContract = {
        evaluateTransaction: jest.fn().mockResolvedValue(Buffer.from('[]')),
      }
      const mockNetwork = {
        getContract: jest.fn(() => mockContract),
      }
      const mockGateway = {
        getNetwork: jest.fn(() => mockNetwork),
        close: jest.fn(),
      }
      mockConnect.mockReturnValue(mockGateway)

      // Call tryReconnect concurrently
      const [res1, res2] = await Promise.all([
        service.tryReconnect(),
        service.tryReconnect(),
      ])

      expect(res1).toBe(true)
      expect(res2).toBe(true)
      // mockConnect was called on init (1) + only once during concurrent reconnect (2)
      expect(mockConnect).toHaveBeenCalledTimes(2)
    })
  })
})
