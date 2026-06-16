import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as grpc from '@grpc/grpc-js'
import {
  connect,
  Gateway,
  Identity,
  Signer,
  signers,
} from '@hyperledger/fabric-gateway'
import { BlockchainLog } from './schemas/blockchain-log.schema'

interface PeerConfig {
  url?: string
}

interface ConnectionProfile {
  peers?: Record<string, PeerConfig>
}

@Injectable()
export class FabricService implements OnModuleInit {
  private readonly logger = new Logger(FabricService.name)
  private gateway: Gateway | null = null
  private isSimulationMode = true

  private mspId = ''
  private channelName = ''
  private chaincodeName = ''

  constructor(
    @InjectRepository(BlockchainLog)
    private readonly logRepository: Repository<BlockchainLog>,
    private readonly configService: ConfigService
  ) {}

  onModuleInit(): void {
    const enabled = this.configService.get<string>('FABRIC_ENABLED') === 'true'
    if (!enabled) {
      this.logger.warn(
        'Fabric integration is disabled. Running in Simulation Mode.'
      )
      return
    }

    try {
      this.mspId = this.configService.getOrThrow<string>('FABRIC_MSP_ID')
      this.channelName = this.configService.getOrThrow<string>('FABRIC_CHANNEL')
      this.chaincodeName =
        this.configService.getOrThrow<string>('FABRIC_CHAINCODE')

      const connectionProfilePath = this.configService.getOrThrow<string>(
        'FABRIC_CONNECTION_PROFILE'
      )
      const certPath = this.configService.getOrThrow<string>('FABRIC_CERT_PATH')
      const keyPath = this.configService.getOrThrow<string>('FABRIC_KEY_PATH')

      if (
        !fs.existsSync(connectionProfilePath) ||
        !fs.existsSync(certPath) ||
        !fs.existsSync(keyPath)
      ) {
        throw new Error('One or more Fabric credential files do not exist')
      }

      // Load certificate & private key
      const credentials = fs.readFileSync(certPath)
      const identity: Identity = { mspId: this.mspId, credentials }

      const privateKeyPem = fs.readFileSync(keyPath)
      const privateKey = crypto.createPrivateKey(privateKeyPem)
      const signer: Signer = signers.newPrivateKeySigner(privateKey)

      // Parse connection profile to get gRPC endpoint
      const profile = JSON.parse(
        fs.readFileSync(connectionProfilePath, 'utf8')
      ) as ConnectionProfile
      const peers = profile.peers ?? {}
      const peerName = Object.keys(peers)[0]
      if (!peerName) {
        throw new Error('No peers found in connection profile')
      }
      const peerUrl = peers[peerName]?.url
      if (!peerUrl) {
        throw new Error('Peer URL not found in connection profile')
      }
      const finalPeerUrl: string = peerUrl

      // Parse peer url for gRPC connection
      const cleanUrl = finalPeerUrl.replace(/^grpcs?:\/\//, '')
      const client = new grpc.Client(
        cleanUrl,
        grpc.credentials.createInsecure()
      )

      this.gateway = connect({
        client,
        identity,
        signer,
        evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
        submitOptions: () => ({ deadline: Date.now() + 30000 }),
        commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
      })

      this.isSimulationMode = false
      this.logger.log(
        `Successfully connected to Hyperledger Fabric channel: ${this.channelName}`
      )
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      this.logger.error(
        `Failed to initialize Fabric connection: ${errMsg}. Falling back to Simulation Mode.`
      )
      this.isSimulationMode = true
    }
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
  ): Promise<{ txHash: string; blockNumber: number; success: boolean }> {
    this.logger.log(
      `[submitTransaction] Action: ${action}, Args: ${JSON.stringify(args)}`
    )

    if (this.isSimulationMode) {
      const txHash = '0x' + crypto.randomBytes(32).toString('hex')
      const blockNumber = Math.floor(Math.random() * 100000) + 100

      // Write off-chain BlockchainLog to MongoDB
      const log = new BlockchainLog()
      log.action = action
      log.contractId = metadata.contractId ?? null
      log.paymentId = metadata.paymentId ?? null
      log.txHash = txHash
      log.blockNumber = blockNumber
      log.network = 'Simulation (Offline)'
      log.details = metadata.details ?? {}
      await this.logRepository.save(log)

      return { txHash, blockNumber, success: true }
    }

    try {
      if (!this.gateway) {
        throw new Error('Gateway not initialized')
      }
      const network = this.gateway.getNetwork(this.channelName)
      const contract = network.getContract(this.chaincodeName)

      // Submit transaction
      const resultBuffer = await contract.submitTransaction(action, ...args)
      const result = JSON.parse(resultBuffer.toString() || '{}') as Record<
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

      const mergedDetails: Record<string, unknown> = {}
      if (metadata.details) {
        Object.assign(mergedDetails, metadata.details)
      }
      Object.assign(mergedDetails, result)
      log.details = mergedDetails

      await this.logRepository.save(log)

      return { txHash, blockNumber, success: true }
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
      this.logger.log(
        '[evaluateTransaction] Running in Simulation Mode, returning mocked empty result'
      )
      return { message: 'Simulation mode data', action, args }
    }

    try {
      if (!this.gateway) {
        throw new Error('Gateway not initialized')
      }
      const network = this.gateway.getNetwork(this.channelName)
      const contract = network.getContract(this.chaincodeName)

      const resultBuffer = await contract.evaluateTransaction(action, ...args)
      return JSON.parse(resultBuffer.toString() || '{}') as unknown
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
