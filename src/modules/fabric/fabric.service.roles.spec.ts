import { Logger } from '@nestjs/common'
import { X509Certificate } from 'node:crypto'
import { connect } from '@hyperledger/fabric-gateway'
import { FabricService } from './fabric.service'
import {
  TEST_IDENTITY_CERT_PEM,
  TEST_IDENTITY_CERT_PEM_2,
  TEST_IDENTITY_CERT_PEM_3,
} from './fabric-identity.fixtures'

jest.mock('@hyperledger/fabric-gateway', () => ({
  connect: jest.fn(),
  signers: { newPrivateKeySigner: jest.fn(() => ({})) },
}))

jest.mock('@grpc/grpc-js', () => ({
  Client: jest.fn(() => ({ close: jest.fn() })),
  credentials: { createSsl: jest.fn() },
}))

jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof import('crypto')>('crypto')
  return { ...actual, createPrivateKey: jest.fn(() => ({})) }
})

// Nội dung file giả lập, khớp theo hậu tố đường dẫn; đọc lười (lúc gọi) nên đổi được giữa các lần dựng lại.
const mockFiles = new Map<string, string>()
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs')
  return {
    ...actual,
    readFileSync: jest.fn((p: string) => {
      const normalized = p.replace(/\\/g, '/')
      for (const [suffix, content] of mockFiles) {
        if (normalized.endsWith(suffix)) return Buffer.from(content)
      }
      return Buffer.from('mock-file-content:' + p)
    }),
    existsSync: jest.fn(() => true),
    statSync: jest.fn(() => ({ isDirectory: (): boolean => false })),
    readdirSync: jest.fn(() => ['test_sk']),
  }
})

const mockConnect = connect as jest.Mock
const DAY = 24 * 60 * 60 * 1000

type Contract = {
  evaluateTransaction: jest.Mock
  submitAsync: jest.Mock
}
type FakeGateway = {
  close: jest.Mock
  getNetwork: jest.Mock
  contracts: Map<string, Contract>
  chaincode: Contract
  qscc: Contract
}

function chainInfoBytes(height: number, hash: number[]): Buffer {
  return Buffer.from([0x08, height, 0x12, hash.length, ...hash])
}

function okCommit(txId: string, blockNumber: bigint): unknown {
  return {
    getTransactionId: () => txId,
    getResult: () => Buffer.from('{}'),
    getStatus: () =>
      Promise.resolve({
        successful: true,
        code: 0,
        blockNumber,
        transactionId: txId,
      }),
  }
}

function failedCommit(code: number): unknown {
  return {
    getTransactionId: () => 'tx-failed',
    getResult: () => Buffer.from('{}'),
    getStatus: () =>
      Promise.resolve({
        successful: false,
        code,
        blockNumber: 9n,
        transactionId: 'tx-failed',
      }),
  }
}

function fakeGateway(label: string): FakeGateway {
  const chaincode: Contract = {
    evaluateTransaction: jest
      .fn()
      .mockResolvedValue(
        Buffer.from(
          JSON.stringify({ abiVersion: 2, evidenceSchemaVersions: [2, 3] })
        )
      ),
    submitAsync: jest.fn().mockResolvedValue(okCommit(`tx-${label}`, 12n)),
  }
  const qscc: Contract = {
    evaluateTransaction: jest
      .fn()
      .mockResolvedValue(chainInfoBytes(42, [0xde, 0xad])),
    submitAsync: jest.fn(),
  }
  const contracts = new Map<string, Contract>([
    ['proptech', chaincode],
    ['qscc', qscc],
  ])
  return {
    close: jest.fn(),
    contracts,
    chaincode,
    qscc,
    getNetwork: jest.fn(() => ({
      getContract: (name: string): Contract => contracts.get(name) ?? chaincode,
    })),
  }
}

describe('FabricService role gateways and readiness (PROP-399 tasks 6.3, 6.4, 6.6, 6.7)', () => {
  let logRepository: { save: jest.Mock; find: jest.Mock }
  let settings: Record<string, unknown>
  let warnSpyInstance: jest.SpyInstance | null = null

  function configService(): { get: jest.Mock; getOrThrow: jest.Mock } {
    const common: Record<string, string> = {
      FABRIC_MSP_ID: 'Org1MSP',
      FABRIC_CHANNEL_NAME: 'proptech-channel',
      FABRIC_CHAINCODE_NAME: 'proptech',
      FABRIC_TLS_CERT_PATH: 'tls.crt',
      FABRIC_PEER_ENDPOINT: 'localhost:7051',
      FABRIC_PEER_HOST_ALIAS: 'peer0.org1.example.com',
      FABRIC_CERT_PATH: 'legacy/cert.pem',
      FABRIC_KEY_PATH: 'legacy/key.pem',
    }
    return {
      get: jest.fn((key: string) => settings[key]),
      getOrThrow: jest.fn((key: string) => {
        if (common[key]) return common[key]
        throw new Error(`Missing config ${key}`)
      }),
    }
  }

  function roleSettings(): Record<string, unknown> {
    return {
      'fabric.enabled': true,
      'fabric.identities.writer.certPath': 'id/writer/cert.pem',
      'fabric.identities.writer.keyPath': 'id/writer/key.pem',
      'fabric.identities.reader.certPath': 'id/reader/cert.pem',
      'fabric.identities.reader.keyPath': 'id/reader/key.pem',
      'fabric.identities.operator.certPath': 'id/operator/cert.pem',
      'fabric.identities.operator.keyPath': 'id/operator/key.pem',
    }
  }

  async function start(
    gateways: FakeGateway[] = [
      fakeGateway('writer'),
      fakeGateway('reader'),
      fakeGateway('operator'),
    ]
  ): Promise<{
    service: FabricService
    writer: FakeGateway
    reader: FakeGateway
    operator: FakeGateway
  }> {
    for (const gateway of gateways) mockConnect.mockReturnValueOnce(gateway)
    const service = new FabricService(
      logRepository as never,
      configService() as never
    )
    await service.onModuleInit()
    return {
      service,
      writer: gateways[0] as FakeGateway,
      reader: gateways[1] as FakeGateway,
      operator: gateways[2] as FakeGateway,
    }
  }

  beforeEach(() => {
    mockConnect.mockReset()
    mockFiles.clear()
    mockFiles.set('id/writer/cert.pem', TEST_IDENTITY_CERT_PEM)
    mockFiles.set('id/reader/cert.pem', TEST_IDENTITY_CERT_PEM_2)
    mockFiles.set('id/operator/cert.pem', TEST_IDENTITY_CERT_PEM_3)
    mockFiles.set('legacy/cert.pem', TEST_IDENTITY_CERT_PEM)
    logRepository = {
      save: jest.fn((entity: unknown) => Promise.resolve(entity)),
      find: jest.fn().mockResolvedValue([]),
    }
    settings = roleSettings()
  })

  afterEach(() => {
    jest.useRealTimers()
    warnSpyInstance?.mockRestore()
    warnSpyInstance = null
  })

  describe('role-selected gateways with isolated identity material', () => {
    it('connects each role with its own certificate and uses the matching gateway per operation', async () => {
      const { service, writer, reader, operator } = await start()

      expect(mockConnect).toHaveBeenCalledTimes(3)
      const credentials = mockConnect.mock.calls.map(([options]) =>
        (
          options as { identity: { credentials: Buffer } }
        ).identity.credentials.toString()
      )
      expect(credentials).toEqual([
        TEST_IDENTITY_CERT_PEM,
        TEST_IDENTITY_CERT_PEM_2,
        TEST_IDENTITY_CERT_PEM_3,
      ])

      await service.submitTransaction('createContract', ['c-1'])
      await service.submitTransaction('publishGovernanceSnapshot', ['g-1'])
      await service.evaluateTransaction('readContract', ['c-1'])

      expect(writer.chaincode.submitAsync).toHaveBeenCalledTimes(1)
      expect(operator.chaincode.submitAsync).toHaveBeenCalledTimes(1)
      expect(operator.chaincode.submitAsync).toHaveBeenCalledWith(
        'publishGovernanceSnapshot',
        { arguments: ['g-1'] }
      )
      expect(reader.chaincode.submitAsync).not.toHaveBeenCalled()
      expect(reader.chaincode.evaluateTransaction).toHaveBeenCalledWith(
        'readContract',
        'c-1'
      )
      expect(writer.chaincode.evaluateTransaction).not.toHaveBeenCalledWith(
        'readContract',
        'c-1'
      )
    })

    it('shares one connection when every role resolves to the same legacy identity (compatibility mode)', async () => {
      settings = { 'fabric.enabled': true }
      const shared = fakeGateway('shared')
      mockConnect.mockReturnValueOnce(shared)
      const service = new FabricService(
        logRepository as never,
        configService() as never
      )
      await service.onModuleInit()

      expect(mockConnect).toHaveBeenCalledTimes(1)
      await service.submitTransaction('createContract', ['c-1'])
      await service.submitTransaction('publishGovernanceSnapshot', ['g-1'])
      expect(shared.chaincode.submitAsync).toHaveBeenCalledTimes(2)
      expect(service.getStatus().ready).toBe(true)
    })

    it('reconnecting one role leaves the other gateways untouched (cache isolation)', async () => {
      const { service, writer, reader, operator } = await start()
      writer.chaincode.submitAsync.mockRejectedValueOnce(
        new Error('14 UNAVAILABLE: No connection established')
      )
      await expect(
        service.submitTransaction('createContract', ['c-1'])
      ).rejects.toThrow()

      expect(writer.close).toHaveBeenCalledTimes(1)
      expect(reader.close).not.toHaveBeenCalled()
      expect(operator.close).not.toHaveBeenCalled()
      expect(service.getStatus().gateway?.state).toBe('unavailable')

      // Reader keeps serving reads while the writer is down.
      await expect(
        service.evaluateTransaction('readContract', ['c-1'])
      ).resolves.toBeDefined()
    })
  })

  describe('identity expiry readiness', () => {
    const notAfter = new X509Certificate(TEST_IDENTITY_CERT_PEM).validToDate

    function at(offsetMs: number): void {
      jest.useFakeTimers({
        now: new Date(notAfter.getTime() + offsetMs),
        doNotFake: [
          'nextTick',
          'setImmediate',
          'clearImmediate',
          'setInterval',
          'clearInterval',
          'setTimeout',
          'clearTimeout',
          'queueMicrotask',
        ],
      })
    }

    it('reports expiresAt per role and stays ready with FABRIC_IDENTITY_EXPIRING inside the warning window', async () => {
      at(-10 * DAY)
      settings['fabric.identityExpiryWarnDays'] = 30
      // Only the writer certificate (fixture 1) is near its end; others are 2126 fixtures with later dates.
      const { service } = await start()
      const status = service.getStatus()

      expect(status.ready).toBe(true)
      expect(status.identities?.writer).toMatchObject({
        state: 'expiring',
        expiringSoon: true,
        expiresAt: notAfter.toISOString(),
        errorCode: 'FABRIC_IDENTITY_EXPIRING',
      })
      expect(status.errorCodes).toContain('FABRIC_IDENTITY_EXPIRING')
      expect(status.errorCode).toBeNull()
    })

    it('fails readiness with FABRIC_IDENTITY_EXPIRED and never builds a gateway for the expired identity', async () => {
      at(2 * DAY)
      const { service } = await start()
      const status = service.getStatus()

      expect(status.ready).toBe(false)
      expect(status.errorCode).toBe('FABRIC_IDENTITY_EXPIRED')
      expect(status.identities?.writer.state).toBe('expired')
      expect(mockConnect).not.toHaveBeenCalledWith(
        expect.objectContaining({
          identity: expect.objectContaining({
            credentials: Buffer.from(TEST_IDENTITY_CERT_PEM),
          }) as unknown,
        })
      )
      const serialized = JSON.stringify(status)
      expect(serialized).not.toContain('BEGIN CERTIFICATE')
      expect(serialized).not.toContain('id/writer')
    })

    it('fails readiness with FABRIC_IDENTITY_INVALID for a certificate that cannot be parsed', async () => {
      mockFiles.set('id/reader/cert.pem', 'not a certificate')
      const { service } = await start()
      const status = service.getStatus()
      expect(status.ready).toBe(false)
      expect(status.identities?.reader).toMatchObject({
        state: 'invalid',
        errorCode: 'FABRIC_IDENTITY_INVALID',
        expiresAt: null,
      })
      expect(JSON.stringify(status)).not.toContain('not a certificate')
    })

    it('detects a connected identity that expires after startup on the next readiness refresh', async () => {
      at(-1 * DAY)
      const { service } = await start()
      expect(service.getStatus().ready).toBe(true)

      jest.setSystemTime(new Date(notAfter.getTime() + DAY))
      await service.refreshReadiness()

      expect(service.getStatus().ready).toBe(false)
      expect(service.getStatus().errorCode).toBe('FABRIC_IDENTITY_EXPIRED')
    })
  })

  describe('composite readiness', () => {
    it('reports ABI, supported evidence schema versions and ledger height/hash from qscc GetChainInfo', async () => {
      const { service, reader } = await start()
      const status = service.getStatus()

      expect(reader.qscc.evaluateTransaction).toHaveBeenCalledWith(
        'GetChainInfo',
        'proptech-channel'
      )
      expect(status.gateway).toEqual({ state: 'connected', abiVersion: 2 })
      expect(status.evidenceSchemaVersions).toEqual([2, 3])
      expect(status.ledger).toEqual({
        height: 42,
        currentBlockHash: 'dead',
        observedAt: expect.any(String) as string,
      })
      // Existing consumers keep working.
      expect(status).toMatchObject({
        mode: 'fabric',
        connectionState: 'connected',
        ready: true,
        channel: 'proptech-channel',
        chaincode: 'proptech',
        chaincodeAbiVersion: 2,
        errorCode: null,
      })
    })

    it('a failing GetChainInfo only nulls the height and never changes ready', async () => {
      const gateways = [
        fakeGateway('writer'),
        fakeGateway('reader'),
        fakeGateway('operator'),
      ]
      ;(gateways[1] as FakeGateway).qscc.evaluateTransaction.mockRejectedValue(
        new Error('qscc denied')
      )
      const { service } = await start(gateways)
      const status = service.getStatus()
      expect(status.ledger).toEqual({
        height: null,
        currentBlockHash: null,
        observedAt: null,
      })
      expect(status.ready).toBe(true)
    })

    it('never exposes certificate bytes, key paths or tx args in the status', async () => {
      const { service } = await start()
      const serialized = JSON.stringify(service.getStatus())
      for (const leaked of [
        'BEGIN CERTIFICATE',
        'cert.pem',
        'key.pem',
        'id/writer',
        'tls.crt',
      ]) {
        expect(serialized).not.toContain(leaked)
      }
    })

    it('is honest in simulation: disabled gateway, null ledger, no identities', async () => {
      settings = { 'fabric.enabled': false }
      const service = new FabricService(
        logRepository as never,
        configService() as never
      )
      await service.onModuleInit()
      const status = service.getStatus()
      expect(status).toMatchObject({
        mode: 'simulation',
        connectionState: 'disabled',
        ready: true,
        gateway: { state: 'disabled', abiVersion: null },
        ledger: { height: null, currentBlockHash: null, observedAt: null },
        explorer: { enabled: false, state: 'disabled', publicUrl: null },
      })
      expect(status.identities?.writer.state).toBe('disabled')
      expect(mockConnect).not.toHaveBeenCalled()
    })
  })

  describe('Explorer readiness is independent of the gateway', () => {
    const originalFetch = global.fetch
    afterEach(() => {
      global.fetch = originalFetch
    })

    it('is ready with a public URL only when its health endpoint answers', async () => {
      settings['fabric.explorer.enabled'] = true
      settings['fabric.explorer.healthUrl'] = 'http://explorer:8080/'
      settings['fabric.explorer.publicUrl'] = 'https://explorer.example.com'
      global.fetch = jest.fn().mockResolvedValue({ ok: true }) as never
      const { service } = await start()
      expect(service.getStatus().explorer).toEqual({
        enabled: true,
        state: 'ready',
        publicUrl: 'https://explorer.example.com',
      })
    })

    it('degrades without a link when Explorer is down, while Fabric stays ready', async () => {
      settings['fabric.explorer.enabled'] = true
      settings['fabric.explorer.healthUrl'] = 'http://explorer:8080/'
      settings['fabric.explorer.publicUrl'] = 'https://explorer.example.com'
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('ECONNREFUSED')) as never
      const { service } = await start()
      const status = service.getStatus()
      expect(status.explorer).toEqual({
        enabled: true,
        state: 'degraded',
        publicUrl: null,
      })
      expect(status.ready).toBe(true)
      expect(status.connectionState).toBe('connected')
      expect(status.errorCodes).toContain('FABRIC_EXPLORER_DEGRADED')
    })

    it('treats a non-2xx health response and a missing health URL as degraded', async () => {
      settings['fabric.explorer.enabled'] = true
      settings['fabric.explorer.publicUrl'] = 'https://explorer.example.com'
      const { service } = await start()
      expect(service.getStatus().explorer?.state).toBe('degraded')
      global.fetch = jest.fn().mockResolvedValue({ ok: false }) as never
      settings['fabric.explorer.healthUrl'] = 'http://explorer:8080/'
      await service.refreshReadiness()
      expect(service.getStatus().explorer?.state).toBe('degraded')
    })
  })

  describe('identity separation', () => {
    it('blocks production readiness while any role still uses the legacy shared identity', async () => {
      settings = { 'fabric.enabled': true, 'app.env': 'production' }
      mockConnect.mockReturnValueOnce(fakeGateway('shared'))
      const service = new FabricService(
        logRepository as never,
        configService() as never
      )
      await service.onModuleInit()
      const status = service.getStatus()
      expect(status.ready).toBe(false)
      expect(status.errorCode).toBe('FABRIC_IDENTITY_SEPARATION_REQUIRED')
    })

    it('only warns about the legacy shared identity outside production', async () => {
      settings = { 'fabric.enabled': true, 'app.env': 'development' }
      mockConnect.mockReturnValueOnce(fakeGateway('shared'))
      const service = new FabricService(
        logRepository as never,
        configService() as never
      )
      await service.onModuleInit()
      const status = service.getStatus()
      expect(status.ready).toBe(true)
      expect(status.errorCodes).toContain('FABRIC_IDENTITY_SEPARATION_REQUIRED')
    })

    it('blocks production readiness when Explorer resolves to the writer credential, without leaking secrets', async () => {
      settings['app.env'] = 'production'
      settings['fabric.explorer.certPath'] = 'id/explorer/cert.pem'
      mockFiles.set('id/explorer/cert.pem', TEST_IDENTITY_CERT_PEM) // == writer
      const { service } = await start()
      const status = service.getStatus()
      expect(status.ready).toBe(false)
      expect(status.errorCode).toBe('FABRIC_IDENTITY_SEPARATION_REQUIRED')
      expect(JSON.stringify(status)).not.toContain('BEGIN CERTIFICATE')
    })

    it('blocks production readiness when two roles share the same certificate', async () => {
      settings['app.env'] = 'production'
      mockFiles.set('id/reader/cert.pem', TEST_IDENTITY_CERT_PEM)
      const { service } = await start()
      expect(service.getStatus().errorCode).toBe(
        'FABRIC_IDENTITY_SEPARATION_REQUIRED'
      )
    })

    it('is ready in production with distinct role identities and no Explorer certificate configured', async () => {
      settings['app.env'] = 'production'
      const { service } = await start()
      const status = service.getStatus()
      expect(status.ready).toBe(true)
      expect(status.errorCodes).not.toContain(
        'FABRIC_IDENTITY_SEPARATION_REQUIRED'
      )
    })
  })

  describe('task 6.6: commit status drives txHash and blockNumber', () => {
    it('takes txHash from getTransactionId() and blockNumber from the commit status', async () => {
      const { service, writer } = await start()
      writer.chaincode.submitAsync.mockResolvedValue(
        okCommit('tx-authentic', 4321n)
      )
      const result = await service.submitTransaction('recordPayment', ['p-1'])
      expect(result).toEqual({
        txHash: 'tx-authentic',
        blockNumber: 4321,
        success: true,
        networkMode: 'fabric',
      })
      expect(logRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          txHash: 'tx-authentic',
          blockNumber: 4321,
          networkMode: 'fabric',
        })
      )
    })

    it('keeps blockNumber null for an unsafe bigint instead of rounding it', async () => {
      const { service, writer } = await start()
      writer.chaincode.submitAsync.mockResolvedValue(
        okCommit('tx-big', BigInt(Number.MAX_SAFE_INTEGER) + 1n)
      )
      const result = await service.submitTransaction('recordPayment', ['p-1'])
      expect(result.blockNumber).toBeNull()
    })

    it('does not trust a txId inside the chaincode result payload', async () => {
      const { service, writer } = await start()
      const commit = okCommit('tx-from-gateway', 7n) as {
        getResult: () => Buffer
      }
      commit.getResult = (): Buffer =>
        Buffer.from(JSON.stringify({ txId: 'tx-spoofed', blockNumber: 999 }))
      writer.chaincode.submitAsync.mockResolvedValue(commit)
      const result = await service.submitTransaction('recordPayment', ['p-1'])
      expect(result.txHash).toBe('tx-from-gateway')
      expect(result.blockNumber).toBe(7)
    })

    it('maps a retryable validation code to an error the outbox will retry (no *_CONFLICT wording)', async () => {
      const { service, writer } = await start()
      writer.chaincode.submitAsync.mockResolvedValue(failedCommit(11))
      const error = (await service
        .submitTransaction('recordPayment', ['p-1'])
        .catch((e: unknown) => e)) as Error
      expect(error.message).toContain('FABRIC_COMMIT_RETRYABLE')
      expect(error.message).not.toMatch(/conflict/i)
      expect(logRepository.save).not.toHaveBeenCalled()
    })

    it('maps a non-retryable validation code to FABRIC_COMMIT_REJECTED', async () => {
      const { service, writer } = await start()
      writer.chaincode.submitAsync.mockResolvedValue(failedCommit(10))
      await expect(
        service.submitTransaction('recordPayment', ['p-1'])
      ).rejects.toThrow(/FABRIC_COMMIT_REJECTED: validation code 10/)
      expect(logRepository.save).not.toHaveBeenCalled()
    })

    it('never fabricates a block number in simulation', async () => {
      settings = { 'fabric.enabled': false }
      const service = new FabricService(
        logRepository as never,
        configService() as never
      )
      await service.onModuleInit()
      const result = await service.submitTransaction('recordPayment', ['p-1'])
      expect(result.blockNumber).toBeNull()
      expect(result.networkMode).toBe('simulation')
    })
  })

  describe('task 6.7: self-healing gateway', () => {
    function warnSpy(): jest.SpyInstance {
      warnSpyInstance = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation()
      return warnSpyInstance
    }

    it('marks the writer unavailable on a connection-level submit error, never retries inline, and reconnects on the next call', async () => {
      const { service, writer } = await start()
      writer.chaincode.submitAsync.mockRejectedValueOnce(
        new Error('14 UNAVAILABLE: No connection established')
      )
      const replacement = fakeGateway('writer-2')
      mockConnect.mockReturnValueOnce(replacement)

      await expect(
        service.submitTransaction('createContract', ['c-1'])
      ).rejects.toThrow(/Fabric transaction failed/)
      expect(writer.chaincode.submitAsync).toHaveBeenCalledTimes(1)
      expect(mockConnect).toHaveBeenCalledTimes(3) // no inline reconnect/resubmit

      // Outbox retry = next call: reconnects first, then submits once.
      const result = await service.submitTransaction('createContract', ['c-1'])
      expect(mockConnect).toHaveBeenCalledTimes(4)
      expect(replacement.chaincode.submitAsync).toHaveBeenCalledTimes(1)
      expect(result.txHash).toBe('tx-writer-2')
      expect(service.getStatus().connectionState).toBe('connected')
    })

    it('picks up rotated identity and TLS files on reconnect without a restart', async () => {
      const { service, writer } = await start()
      writer.chaincode.submitAsync.mockRejectedValueOnce(
        new Error('x509: certificate has expired or is not yet valid')
      )
      await expect(
        service.submitTransaction('createContract', ['c-1'])
      ).rejects.toThrow()
      expect(service.getStatus().errorCodes).toContain('FABRIC_TLS_INVALID')

      // Network reset: new identity written to the same configured path.
      mockFiles.set('id/writer/cert.pem', TEST_IDENTITY_CERT_PEM_3)
      mockFiles.set('tls.crt', 'NEW-TLS-ROOT')
      mockConnect.mockReturnValueOnce(fakeGateway('writer-new'))
      await service.submitTransaction('createContract', ['c-1'])

      const lastOptions = (
        mockConnect.mock.calls as unknown as unknown[][]
      )[3]?.[0] as {
        identity: { credentials: Buffer }
      }
      expect(lastOptions.identity.credentials.toString()).toBe(
        TEST_IDENTITY_CERT_PEM_3
      )
      expect(service.getStatus().ready).toBe(true)
    })

    it('does not reconnect on a business-level chaincode rejection', async () => {
      const { service, writer, reader, operator } = await start()
      writer.chaincode.submitAsync.mockRejectedValue(
        new Error(
          '10 ABORTED: transaction returned with failure: ERR_CONFLICT: x'
        )
      )
      await expect(
        service.submitTransaction('createContract', ['c-1'])
      ).rejects.toThrow(/ERR_CONFLICT/)

      expect(writer.close).not.toHaveBeenCalled()
      expect(reader.close).not.toHaveBeenCalled()
      expect(operator.close).not.toHaveBeenCalled()
      expect(mockConnect).toHaveBeenCalledTimes(3)
      expect(service.getStatus().connectionState).toBe('connected')
    })

    it('retries an evaluate exactly once after a successful reconnect', async () => {
      const { service, reader } = await start()
      const replacement = fakeGateway('reader-2')
      replacement.chaincode.evaluateTransaction
        .mockResolvedValueOnce(Buffer.from(JSON.stringify({ abiVersion: 2 }))) // health probe on reconnect
        .mockResolvedValueOnce(Buffer.from(JSON.stringify({ id: 'c-1' })))
      mockConnect.mockReturnValueOnce(replacement)
      reader.chaincode.evaluateTransaction.mockRejectedValueOnce(
        new Error('4 DEADLINE_EXCEEDED: Deadline exceeded')
      )

      await expect(
        service.evaluateTransaction('readContract', ['c-1'])
      ).resolves.toEqual({ id: 'c-1' })
      expect(reader.close).toHaveBeenCalledTimes(1)
      expect(mockConnect).toHaveBeenCalledTimes(4)
    })

    it('does not loop: a second connection-level failure after reconnect is surfaced', async () => {
      const { service, reader } = await start()
      const replacement = fakeGateway('reader-2')
      replacement.chaincode.evaluateTransaction
        .mockResolvedValueOnce(Buffer.from(JSON.stringify({ abiVersion: 2 })))
        .mockRejectedValue(new Error('14 UNAVAILABLE: again'))
      mockConnect.mockReturnValueOnce(replacement)
      reader.chaincode.evaluateTransaction.mockRejectedValueOnce(
        new Error('14 UNAVAILABLE: first')
      )
      await expect(
        service.evaluateTransaction('readContract', ['c-1'])
      ).rejects.toThrow(/Fabric query failed/)
      expect(mockConnect).toHaveBeenCalledTimes(4)
    })

    it('bounds reconnect attempts with the cooldown (no connect storm)', async () => {
      const { service, writer } = await start()
      writer.chaincode.submitAsync.mockRejectedValue(
        new Error('14 UNAVAILABLE: down')
      )
      mockConnect.mockImplementation(() => {
        throw new Error('connect ECONNREFUSED')
      })
      await expect(
        service.submitTransaction('createContract', ['c-1'])
      ).rejects.toThrow()
      await expect(
        service.submitTransaction('createContract', ['c-1'])
      ).rejects.toThrow(/FABRIC_GATEWAY_UNAVAILABLE/)
      await expect(
        service.submitTransaction('createContract', ['c-1'])
      ).rejects.toThrow(/FABRIC_GATEWAY_UNAVAILABLE/)
      // 3 initial + exactly one reconnect attempt inside the cooldown window.
      expect(mockConnect).toHaveBeenCalledTimes(4)
    })

    it('logs only the role and error category, never the raw error text', async () => {
      const warn = warnSpy()
      const { service, writer } = await start()
      writer.chaincode.submitAsync.mockRejectedValueOnce(
        new Error('14 UNAVAILABLE: secret-detail-10.0.0.7')
      )
      await expect(
        service.submitTransaction('createContract', ['c-1'])
      ).rejects.toThrow()
      const messages = (warn.mock.calls as unknown[][]).map(call =>
        String(call[0])
      )
      expect(messages.some(m => m.includes('[writer]'))).toBe(true)
      expect(messages.join('\n')).not.toContain('secret-detail')
    })
  })
})
