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
import {
  FabricIdentityInspection,
  FabricIdentityState,
  inspectCertificate,
} from './fabric-identity'
import {
  classifyCommitStatus,
  classifyFabricError,
  decodeBlockchainInfo,
  toSafeBlockNumber,
} from './fabric-gateway-utils'

const utf8Decoder = new TextDecoder()

/**
 * Hàm read-only rẻ nhất trên chaincode, dùng để xác nhận peer thực sự sống
 * lúc khởi động. Phải tồn tại trong blockchain/chaincode/lib/proptech-contract.js.
 */
const FABRIC_HEALTHCHECK_FN = 'getChaincodeInfo'

/** Giao dịch chỉ operator được phép gửi (D4); mọi giao dịch ghi khác đi qua writer. */
const OPERATOR_ACTIONS = new Set(['publishGovernanceSnapshot'])

const READINESS_REFRESH_INTERVAL_MS = 60_000
const EXPLORER_HEALTH_TIMEOUT_MS = 3_000
const DEFAULT_IDENTITY_EXPIRY_WARN_DAYS = 30

export type FabricMode = 'simulation' | 'fabric'
export type FabricConnectionState = 'disabled' | 'connected' | 'unavailable'
export type FabricRole = 'writer' | 'reader' | 'operator'

const FABRIC_ROLES: readonly FabricRole[] = ['writer', 'reader', 'operator']

export type FabricIdentityCheck = {
  state: FabricIdentityState | 'disabled' | 'unavailable'
  expiresAt: string | null
  expiringSoon: boolean
  errorCode: string | null
}

export interface FabricStatus {
  mode: FabricMode
  connectionState: FabricConnectionState
  ready: boolean
  channel?: string | undefined
  chaincode?: string | undefined
  chaincodeAbiVersion: 1 | 2
  lastCheckedAt: string
  errorCode?: string | null
  /** PROP-399 D5 — các trường bên dưới chỉ bổ sung, không đổi nghĩa trường cũ. */
  evidenceSchemaVersions?: number[]
  gateway?: {
    state: FabricConnectionState
    abiVersion: number | null
  }
  identities?: Record<FabricRole, FabricIdentityCheck>
  ledger?: {
    height: number | null
    currentBlockHash: string | null
    observedAt: string | null
  }
  explorer?: {
    enabled: boolean
    state: 'disabled' | 'ready' | 'degraded'
    publicUrl: string | null
  }
  errorCodes?: string[]
}

type FabricConnection = {
  key: string
  roles: FabricRole[]
  certPath: string
  keyPath: string
  usesLegacyIdentity: boolean
  gateway: Gateway | null
  grpcClient: grpc.Client | null
  state: 'connected' | 'unavailable'
  errorCode: string | null
  identity: FabricIdentityInspection | null
  keyPermissionError: boolean
  lastReconnectAttempt: number
  reconnecting: Promise<boolean> | null
}

type CommonConfig = {
  mspId: string
  channelName: string
  chaincodeName: string
  tlsCertPath: string
  peerEndpoint: string
  peerHostAlias: string
}

@Injectable()
export class FabricService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FabricService.name)
  private mode: FabricMode = 'simulation'
  private configErrorCode: string | null = null
  private chaincodeAbiVersion: 1 | 2 = 2
  private abiDetected = false
  /** Evidence schema versions mà chaincode quảng bá qua getChaincodeInfo (PROP-399 D2). */
  private chaincodeEvidenceSchemaVersions: number[] = [2]
  private lastCheckedAt: string = new Date().toISOString()
  private readonly simulationState = new Map<string, Record<string, unknown>>()

  private mspId = ''
  private channelName = ''
  private chaincodeName = ''
  private tlsCertPath = ''
  private peerEndpoint = ''
  private peerHostAlias = ''

  /** Mỗi cặp (cert, key) là một kết nối riêng — các vai trò dùng chung cặp (chế độ tương thích) dùng chung kết nối. */
  private connections = new Map<string, FabricConnection>()
  private roleConnection = new Map<FabricRole, FabricConnection>()
  private readonly RECONNECT_COOLDOWN_MS = 5000
  /** Thời điểm thử dựng lại gần nhất của bất kỳ kết nối nào (chẩn đoán); cooldown thực sự nằm theo từng kết nối. */
  private lastReconnectAttempt = 0

  private ledgerInfo: {
    height: number | null
    currentBlockHash: string | null
    observedAt: string | null
  } = { height: null, currentBlockHash: null, observedAt: null }
  private explorerState: {
    state: 'disabled' | 'ready' | 'degraded'
    errorCode: string | null
  } = { state: 'disabled', errorCode: null }
  private separationErrors: string[] = []
  private refreshTimer: NodeJS.Timeout | null = null
  private refreshing: Promise<void> | null = null

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
      this.configErrorCode = null
      this.logger.warn(
        'Fabric integration is disabled. Running in Simulation Mode.'
      )
      return
    }

    await this.initFabric()
    this.startReadinessRefresh()
  }

  onModuleDestroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
    for (const connection of this.connections.values()) {
      this.closeConnection(connection)
    }
    this.logger.log('Fabric Gateway disconnected')
  }

  // ── Kết nối theo vai trò ────────────────────────────────────────────────

  private readCommonConfig(): CommonConfig | null {
    try {
      return {
        mspId: this.configService.getOrThrow<string>('FABRIC_MSP_ID'),
        channelName: this.configService.getOrThrow<string>(
          'FABRIC_CHANNEL_NAME'
        ),
        chaincodeName: this.configService.getOrThrow<string>(
          'FABRIC_CHAINCODE_NAME'
        ),
        tlsCertPath: this.configService.getOrThrow<string>(
          'FABRIC_TLS_CERT_PATH'
        ),
        peerEndpoint: this.configService.getOrThrow<string>(
          'FABRIC_PEER_ENDPOINT'
        ),
        peerHostAlias: this.configService.getOrThrow<string>(
          'FABRIC_PEER_HOST_ALIAS'
        ),
      }
    } catch {
      return null
    }
  }

  /** Đường dẫn identity của một vai trò; thiếu → quay về cặp legacy (chế độ tương thích). */
  private resolveRoleIdentity(role: FabricRole): {
    certPath: string
    keyPath: string
    legacy: boolean
  } {
    const certPath = this.configService.get<string>(
      `fabric.identities.${role}.certPath`
    )
    const keyPath = this.configService.get<string>(
      `fabric.identities.${role}.keyPath`
    )
    if (certPath && keyPath) return { certPath, keyPath, legacy: false }
    return {
      certPath: this.configService.getOrThrow<string>('FABRIC_CERT_PATH'),
      keyPath: this.configService.getOrThrow<string>('FABRIC_KEY_PATH'),
      legacy: true,
    }
  }

  private buildConnections(): boolean {
    const common = this.readCommonConfig()
    if (!common) {
      this.configErrorCode = 'FABRIC_CONFIG_MISSING'
      this.logger.error('Fabric configuration is incomplete')
      return false
    }
    try {
      const next = new Map<string, FabricConnection>()
      const byRole = new Map<FabricRole, FabricConnection>()
      for (const role of FABRIC_ROLES) {
        const identity = this.resolveRoleIdentity(role)
        const key = `${path.resolve(identity.certPath)}|${path.resolve(identity.keyPath)}`
        let connection = next.get(key)
        if (!connection) {
          // Giữ lại kết nối cũ (gateway, cooldown) nếu cặp identity không đổi.
          connection = this.connections.get(key) ?? {
            key,
            roles: [],
            certPath: identity.certPath,
            keyPath: identity.keyPath,
            usesLegacyIdentity: identity.legacy,
            gateway: null,
            grpcClient: null,
            state: 'unavailable',
            errorCode: null,
            identity: null,
            keyPermissionError: false,
            lastReconnectAttempt: 0,
            reconnecting: null,
          }
          connection.roles = []
          connection.usesLegacyIdentity = identity.legacy
          next.set(key, connection)
        }
        connection.roles.push(role)
        byRole.set(role, connection)
      }
      for (const [key, connection] of this.connections) {
        if (!next.has(key)) this.closeConnection(connection)
      }
      this.connections = next
      this.roleConnection = byRole
    } catch {
      this.configErrorCode = 'FABRIC_CONFIG_MISSING'
      this.logger.error('Fabric configuration is incomplete')
      return false
    }
    this.mspId = common.mspId
    this.channelName = common.channelName
    this.chaincodeName = common.chaincodeName
    this.tlsCertPath = common.tlsCertPath
    this.peerEndpoint = common.peerEndpoint
    this.peerHostAlias = common.peerHostAlias
    this.configErrorCode = null
    return true
  }

  private async initFabric(): Promise<void> {
    this.lastCheckedAt = new Date().toISOString()
    if (!this.buildConnections()) return

    for (const connection of this.connections.values()) {
      await this.connectConnection(connection)
    }
    await this.refreshReadiness()
  }

  private closeConnection(connection: FabricConnection): void {
    try {
      connection.gateway?.close?.()
      connection.grpcClient?.close?.()
    } catch {
      // ignore cleanup errors
    }
    connection.gateway = null
    connection.grpcClient = null
  }

  private warnDays(): number {
    const value = this.configService.get<number>(
      'fabric.identityExpiryWarnDays'
    )
    return typeof value === 'number' && value >= 1
      ? value
      : DEFAULT_IDENTITY_EXPIRY_WARN_DAYS
  }

  private isProduction(): boolean {
    return this.configService.get<string>('app.env') === 'production'
  }

  /** Đọc lại identity/khóa/TLS từ đường dẫn cấu hình rồi dựng gateway cho một kết nối. */
  private async connectConnection(connection: FabricConnection): Promise<void> {
    this.closeConnection(connection)
    connection.state = 'unavailable'
    connection.errorCode = null
    connection.keyPermissionError = false

    const fail = (code: string): void => {
      this.closeConnection(connection)
      connection.state = 'unavailable'
      connection.errorCode = code
    }

    try {
      let tlsRootCert: Buffer
      try {
        tlsRootCert = fs.readFileSync(path.resolve(this.tlsCertPath))
      } catch {
        fail('FABRIC_TLS_INVALID')
        return
      }

      let certificate: Buffer
      try {
        certificate = fs.readFileSync(path.resolve(connection.certPath))
      } catch {
        fail('FABRIC_TLS_INVALID')
        return
      }

      connection.identity = inspectCertificate(
        certificate,
        new Date(),
        this.warnDays()
      )
      if (
        connection.identity.state === 'invalid' ||
        connection.identity.state === 'expired'
      ) {
        // Identity hết hạn/không hợp lệ không bao giờ được dùng để dựng gateway.
        fail(connection.identity.errorCode ?? 'FABRIC_IDENTITY_INVALID')
        return
      }

      const resolvedKeyPath = path.resolve(connection.keyPath)
      let privateKeyPem: Buffer
      let keyFile = resolvedKeyPath
      if (
        fs.existsSync(resolvedKeyPath) &&
        fs.statSync(resolvedKeyPath).isDirectory()
      ) {
        const keyFiles = fs.readdirSync(resolvedKeyPath)
        const skFile = keyFiles.find(
          f => f.endsWith('_sk') || f.endsWith('.pem')
        )
        if (!skFile) {
          fail('FABRIC_TLS_INVALID')
          return
        }
        keyFile = path.join(resolvedKeyPath, skFile)
        privateKeyPem = fs.readFileSync(keyFile)
      } else if (fs.existsSync(resolvedKeyPath)) {
        privateKeyPem = fs.readFileSync(resolvedKeyPath)
      } else {
        fail('FABRIC_TLS_INVALID')
        return
      }

      if (this.keyFileTooOpen(keyFile)) {
        connection.keyPermissionError = true
        fail('FABRIC_KEY_PERMISSIONS_TOO_OPEN')
        return
      }

      const tlsCredentials = grpc.credentials.createSsl(tlsRootCert)
      connection.grpcClient = new grpc.Client(
        this.peerEndpoint,
        tlsCredentials,
        { 'grpc.ssl_target_name_override': this.peerHostAlias }
      )
      const identity: Identity = {
        mspId: this.mspId,
        credentials: certificate,
      }
      const privateKey = crypto.createPrivateKey(privateKeyPem)
      const signer: Signer = signers.newPrivateKeySigner(privateKey)

      connection.gateway = connect({
        client: connection.grpcClient,
        identity,
        signer,
        evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
        submitOptions: () => ({ deadline: Date.now() + 30000 }),
        commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
      })

      // Health/ABI check thật qua query metadata hằng chi phí, chỉ trên gateway reader (D5).
      if (connection.roles.includes('reader')) {
        const contract = connection.gateway
          .getNetwork(this.channelName)
          .getContract(this.chaincodeName)
        let infoBuffer: Uint8Array
        try {
          infoBuffer = await contract.evaluateTransaction(FABRIC_HEALTHCHECK_FN)
        } catch (error) {
          if (this.isMissingChaincodeInfoError(error)) {
            // Không bao giờ quay về quét ledger: chaincode thiếu metadata là không tương thích.
            fail('FABRIC_CHAINCODE_INCOMPATIBLE')
            return
          }
          throw error
        }
        this.chaincodeAbiVersion = this.parseChaincodeAbiVersion(infoBuffer)
        this.chaincodeEvidenceSchemaVersions =
          this.parseEvidenceSchemaVersions(infoBuffer)
        this.abiDetected = true
      }

      connection.state = 'connected'
      this.logger.log(
        `Successfully connected to Hyperledger Fabric [${connection.roles.join(',')}] — channel: ${this.channelName}, chaincode: ${this.chaincodeName}`
      )
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : String(error)
      fail(
        rawMsg.includes('chaincode') || rawMsg.includes('not found')
          ? 'FABRIC_CHAINCODE_INCOMPATIBLE'
          : 'FABRIC_TUNNEL_UNREACHABLE'
      )
      this.logger.error(
        `Failed to initialize Fabric connection [${connection.roles.join(',')}]: ${connection.errorCode}. Connection state: unavailable.`
      )
    }
  }

  /** Quyền file khoá riêng quá rộng (chỉ kiểm tra trên hệ điều hành POSIX). */
  private keyFileTooOpen(keyFile: string): boolean {
    if (process.platform === 'win32') return false
    try {
      const mode = fs.statSync(keyFile).mode
      return typeof mode === 'number' && (mode & 0o077) !== 0
    } catch {
      return false
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

  /** Chaincode cũ không quảng bá `evidenceSchemaVersions` → chỉ giả định v2. */
  private parseEvidenceSchemaVersions(result: Uint8Array): number[] {
    const decoded = utf8Decoder.decode(result).trim()
    if (!decoded) return [2]
    try {
      const info = JSON.parse(decoded) as { evidenceSchemaVersions?: unknown }
      if (!Array.isArray(info.evidenceSchemaVersions)) return [2]
      return info.evidenceSchemaVersions.filter(
        (version): version is number =>
          typeof version === 'number' &&
          Number.isInteger(version) &&
          version >= 1
      )
    } catch {
      return [2]
    }
  }

  private isMissingChaincodeInfoError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /getChaincodeInfo.*(does not exist|not found|unknown)|function.*not found/i.test(
      message
    )
  }

  /**
   * Tự động thử kết nối lại gateway khi tunnel/peer phục hồi hoặc sau lỗi connection-level.
   * Single-flight + cooldown cho từng kết nối; chỉ các kết nối chưa `connected` được dựng lại,
   * nên gateway của vai trò khác không bị ảnh hưởng.
   */
  async tryReconnect(role?: FabricRole): Promise<boolean> {
    if (this.mode !== 'fabric') {
      return false
    }

    if (this.connections.size === 0 || this.configErrorCode) {
      if (!this.buildConnections()) return false
    }

    const targets = role
      ? [this.roleConnection.get(role)].filter(
          (c): c is FabricConnection => c !== undefined
        )
      : [...this.connections.values()]
    const results = await Promise.all(
      targets.map(connection => this.reconnectConnection(connection))
    )
    return results.every(Boolean)
  }

  private reconnectConnection(connection: FabricConnection): Promise<boolean> {
    if (connection.state === 'connected' && connection.gateway) {
      return Promise.resolve(true)
    }
    if (connection.reconnecting) return connection.reconnecting

    const now = Date.now()
    if (now - connection.lastReconnectAttempt < this.RECONNECT_COOLDOWN_MS) {
      return Promise.resolve(false)
    }

    connection.lastReconnectAttempt = now
    this.lastReconnectAttempt = now
    connection.reconnecting = (async (): Promise<boolean> => {
      try {
        this.logger.log(
          `Attempting to reconnect Fabric Gateway [${connection.roles.join(',')}]...`
        )
        this.lastCheckedAt = new Date().toISOString()
        if (!this.readCommonConfig()) {
          this.configErrorCode = 'FABRIC_CONFIG_MISSING'
          return false
        }
        this.configErrorCode = null
        await this.connectConnection(connection)
        if (connection.state === 'connected') {
          await this.refreshReadiness()
        }
        return connection.state === 'connected'
      } finally {
        connection.reconnecting = null
      }
    })()
    return connection.reconnecting
  }

  /**
   * Lỗi connection-level: đóng đúng gateway của vai trò, đánh dấu unavailable để lần gọi sau
   * dựng lại bằng identity/TLS mới. Lỗi business (ERR_<CODE>) không bao giờ gọi hàm này.
   */
  private markConnectionUnavailable(
    role: FabricRole,
    error: unknown,
    operation: 'submit' | 'evaluate'
  ): void {
    const connection = this.roleConnection.get(role)
    if (!connection) return
    const message = error instanceof Error ? error.message : String(error)
    const tls = /handshake|certificate|\bTLS\b|\bSSL\b|x509/i.test(message)
    this.closeConnection(connection)
    connection.state = 'unavailable'
    connection.errorCode = tls
      ? 'FABRIC_TLS_INVALID'
      : 'FABRIC_TUNNEL_UNREACHABLE'
    // Chỉ ghi vai trò và nhóm lỗi — không ghi thông điệp thô.
    this.logger.warn(
      `Fabric gateway [${role}] marked unavailable after a connection-level ${operation} error (${connection.errorCode})`
    )
  }

  private async requireGateway(role: FabricRole): Promise<Gateway> {
    let connection = this.roleConnection.get(role)
    if (
      !connection ||
      connection.state !== 'connected' ||
      !connection.gateway
    ) {
      await this.tryReconnect(role)
      connection = this.roleConnection.get(role)
    }
    if (
      !connection ||
      connection.state !== 'connected' ||
      !connection.gateway
    ) {
      throw new Error(
        `FABRIC_GATEWAY_UNAVAILABLE: Gateway connection is ${connection?.state ?? 'unavailable'}`
      )
    }
    return connection.gateway
  }

  private roleForAction(action: string): FabricRole {
    return OPERATOR_ACTIONS.has(action) ? 'operator' : 'writer'
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
      /** PROP-399 D6: tham chiếu tra cứu cho các họ bằng chứng mới. */
      governanceSnapshotId?: string | undefined
      settlementId?: string | undefined
      handoverRevision?: number | undefined
      schemaVersion?: number | undefined
      payloadHash?: string | undefined
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
      this.applyLogReferences(log, metadata)
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

    const role = this.roleForAction(action)
    const gateway = await this.requireGateway(role)

    try {
      const network = gateway.getNetwork(this.channelName)
      const contract = network.getContract(this.chaincodeName)

      // submitAsync + commit.getStatus(): txHash và blockNumber đến từ commit status thật (B5).
      const commit = await contract.submitAsync(action, { arguments: args })
      const status = await commit.getStatus()
      if (!status.successful) {
        const outcome = classifyCommitStatus(status.code)
        // Retryable KHÔNG chứa tên mã (vd. *_CONFLICT) để outbox không phân loại nhầm là terminal.
        throw new Error(
          outcome.kind === 'retryable'
            ? `FABRIC_COMMIT_RETRYABLE: validation code ${outcome.code}`
            : `FABRIC_COMMIT_REJECTED: validation code ${outcome.code} (${outcome.name})`
        )
      }

      const txHash = commit.getTransactionId()
      if (!txHash) {
        throw new Error('Fabric commit did not yield an authentic txId')
      }
      const blockNumber = toSafeBlockNumber(status.blockNumber)

      const resultString = utf8Decoder.decode(commit.getResult()).trim()
      const result = (resultString ? JSON.parse(resultString) : {}) as Record<
        string,
        unknown
      >

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
      this.applyLogReferences(log, metadata)

      const mergedDetails: Record<string, unknown> = {}
      if (metadata.details) {
        Object.assign(mergedDetails, metadata.details)
      }
      Object.assign(mergedDetails, result)
      log.details = mergedDetails

      await this.logRepository.save(log)

      return { txHash, blockNumber, success: true, networkMode: 'fabric' }
    } catch (error) {
      // Submit không bao giờ được thử lại ngay tại đây: outbox giữ lịch retry bền vững (không resubmit kép).
      if (classifyFabricError(error) === 'connection') {
        this.markConnectionUnavailable(role, error, 'submit')
      }
      const errMsg = error instanceof Error ? error.message : String(error)
      this.logger.error(`Error submitting Fabric transaction: ${errMsg}`)
      throw new Error(`Fabric transaction failed: ${errMsg}`)
    }
  }

  /** Chỉ nhận giá trị đúng dạng; giá trị sai dạng bị bỏ (null) thay vì ghi vào log. */
  private applyLogReferences(
    log: BlockchainLog,
    metadata: {
      governanceSnapshotId?: unknown
      settlementId?: unknown
      handoverRevision?: unknown
      schemaVersion?: unknown
      payloadHash?: unknown
    }
  ): void {
    const text = (value: unknown): string | null =>
      typeof value === 'string' && value.length > 0 ? value : null
    const positiveInt = (value: unknown): number | null =>
      typeof value === 'number' && Number.isInteger(value) && value >= 1
        ? value
        : null
    log.governanceSnapshotId = text(metadata.governanceSnapshotId)
    log.settlementId = text(metadata.settlementId)
    log.handoverRevision = positiveInt(metadata.handoverRevision)
    log.schemaVersion = positiveInt(metadata.schemaVersion)
    log.payloadHash =
      typeof metadata.payloadHash === 'string' &&
      /^[a-f0-9]{64}$/i.test(metadata.payloadHash)
        ? metadata.payloadHash.toLowerCase()
        : null
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

    return this.evaluateOnReader(action, args, true)
  }

  private async evaluateOnReader(
    action: string,
    args: string[],
    allowRetryAfterReconnect: boolean
  ): Promise<unknown> {
    const gateway = await this.requireGateway('reader')

    try {
      const network = gateway.getNetwork(this.channelName)
      const contract = network.getContract(this.chaincodeName)

      const resultBuffer = await contract.evaluateTransaction(action, ...args)
      const resultString = utf8Decoder.decode(resultBuffer).trim()
      return resultString ? (JSON.parse(resultString) as unknown) : []
    } catch (error) {
      if (classifyFabricError(error) === 'connection') {
        this.markConnectionUnavailable('reader', error, 'evaluate')
        if (allowRetryAfterReconnect && (await this.tryReconnect('reader'))) {
          // Đọc là idempotent: được thử lại đúng một lần sau khi gateway dựng lại thành công.
          return this.evaluateOnReader(action, args, false)
        }
      }
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

  // ── Readiness ───────────────────────────────────────────────────────────

  private startReadinessRefresh(): void {
    if (this.refreshTimer) return
    this.refreshTimer = setInterval(() => {
      void this.refreshReadiness()
    }, READINESS_REFRESH_INTERVAL_MS)
    this.refreshTimer.unref?.()
  }

  /**
   * Làm mới các kiểm tra tốn I/O (hạn chứng chỉ, chiều cao ledger qua qscc, health Explorer,
   * tách biệt identity). Single-flight; không bao giờ ném lỗi và không đổi trạng thái gateway.
   */
  refreshReadiness(): Promise<void> {
    if (this.mode !== 'fabric') return Promise.resolve()
    if (this.refreshing) return this.refreshing
    this.refreshing = (async (): Promise<void> => {
      try {
        this.lastCheckedAt = new Date().toISOString()
        this.refreshIdentities()
        await this.refreshLedgerInfo()
        await this.refreshExplorer()
      } catch {
        // readiness refresh là best-effort
      } finally {
        this.refreshing = null
      }
    })()
    return this.refreshing
  }

  private refreshIdentities(): void {
    const warnDays = this.warnDays()
    const fingerprints = new Map<FabricRole, string | null>()
    for (const connection of this.connections.values()) {
      try {
        const inspection = inspectCertificate(
          fs.readFileSync(path.resolve(connection.certPath)),
          new Date(),
          warnDays
        )
        connection.identity = inspection
        for (const role of connection.roles) {
          fingerprints.set(role, inspection.fingerprint)
        }
      } catch {
        connection.identity = {
          state: 'invalid',
          expiringSoon: false,
          expiresAt: null,
          fingerprint: null,
          errorCode: 'FABRIC_IDENTITY_INVALID',
        }
      }
    }

    const separation: string[] = []
    const roleFingerprints = FABRIC_ROLES.map(
      role => fingerprints.get(role) ?? null
    ).filter((value): value is string => value !== null)
    const legacyInUse = [...this.connections.values()].some(
      connection => connection.usesLegacyIdentity
    )
    if (
      legacyInUse ||
      new Set(roleFingerprints).size !== roleFingerprints.length
    ) {
      separation.push('FABRIC_IDENTITY_SEPARATION_REQUIRED')
    }
    const explorerCert = this.configService.get<string>(
      'fabric.explorer.certPath'
    )
    if (explorerCert) {
      try {
        const explorer = inspectCertificate(
          fs.readFileSync(path.resolve(explorerCert)),
          new Date(),
          warnDays
        )
        if (
          explorer.fingerprint &&
          roleFingerprints.includes(explorer.fingerprint)
        ) {
          separation.push('FABRIC_IDENTITY_SEPARATION_REQUIRED')
        }
      } catch {
        // Chứng chỉ Explorer không đọc được không phải lỗi của gateway backend.
      }
    }
    this.separationErrors = [...new Set(separation)]
  }

  private async refreshLedgerInfo(): Promise<void> {
    const reader = this.roleConnection.get('reader')
    if (!reader || reader.state !== 'connected' || !reader.gateway) {
      this.ledgerInfo = {
        height: null,
        currentBlockHash: null,
        observedAt: null,
      }
      return
    }
    try {
      const bytes = await reader.gateway
        .getNetwork(this.channelName)
        .getContract('qscc')
        .evaluateTransaction('GetChainInfo', this.channelName)
      const info = decodeBlockchainInfo(bytes)
      this.ledgerInfo = {
        ...info,
        observedAt: new Date().toISOString(),
      }
    } catch {
      // Lỗi chỉ làm height = null; không đổi `ready`.
      this.ledgerInfo = {
        height: null,
        currentBlockHash: null,
        observedAt: null,
      }
    }
  }

  private async refreshExplorer(): Promise<void> {
    const enabled =
      this.configService.get<boolean>('fabric.explorer.enabled') ?? false
    if (!enabled) {
      this.explorerState = { state: 'disabled', errorCode: null }
      return
    }
    const healthUrl = this.configService.get<string>(
      'fabric.explorer.healthUrl'
    )
    if (!healthUrl) {
      this.explorerState = {
        state: 'degraded',
        errorCode: 'FABRIC_EXPLORER_DEGRADED',
      }
      return
    }
    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(EXPLORER_HEALTH_TIMEOUT_MS),
      })
      this.explorerState = response.ok
        ? { state: 'ready', errorCode: null }
        : { state: 'degraded', errorCode: 'FABRIC_EXPLORER_DEGRADED' }
    } catch {
      this.explorerState = {
        state: 'degraded',
        errorCode: 'FABRIC_EXPLORER_DEGRADED',
      }
    }
  }

  private overallConnectionState(): FabricConnectionState {
    if (this.mode === 'simulation') return 'disabled'
    if (this.configErrorCode || this.connections.size === 0) {
      return 'unavailable'
    }
    return [...this.connections.values()].every(
      connection => connection.state === 'connected'
    )
      ? 'connected'
      : 'unavailable'
  }

  private identityCheck(role: FabricRole): FabricIdentityCheck {
    const connection = this.roleConnection.get(role)
    const identity = connection?.identity
    if (!connection || !identity) {
      return {
        state: connection ? 'unavailable' : 'missing',
        expiresAt: null,
        expiringSoon: false,
        errorCode: connection?.errorCode ?? null,
      }
    }
    return {
      state: identity.state,
      expiresAt: identity.expiresAt,
      expiringSoon: identity.expiringSoon,
      errorCode: identity.errorCode,
    }
  }

  /** Mã lỗi chặn readiness + cảnh báo không chặn, đã khử trùng lặp. */
  private collectErrorCodes(): { blocking: string[]; warnings: string[] } {
    const blocking: string[] = []
    const warnings: string[] = []
    if (this.configErrorCode) blocking.push(this.configErrorCode)
    for (const connection of this.connections.values()) {
      if (connection.errorCode) blocking.push(connection.errorCode)
      const identity = connection.identity
      if (identity?.state === 'expired' || identity?.state === 'invalid') {
        if (identity.errorCode) blocking.push(identity.errorCode)
      } else if (identity?.state === 'expiring' && identity.errorCode) {
        warnings.push(identity.errorCode)
      }
    }
    if (this.separationErrors.length > 0) {
      // Production: chặn readiness. Ngoài production (chế độ tương thích): chỉ cảnh báo.
      ;(this.isProduction() ? blocking : warnings).push(
        ...this.separationErrors
      )
    }
    if (this.explorerState.errorCode)
      warnings.push(this.explorerState.errorCode)
    return {
      blocking: [...new Set(blocking)],
      warnings: [...new Set(warnings)],
    }
  }

  /**
   * Get truthful status of the blockchain service
   */
  getStatus(): FabricStatus {
    const connectionState = this.overallConnectionState()
    const { blocking, warnings } =
      this.mode === 'fabric'
        ? this.collectErrorCodes()
        : { blocking: [], warnings: [] }
    const ready =
      this.mode === 'simulation'
        ? true
        : connectionState === 'connected' && blocking.length === 0
    const explorerEnabled =
      this.configService.get<boolean>('fabric.explorer.enabled') ?? false
    const explorerPublicUrl =
      this.mode === 'fabric' && this.explorerState.state === 'ready'
        ? (this.configService.get<string>('fabric.explorer.publicUrl') ?? null)
        : null

    const disabledIdentity: FabricIdentityCheck = {
      state: 'disabled',
      expiresAt: null,
      expiringSoon: false,
      errorCode: null,
    }

    return {
      mode: this.mode,
      connectionState,
      ready,
      channel: this.channelName || undefined,
      chaincode: this.chaincodeName || undefined,
      chaincodeAbiVersion: this.chaincodeAbiVersion,
      lastCheckedAt: this.lastCheckedAt,
      errorCode: blocking[0] ?? null,
      evidenceSchemaVersions: [...this.chaincodeEvidenceSchemaVersions],
      gateway: {
        state: connectionState,
        abiVersion:
          this.mode === 'fabric' && this.abiDetected
            ? this.chaincodeAbiVersion
            : null,
      },
      identities:
        this.mode === 'fabric'
          ? {
              writer: this.identityCheck('writer'),
              reader: this.identityCheck('reader'),
              operator: this.identityCheck('operator'),
            }
          : {
              writer: disabledIdentity,
              reader: disabledIdentity,
              operator: disabledIdentity,
            },
      ledger:
        this.mode === 'fabric'
          ? { ...this.ledgerInfo }
          : {
              height: null,
              currentBlockHash: null,
              observedAt: null,
            },
      explorer: {
        enabled: explorerEnabled,
        state:
          this.mode === 'fabric' && explorerEnabled
            ? this.explorerState.state
            : 'disabled',
        publicUrl: explorerPublicUrl,
      },
      errorCodes: [...blocking, ...warnings],
    }
  }

  getChaincodeAbiVersion(): 1 | 2 {
    return this.chaincodeAbiVersion
  }

  /**
   * PROP-399 D2: chaincode đang chạy có chấp nhận evidence schema `version` không.
   * Simulation không có chaincode để nâng cấp nên luôn đáp ứng.
   */
  supportsEvidenceSchemaVersion(version: number): boolean {
    if (this.mode === 'simulation') return true
    return this.chaincodeEvidenceSchemaVersions.includes(version)
  }
}
