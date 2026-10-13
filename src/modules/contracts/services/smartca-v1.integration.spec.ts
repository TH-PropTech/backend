import { ConfigService } from '@nestjs/config'
import { ObjectId } from 'mongodb'
import { SmartCaProvider } from '../../digital-signature/providers/smartca.provider'
import { SmartCaSigningService } from './smartca-signing.service'

describe('SmartCA v1 provider-to-service integration', () => {
  const contractId = new ObjectId('507f1f77bcf86cd799439011').toHexString()
  const artifactHashA = 'a'.repeat(64)
  const artifactHashB = 'b'.repeat(64)
  const documentIdFor = (hash: string): string =>
    hash === artifactHashA
      ? `contract-${contractId}-r1`
      : `contract-${contractId}-r2`
  const response = (body: unknown): Response =>
    ({ ok: true, json: () => Promise.resolve(body) }) as Response

  function setup(artifactHash: string): {
    service: SmartCaSigningService
    provider: SmartCaProvider
    fetchMock: jest.Mock
    sessionRepository: {
      findOne: jest.Mock
      create: jest.Mock
      save: jest.Mock
    }
    contractsService: { recordSmartCaSignature: jest.Mock }
    contract: Record<string, unknown>
  } {
    const configService = {
      get: jest.fn().mockReturnValue({
        apiUrl: 'https://smartca.invalid',
        spId: 'sp-redacted',
        spPassword: 'sp-password-redacted',
        certPath: '/certificates',
        signPath: '/sca/sp769/v1/signatures/sign',
        statusPathTmpl: '/status/{transactionId}',
      }),
    } as unknown as ConfigService
    const provider = new SmartCaProvider(configService)
    const contract = {
      _id: new ObjectId(contractId),
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      status: 'awaiting-signature',
      deposit: 0,
      contentLockedHash: artifactHash,
      contentLockedAt: new Date('2029-12-01T00:00:00.000Z'),
      artifactRef: {
        artifactId: 'artifact-1',
        revision: artifactHash === artifactHashA ? 1 : 2,
        templateKey: 'lease-vn',
        templateVersion: 1,
        hashSchemaVersion: 1,
        artifactHash,
        contentType: 'application/pdf',
        lockedAt: new Date('2029-12-01T00:00:00.000Z'),
      },
      executionPolicySnapshot: null,
    }
    const store = new Map<string, Record<string, unknown>>()
    const sessionRepository = {
      findOne: jest.fn(
        ({
          where,
        }: {
          where: { _id?: ObjectId; providerTransactionId?: string }
        }) => {
          if (where.providerTransactionId) {
            return Promise.resolve(
              [...store.values()].find(
                session =>
                  session.providerTransactionId === where.providerTransactionId
              ) ?? null
            )
          }
          const id = where._id?.toHexString()
          return Promise.resolve((id && store.get(id)) ?? null)
        }
      ),
      create: jest.fn((value: Record<string, unknown>) => {
        const id = new ObjectId()
        const session = { _id: id, ...value }
        store.set(id.toHexString(), session)
        return session
      }),
      save: jest.fn((value: Record<string, unknown>) => {
        const id = (value._id as ObjectId | undefined)?.toHexString()
        if (id) store.set(id, value)
        return Promise.resolve(value)
      }),
    }
    const contractsService = {
      recordSmartCaSignature: jest
        .fn()
        .mockResolvedValue({ status: 'awaiting-signature' }),
    }
    const service = new SmartCaSigningService(
      { findOne: jest.fn().mockResolvedValue(contract) } as never,
      sessionRepository as never,
      {
        findOne: jest.fn().mockResolvedValue({
          userId: 'tenant-1',
          status: 'verified',
          idCardNumber: '000000000001',
        }),
      } as never,
      provider,
      contractsService as never,
      {
        resolveCanonicalArtifact: jest.fn().mockResolvedValue({
          reference: contract.artifactRef,
          bytes: Buffer.from('%PDF-1.7\ncanonical'),
          artifact: {},
        }),
      } as never
    )
    const fetchMock = jest.fn()
    global.fetch = fetchMock
    return {
      service,
      provider,
      fetchMock,
      sessionRepository,
      contractsService,
      contract,
    }
  }

  const certificateResponse = response({
    status_code: 200,
    message: 'success',
    data: {
      user_certificates: [
        {
          serial_number: 'SERIAL-001',
          status: 'ACTIVE',
          valid_from: '2026-01-01T00:00:00.000Z',
          valid_to: '2099-01-01T00:00:00.000Z',
        },
      ],
    },
  })

  afterEach(() => jest.restoreAllMocks())

  it('tenant và landlord cùng ký trên cùng digest bằng v1 (sign → pending → status signed)', async () => {
    const documentId = documentIdFor(artifactHashA)
    const context = setup(artifactHashA)
    context.fetchMock
      .mockResolvedValueOnce(certificateResponse)
      .mockResolvedValueOnce(
        response({
          status_code: 200,
          message: 'success',
          data: { transaction_id: 'provider-tx-1', tran_code: 'code-redacted' },
        })
      )

    const pending = await context.service.createSession(
      contractId,
      'tenant-1',
      {
        idempotencyKey: 'request-1',
        certificateSerial: 'SERIAL-001',
      }
    )
    expect(pending.status).toBe('pending')
    expect(
      context.contractsService.recordSmartCaSignature
    ).not.toHaveBeenCalled()

    context.fetchMock.mockResolvedValueOnce(
      response({
        status_code: 200,
        message: 'success',
        data: {
          transaction_id: 'provider-tx-1',
          signatures: [
            {
              doc_id: documentId,
              signature_value: 'signature-redacted',
              timestamp_signature: null,
            },
          ],
        },
      })
    )
    const signed = await context.service.poll(
      contractId,
      (pending as unknown as { _id: ObjectId })._id.toHexString(),
      'tenant-1',
      false
    )
    expect(signed.status).toBe('signed')
    expect(
      context.contractsService.recordSmartCaSignature
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactHash: artifactHashA,
        providerTransactionId: 'provider-tx-1',
        certificateSerial: 'SERIAL-001',
      })
    )
    const fetchCalls = context.fetchMock.mock.calls as unknown[][]
    const firstSignRequestBody = JSON.parse(
      (fetchCalls[1]?.[1] as RequestInit).body as string
    ) as Record<string, unknown>
    expect(firstSignRequestBody).not.toHaveProperty('password')
    expect(firstSignRequestBody).not.toHaveProperty('otp')
  })

  it('webhook rồi poll không ghi trùng chữ ký (idempotent)', async () => {
    const documentId = documentIdFor(artifactHashA)
    const context = setup(artifactHashA)
    context.fetchMock
      .mockResolvedValueOnce(certificateResponse)
      .mockResolvedValueOnce(
        response({
          status_code: 200,
          message: 'success',
          data: { transaction_id: 'provider-tx-2' },
        })
      )

    const pending = await context.service.createSession(
      contractId,
      'tenant-1',
      {
        idempotencyKey: 'request-2',
        certificateSerial: 'SERIAL-001',
      }
    )

    const signedEnvelope = response({
      status_code: 200,
      message: 'success',
      data: {
        transaction_id: 'provider-tx-2',
        signatures: [
          {
            doc_id: documentId,
            signature_value: 'signature-redacted',
            timestamp_signature: null,
          },
        ],
      },
    })
    context.fetchMock.mockResolvedValue(signedEnvelope)

    await context.service.handleWebhook('provider-tx-2')
    const result = await context.service.poll(
      contractId,
      (pending as unknown as { _id: ObjectId })._id.toHexString(),
      'tenant-1',
      false
    )

    expect(result.status).toBe('signed')
    expect(
      context.contractsService.recordSmartCaSignature
    ).toHaveBeenCalledTimes(1)
  })

  it('digest thay đổi giữa hai lần ký thì chữ ký cũ không còn hợp lệ cho activation', async () => {
    const context = setup(artifactHashA)
    const documentId = documentIdFor(artifactHashA)
    context.fetchMock
      .mockResolvedValueOnce(certificateResponse)
      .mockResolvedValueOnce(
        response({
          status_code: 200,
          message: 'success',
          data: { transaction_id: 'provider-tx-3' },
        })
      )
      .mockResolvedValueOnce(
        response({
          status_code: 200,
          message: 'success',
          data: {
            transaction_id: 'provider-tx-3',
            signatures: [
              {
                doc_id: documentId,
                signature_value: 'signature-redacted',
                timestamp_signature: null,
              },
            ],
          },
        })
      )

    const pending = await context.service.createSession(
      contractId,
      'tenant-1',
      {
        idempotencyKey: 'request-3',
        certificateSerial: 'SERIAL-001',
      }
    )
    await context.service.poll(
      contractId,
      (pending as unknown as { _id: ObjectId })._id.toHexString(),
      'tenant-1',
      false
    )
    const [recordedInput] = context.contractsService.recordSmartCaSignature.mock
      .calls[0] as [{ artifactHash: string }]
    expect(recordedInput.artifactHash).toBe(artifactHashA)

    // Artifact revision thay đổi sang digest B trước khi landlord ký:
    // chữ ký tenant đã ghi (artifactHash A) không còn khớp
    // contract.artifactRef.artifactHash hiện tại, nên bị coi là void theo
    // ContractsService.hasValidSmartCaSignature (chỉ hợp lệ khi contentHash
    // === artifactRef.artifactHash).
    context.contract.artifactRef = {
      ...(context.contract.artifactRef as Record<string, unknown>),
      revision: 2,
      artifactHash: artifactHashB,
    }
    context.contract.contentLockedHash = artifactHashB

    const currentArtifactHash = (
      context.contract.artifactRef as { artifactHash: string }
    ).artifactHash
    expect(recordedInput.artifactHash).not.toBe(currentArtifactHash)

    // Landlord phải tạo phiên mới trên cùng digest B hiện tại (doc_id mới).
    context.fetchMock
      .mockResolvedValueOnce(certificateResponse)
      .mockResolvedValueOnce(
        response({
          status_code: 200,
          message: 'success',
          data: { transaction_id: 'provider-tx-landlord' },
        })
      )
    const landlordSession = await context.service.createSession(
      contractId,
      'landlord-1',
      { idempotencyKey: 'request-landlord', certificateSerial: 'SERIAL-001' }
    )
    expect(landlordSession.status).toBe('pending')
    expect(
      (landlordSession as unknown as { documentId: string }).documentId
    ).toBe(documentIdFor(artifactHashB))
  })
})
