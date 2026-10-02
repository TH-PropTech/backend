import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import * as grpc from '@grpc/grpc-js'
import {
  connect,
  Gateway,
  Identity,
  Signer,
  signers,
} from '@hyperledger/fabric-gateway'
import { BlockchainLog } from './schemas/blockchain-log.schema'

const utf8Decoder = new TextDecoder()

/**
 * Hàm read-only rẻ nhất trên chaincode, dùng để xác nhận peer thực sự sống
 * lúc khởi động. Phải tồn tại trong blockchain/chaincode/lib/proptech-contract.js.
 */
const FABRIC_HEALTHCHECK_FN = 'getChaincodeInfo'

export type FabricMode = 'simulation' | 'fabric'
export type FabricConnectionState = 'disabled' | 'connected' | 'unavailable'

export interface FabricStatus {
  mode: FabricMode
  connectionState: FabricConnectionState
  ready: boolean
  channel?: string | undefined
  chaincode?: string | undefined
  chaincodeAbiVersion: 1 | 2
  lastCheckedAt: string
  errorCode?: string | null
}

@Injectable()
export class FabricService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FabricService.name)
  private gateway: Gateway | null = null
  private grpcClient: grpc.Client | null = null
  private mode: FabricMode = 'simulation'
  private connectionState: FabricConnectionState = 'disabled'
  private ready = false
  private errorCode: string | null = null
  private chaincodeAbiVersion: 1 | 2 = 2
  private lastCheckedAt: string = new Date().toISOString()
  private readonly simulationState = new Map<string, Record<string, unknown>>()

  private mspId = ''
  private channelName = ''
  private chaincodeName = ''
  private certPath = ''
  private keyPath = ''
  private tlsCertPath = ''
  private peerEndpoint = ''
  private peerHostAlias = ''

  private reconnectingPromise: Promise<boolean> | null = null
  private lastReconnectAttempt = 0
  private readonly RECONNECT_COOLDOWN_MS = 5000

  constructor(
    @InjectRepository(BlockchainLog)
    private readonly logRepository: Repository<BlockchainLog>,
    private readonly configService: ConfigService
  ) {}

  async onModuleInit(): Promise<void> {
    const enabled = this.configService.get<boolean>('fabric.enabled') ?? false
    this.mode = enabled ? 'fabric' : 'simulation'
    this.lastCheckedAt = new Date().toISOString()

    if (!enabled) {
      this.connectionState = 'disabled'
      this.ready = true
      this.errorCode = null
      this.logger.warn(
        'Fabric integration is disabled. Running in Simulation Mode.'
      )
      return
    }

    await this.initFabric()
  }

  onModuleDestroy(): void {
    try {
      this.gateway?.close?.()
      this.grpcClient?.close?.()
    } catch {
      // ignore cleanup errors
    }
    this.gateway = null
    this.grpcClient = null
    this.logger.log('Fabric Gateway disconnected')
  }

  private async initFabric(): Promise<void> {
    this.lastCheckedAt = new Date().toISOString()
    try {
      this.mspId = this.configService.getOrThrow<string>('FABRIC_MSP_ID')
      this.channelName = this.configService.getOrThrow<string>(
        'FABRIC_CHANNEL_NAME'
      )
      this.chaincodeName = this.configService.getOrThrow<string>(
        'FABRIC_CHAINCODE_NAME'
      )
      this.certPath = this.configService.getOrThrow<string>('FABRIC_CERT_PATH')
      this.keyPath = this.configService.getOrThrow<string>('FABRIC_KEY_PATH')
      this.tlsCertPath = this.configService.getOrThrow<string>(
        'FABRIC_TLS_CERT_PATH'
      )
      this.peerEndpoint = this.configService.getOrThrow<string>(
        'FABRIC_PEER_ENDPOINT'
      )
      this.peerHostAlias = this.configService.getOrThrow<string>(
        'FABRIC_PEER_HOST_ALIAS'
      )
    } catch {
      this.connectionState = 'unavailable'
      this.ready = false
      this.errorCode = 'FABRIC_CONFIG_MISSING'
      this.logger.error('Fabric configuration is incomplete')
      return
    }

    try {
      // 1. Tạo gRPC client với TLS credentials
      let tlsRootCert: Buffer
      try {
        tlsRootCert = fs.readFileSync(path.resolve(this.tlsCertPath))
      } catch {
        this.connectionState = 'unavailable'
        this.ready = false
        this.errorCode = 'FABRIC_TLS_INVALID'
        return
      }

      const tlsCredentials = grpc.credentials.createSsl(tlsRootCert)
      this.grpcClient = new grpc.Client(this.peerEndpoint, tlsCredentials, {
        'grpc.ssl_target_name_override': this.peerHostAlias,
      })

      // 2. Thiết lập Identity (X.509 certificate)
      let certificate: Buffer
      try {
        certificate = fs.readFileSync(path.resolve(this.certPath))
      } catch {
        this.connectionState = 'unavailable'
        this.ready = false
        this.errorCode = 'FABRIC_TLS_INVALID'
        return
      }
      const identity: Identity = { mspId: this.mspId, credentials: certificate }

      // 3. Thiết lập Signer (Private key)
      const resolvedKeyPath = path.resolve(this.keyPath)
      let privateKeyPem: Buffer

      if (
        fs.existsSync(resolvedKeyPath) &&
        fs.statSync(resolvedKeyPath).isDirectory()
      ) {
        const keyFiles = fs.readdirSync(resolvedKeyPath)
        const skFile = keyFiles.find(
          f => f.endsWith('_sk') || f.endsWith('.pem')
        )
        if (!skFile) {
          this.connectionState = 'unavailable'
          this.ready = false
          this.errorCode = 'FABRIC_TLS_INVALID'
          return
        }
        privateKeyPem = fs.readFileSync(path.join(resolvedKeyPath, skFile))
      } else if (fs.existsSync(resolvedKeyPath)) {
        privateKeyPem = fs.readFileSync(resolvedKeyPath)
      } else {
        this.connectionState = 'unavailable'
        this.ready = false
        this.errorCode = 'FABRIC_TLS_INVALID'
        return
      }

      const privateKey = crypto.createPrivateKey(privateKeyPem)
      const signer: Signer = signers.newPrivateKeySigner(privateKey)

      // 4. Kết nối Gateway
      this.gateway = connect({
        client: this.grpcClient,
        identity,
        signer,
        evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
        submitOptions: () => ({ deadline: Date.now() + 30000 }),
        commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
      })

      // 5. Health check thật qua query read-only
      const network = this.gateway.getNetwork(this.channelName)
      const contract = network.getContract(this.chaincodeName)
      try {
        const infoBuffer = await contract.evaluateTransaction(
          FABRIC_HEALTHCHECK_FN
        )
        this.chaincodeAbiVersion = this.parseChaincodeAbiVersion(infoBuffer)
      } catch (error) {
        if (!this.isMissingChaincodeInfoError(error)) throw error

        await contract.evaluateTransaction('getAllContracts')
        this.chaincodeAbiVersion = 1
        this.logger.warn(
          'Fabric chaincode does not expose getChaincodeInfo; using ABI v1 compatibility mode.'
        )
      }

      this.connectionState = 'connected'
      this.ready = true
      this.errorCode = null
      this.logger.log(
        `Successfully connected to Hyperledger Fabric — channel: ${this.channelName}, chaincode: ${this.chaincodeName}`
      )
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : String(error)
      try {
        this.gateway?.close?.()
        this.grpcClient?.close?.()
      } catch {
        // ignore cleanup errors
      }
      this.gateway = null
      this.grpcClient = null

      this.connectionState = 'unavailable'
      this.ready = false

      if (rawMsg.includes('chaincode') || rawMsg.includes('not found')) {
        this.errorCode = 'FABRIC_CHAINCODE_INCOMPATIBLE'
      } else {
        this.errorCode = 'FABRIC_TUNNEL_UNREACHABLE'
      }

      this.logger.error(
        `Failed to initialize Fabric connection: ${this.errorCode}. Connection state: unavailable.`
      )
    }
  }

  private parseChaincodeAbiVersion(result: Uint8Array): 1 | 2 {
    const decoded = utf8Decoder.decode(result).trim()
    if (!decoded) return 2
    try {
      const info = JSON.parse(decoded) as { abiVersion?: unknown }
      return info.abiVersion === 1 ? 1 : 2
    } catch {
      return 2
    }
  }

  private isMissingChaincodeInfoError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /getChaincodeInfo.*(does not exist|not found|unknown)|function.*not found/i.test(
      message
    )
  }

  /**
   * Tự động thử kết nối lại Fabric Gateway khi tunnel/peer phục hồi.
   * Sử dụng single-flight pattern và bounded cooldown để an toàn với concurrent requests.
   */
  async tryReconnect(): Promise<boolean> {
    if (this.mode !== 'fabric') {
      return false
    }
    if (this.connectionState === 'connected' && this.gateway) {
      return true
    }

    if (this.reconnectingPromise) {
      return this.reconnectingPromise
    }

    const now = Date.now()
    if (now - this.lastReconnectAttempt < this.RECONNECT_COOLDOWN_MS) {
      return false
    }

    this.lastReconnectAttempt = now
    this.reconnectingPromise = (async (): Promise<boolean> => {
      try {
        this.logger.log('Attempting to reconnect Fabric Gateway...')
        await this.initFabric()
        return this.connectionState === 'connected'
      } finally {
        this.reconnectingPromise = null
      }
    })()

    return this.reconnectingPromise
  }

  /**
   * Submit transaction to the blockchain (writes data)
   */
  async submitTransaction(
    action: string,
    args: string[],
    metadata: {
      contractId?: string | undefined
      paymentId?: string | undefined
      details?: Record<string, unknown> | undefined
    } = {}
  ): Promise<{
    txHash: string
    blockNumber: number | null
    success: boolean
    networkMode: 'simulation' | 'fabric'
  }> {
    // Redaction: Only log action and aggregate identifier, never raw args/PII/secrets
    this.logger.log(
      `[submitTransaction] Action: ${action}, Aggregate: ${metadata.contractId || metadata.paymentId || 'none'}`
    )

    if (this.mode === 'simulation') {
      const txHash = `sim_${crypto
        .createHash('sha256')
        .update(`${action}:${JSON.stringify(args)}`)
        .digest('hex')}`

      // Write off-chain BlockchainLog to MongoDB
      const log = new BlockchainLog()
      log.action = action
      log.contractId = metadata.contractId ?? null
      log.paymentId = metadata.paymentId ?? null
      log.txHash = txHash
      log.blockNumber = null
      log.network = 'Simulation (Offline)'
      log.networkMode = 'simulation'
      log.status = 'confirmed'
      log.eventType = action
      const details: Record<string, unknown> = { ...(metadata.details ?? {}) }
      if (
        action === 'createContract' &&
        typeof details.contractHash !== 'string'
      ) {
        const hashArgument = args.find(argument =>
          /^[a-f0-9]{64}$/i.test(argument)
        )
        if (hashArgument) details.contractHash = hashArgument
      }
      log.details = details
      await this.logRepository.save(log)

      const simulationRecord: Record<string, unknown> = {
        action,
        args,
        txHash,
        networkMode: 'simulation',
        status: 'confirmed',
        ...(typeof details.contractHash === 'string'
          ? { contractHash: details.contractHash }
          : {}),
      }
      const aggregateId = args[0] ?? ''
      this.simulationState.set(`${action}:${aggregateId}`, simulationRecord)
      if (action === 'createContract' && aggregateId) {
        this.simulationState.set(
          `readContract:${aggregateId}`,
          simulationRecord
        )
        this.simulationState.set(
          `verifyContract:${aggregateId}`,
          simulationRecord
        )
      }

      return {
        txHash,
        blockNumber: null,
        success: true,
        networkMode: 'simulation',
      }
    }

    if (this.connectionState !== 'connected' || !this.gateway) {
      await this.tryReconnect()
    }

    if (this.connectionState !== 'connected' || !this.gateway) {
      throw new Error(
        `FABRIC_GATEWAY_UNAVAILABLE: Gateway connection is ${this.connectionState}`
      )
    }

    try {
      const network = this.gateway.getNetwork(this.channelName)
      const contract = network.getContract(this.chaincodeName)

      // Submit transaction
      const resultBuffer = await contract.submitTransaction(action, ...args)
      const resultString = utf8Decoder.decode(resultBuffer).trim()
      const result = (resultString ? JSON.parse(resultString) : {}) as Record<
        string,
        unknown
      >

      const txHash =
        typeof result.txId === 'string'
          ? result.txId
          : typeof result.txHash === 'string'
            ? result.txHash
            : null

      if (!txHash) {
        throw new Error('Fabric commit did not yield an authentic txId')
      }

      const blockNumber =
        typeof result.blockNumber === 'number' ? result.blockNumber : null

      // Log to MongoDB
      const log = new BlockchainLog()
      log.action = action
      log.contractId = metadata.contractId ?? null
      log.paymentId = metadata.paymentId ?? null
      log.txHash = txHash
      log.blockNumber = blockNumber
      log.network = `Fabric Network (${this.channelName})`
      log.networkMode = 'fabric'
      log.status = 'confirmed'
      log.eventType = action

      const mergedDetails: Record<string, unknown> = {}
      if (metadata.details) {
        Object.assign(mergedDetails, metadata.details)
      }
      Object.assign(mergedDetails, result)
      log.details = mergedDetails

      await this.logRepository.save(log)

      return { txHash, blockNumber, success: true, networkMode: 'fabric' }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      this.logger.error(`Error submitting Fabric transaction: ${errMsg}`)
      throw new Error(`Fabric transaction failed: ${errMsg}`)
    }
  }

  /**
   * Evaluate transaction (queries data, does not write)
   */
  async evaluateTransaction(action: string, args: string[]): Promise<unknown> {
    // Redaction: Log action only without sensitive args
    this.logger.log(`[evaluateTransaction] Action: ${action}`)

    if (this.mode === 'simulation') {
      const state = this.simulationState.get(`${action}:${args[0] ?? ''}`)
      const persistedState =
        state ??
        (action === 'readContract' || action === 'verifyContract'
          ? await this.loadSimulationState(args[0] ?? '')
          : null)
      if (persistedState) {
        return this.projectSimulationResult(action, args, persistedState)
      }
      return {
        action,
        args,
        networkMode: 'simulation',
        status: 'not-found',
      }
    }

    if (this.connectionState !== 'connected' || !this.gateway) {
      await this.tryReconnect()
    }

    if (this.connectionState !== 'connected' || !this.gateway) {
      throw new Error(
        `FABRIC_GATEWAY_UNAVAILABLE: Gateway connection is ${this.connectionState}`
      )
    }

    try {
      const network = this.gateway.getNetwork(this.channelName)
      const contract = network.getContract(this.chaincodeName)

      const resultBuffer = await contract.evaluateTransaction(action, ...args)
      const resultString = utf8Decoder.decode(resultBuffer).trim()
      return resultString ? (JSON.parse(resultString) as unknown) : []
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      this.logger.error(`Error querying Fabric: ${errMsg}`)
      throw new Error(`Fabric query failed: ${errMsg}`)
    }
  }

  private async loadSimulationState(
    contractId: string
  ): Promise<Record<string, unknown> | null> {
    if (!contractId) return null
    const logs = await this.logRepository.find({
      where: { contractId },
      order: { createdAt: 'DESC' },
    })
    const log = logs.find(
      item =>
        item.networkMode === 'simulation' &&
        item.status === 'confirmed' &&
        typeof item.details?.contractHash === 'string'
    )
    if (!log || typeof log.details.contractHash !== 'string') return null
    return {
      action: 'createContract',
      contractId,
      contractHash: log.details.contractHash,
      txHash: log.txHash,
      networkMode: 'simulation',
      status: 'confirmed',
    }
  }

  private projectSimulationResult(
    action: string,
    args: string[],
    state: Record<string, unknown>
  ): Record<string, unknown> {
    if (action !== 'verifyContract') return state
    const contractHash = state.contractHash
    const valid =
      typeof contractHash === 'string' &&
      typeof args[1] === 'string' &&
      contractHash === args[1]
    return { ...state, valid, isValid: valid }
  }

  /**
   * Get truthful status of the blockchain service
   */
  getStatus(): FabricStatus {
    return {
      mode: this.mode,
      connectionState: this.connectionState,
      ready: this.ready,
      channel: this.channelName || undefined,
      chaincode: this.chaincodeName || undefined,
      chaincodeAbiVersion: this.chaincodeAbiVersion,
      lastCheckedAt: this.lastCheckedAt,
      errorCode: this.errorCode,
    }
  }

  getChaincodeAbiVersion(): 1 | 2 {
    return this.chaincodeAbiVersion
  }
}
