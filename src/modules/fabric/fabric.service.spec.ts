import { connect } from '@hyperledger/fabric-gateway'
import { FabricService } from './fabric.service'

jest.mock('@hyperledger/fabric-gateway', () => ({
  connect: jest.fn(),
  signers: {
    newPrivateKeySigner: jest.fn(() => ({})),
  },
}))

jest.mock('@grpc/grpc-js', () => ({
  Client: jest.fn(() => ({
    close: jest.fn(),
  })),
  credentials: {
    createSsl: jest.fn(),
  },
}))

jest.mock('crypto', () => {
  const actualCrypto = jest.requireActual<typeof import('crypto')>('crypto')
  return {
    ...actualCrypto,
    createPrivateKey: jest.fn(() => ({})),
  }
})

jest.mock('fs', () => {
  const actualFs = jest.requireActual<typeof import('fs')>('fs')
  return {
    ...actualFs,
    readFileSync: jest.fn((p: string) => Buffer.from('mock-file-content:' + p)),
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

  beforeEach(() => {
    jest.clearAllMocks()
    logRepository = {
      save: jest.fn(entity => Promise.resolve({ ...entity, _id: 'log-1' })),
      find: jest.fn().mockResolvedValue([]),
    }
    configService = {
      get: jest.fn(),
      getOrThrow: jest.fn(),
    }
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
          action: 'recordDeposit',
          networkMode: 'simulation',
          blockNumber: null,
          status: 'confirmed',
        })
      )
    })
  })

  describe('2. fabric / connected mode', () => {
    it('connects to gateway and evaluates healthcheck on init', async () => {
      setupValidConfig()
      const evaluateTransaction = jest.fn().mockResolvedValue(Buffer.from('[]'))
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
      expect(evaluateTransaction).toHaveBeenCalledWith('getAllContracts')
    })

    it('submits transaction and returns authentic txId from chaincode response', async () => {
      setupValidConfig()
      const submitTransaction = jest
        .fn()
        .mockResolvedValue(
          Buffer.from(
            JSON.stringify({ txId: 'fabric-tx-999', blockNumber: null })
          )
        )
      const evaluateTransaction = jest.fn().mockResolvedValue(Buffer.from('[]'))
      const getContract = jest
        .fn()
        .mockReturnValue({ submitTransaction, evaluateTransaction })
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
      expect(result.blockNumber).toBeNull()
      expect(logRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          txHash: 'fabric-tx-999',
          blockNumber: null,
          networkMode: 'fabric',
          status: 'confirmed',
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
