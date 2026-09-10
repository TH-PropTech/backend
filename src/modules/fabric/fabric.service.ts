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
const FABRIC_HEALTHCHECK_FN = 'getAllContracts'

@Injectable()
export class FabricService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FabricService.name)
  private gateway: Gateway | null = null
  private grpcClient: grpc.Client | null = null
  private isSimulationMode = true
  private readonly simulationState = new Map<string, Record<string, unknown>>()

  private mspId = ''
  private channelName = ''
  private chaincodeName = ''

  constructor(
    @InjectRepository(BlockchainLog)
    private readonly logRepository: Repository<BlockchainLog>,
    private readonly configService: ConfigService
  ) {}

  async onModuleInit(): Promise<void> {
    const enabled = this.configService.get<string>('FABRIC_ENABLED') === 'true'
    if (!enabled) {
      this.logger.warn(
        'Fabric integration is disabled. Running in Simulation Mode.'
      )
      return
    }

    try {
      this.mspId = this.configService.getOrThrow<string>('FABRIC_MSP_ID')
      this.channelName = this.configService.getOrThrow<string>(
        'FABRIC_CHANNEL_NAME'
      )
      this.chaincodeName = this.configService.getOrThrow<string>(
        'FABRIC_CHAINCODE_NAME'
      )

      const certPath = this.configService.getOrThrow<string>('FABRIC_CERT_PATH')
      const keyPath = this.configService.getOrThrow<string>('FABRIC_KEY_PATH')
      const tlsCertPath = this.configService.getOrThrow<string>(
        'FABRIC_TLS_CERT_PATH'
      )
      const peerEndpoint = this.configService.getOrThrow<string>(
        'FABRIC_PEER_ENDPOINT'
      )
      const peerHostAlias = this.configService.getOrThrow<string>(
        'FABRIC_PEER_HOST_ALIAS'
      )

      // 1. Tạo gRPC client với TLS credentials (bắt buộc — Fabric test network luôn bật TLS)
      const tlsRootCert = fs.readFileSync(path.resolve(tlsCertPath))
      const tlsCredentials = grpc.credentials.createSsl(tlsRootCert)

      // Override hostname để khớp SAN (Subject Alternative Name) trong chứng chỉ TLS của peer
      this.grpcClient = new grpc.Client(peerEndpoint, tlsCredentials, {
        'grpc.ssl_target_name_override': peerHostAlias,
      })

      // 2. Thiết lập Identity (X.509 certificate)
      const certificate = fs.readFileSync(path.resolve(certPath))
      const identity: Identity = { mspId: this.mspId, credentials: certificate }

      // 3. Thiết lập Signer (Private key)
      const resolvedKeyPath = path.resolve(keyPath)
      let privateKeyPem: Buffer

      if (
        fs.existsSync(resolvedKeyPath) &&
        fs.statSync(resolvedKeyPath).isDirectory()
      ) {
        // keyPath là thư mục (keystore/) — tìm file *_sk
        const keyFiles = fs.readdirSync(resolvedKeyPath)
        const skFile = keyFiles.find(f => f.endsWith('_sk'))
        if (!skFile) {
          throw new Error(
            `Không tìm thấy file private key (*_sk) trong: ${keyPath}`
          )
        }
        privateKeyPem = fs.readFileSync(path.join(resolvedKeyPath, skFile))
      } else {
        // keyPath trỏ trực tiếp tới file key
        privateKeyPem = fs.readFileSync(resolvedKeyPath)
      }

      const privateKey = crypto.createPrivateKey(privateKeyPem)
      const signer: Signer = signers.newPrivateKeySigner(privateKey)

      // 4. Kết nối Gateway (theo chuẩn @hyperledger/fabric-gateway — Fabric v2.4+)
      this.gateway = connect({
        client: this.grpcClient,
        identity,
        signer,
        evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
        submitOptions: () => ({ deadline: Date.now() + 30000 }),
        commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
      })

      // 5. Health check thật.
      // `new grpc.Client()` và `connect()` đều lazy — không mở kết nối mạng nào.
      // Nếu bỏ qua bước này, service sẽ log "connected" kể cả khi peer đã chết,
      // và lỗi chỉ nổ ra lúc người dùng kích hoạt hợp đồng.
      const network = this.gateway.getNetwork(this.channelName)
      const contract = network.getContract(this.chaincodeName)
      await contract.evaluateTransaction(FABRIC_HEALTHCHECK_FN)

      this.isSimulationMode = false
      this.logger.log(
        `Successfully connected to Hyperledger Fabric — channel: ${this.channelName}, chaincode: ${this.chaincodeName}`
      )
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      this.logger.error(
        `Failed to initialize Fabric connection: ${errMsg}. Falling back to Simulation Mode.`
      )
      // Dọn gateway/gRPC client nửa vời để không rò socket khi health check trượt.
      this.gateway?.close()
      this.grpcClient?.close()
      this.gateway = null
      this.grpcClient = null
      this.isSimulationMode = true
    }
  }

  onModuleDestroy(): void {
    this.gateway?.close()
    this.grpcClient?.close()
    this.logger.log('Fabric Gateway disconnected')
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
    blockNumber: number
    success: boolean
    networkMode: 'simulation' | 'fabric'
  }> {
    this.logger.log(
      `[submitTransaction] Action: ${action}, Args: ${JSON.stringify(args)}`
    )

    if (this.isSimulationMode) {
      const txHash = `sim_${crypto
        .createHash('sha256')
        .update(`${action}:${JSON.stringify(args)}`)
        .digest('hex')}`
      const blockNumber = 0

      // Write off-chain BlockchainLog to MongoDB
      const log = new BlockchainLog()
      log.action = action
      log.contractId = metadata.contractId ?? null
      log.paymentId = metadata.paymentId ?? null
      log.txHash = txHash
      log.blockNumber = blockNumber
      log.network = 'Simulation (Offline)'
      log.networkMode = 'simulation'
      log.status = 'confirmed'
      log.eventType = action
      log.details = metadata.details ?? {}
      await this.logRepository.save(log)

      this.simulationState.set(`${action}:${args[0] ?? ''}`, {
        action,
        args,
        txHash,
        networkMode: 'simulation',
        status: 'confirmed',
      })

      return { txHash, blockNumber, success: true, networkMode: 'simulation' }
    }

    try {
      if (!this.gateway) {
        throw new Error('Gateway not initialized')
      }
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
          : crypto.randomBytes(32).toString('hex')
      const blockNumber =
        typeof result.blockNumber === 'number'
          ? result.blockNumber
          : Number(result.blockNumber) || 1

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
    this.logger.log(
      `[evaluateTransaction] Action: ${action}, Args: ${JSON.stringify(args)}`
    )

    if (this.isSimulationMode) {
      const state = this.simulationState.get(`${action}:${args[0] ?? ''}`)
      return (
        state ?? {
          action,
          args,
          networkMode: 'simulation',
          status: 'not-found',
        }
      )
    }

    try {
      if (!this.gateway) {
        throw new Error('Gateway not initialized')
      }
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

  /**
   * Get status of the blockchain service
   */
  getStatus(): {
    mode: 'simulation' | 'fabric'
    channel?: string | undefined
    chaincode?: string | undefined
  } {
    return {
      mode: this.isSimulationMode ? 'simulation' : 'fabric',
      channel: this.channelName || undefined,
      chaincode: this.chaincodeName || undefined,
    }
  }
}
