import { ConfigService } from '@nestjs/config'
import { ObjectId } from 'mongodb'
import { SmartCaProvider } from './smartca.provider'
import { SmartCaSigningService } from './smartca-signing.service'

describe('SmartCA v2 provider-to-service integration', () => {
  const contractId = new ObjectId('507f1f77bcf86cd799439011').toHexString()
  const artifactHash = 'a'.repeat(64)
  const documentId = `contract-${contractId}-r1`
  const response = (body: unknown): Response =>
    ({ ok: true, json: () => Promise.resolve(body) }) as Response

  function setup(): {
    service: SmartCaSigningService
    provider: SmartCaProvider
    fetchMock: jest.Mock
    sessionRepository: { save: jest.Mock }
    contractsService: { recordSmartCaSignature: jest.Mock }
  } {
    const configService = {
      get: jest.fn().mockReturnValue({
        apiUrl: 'https://smartca.invalid',
        spId: 'sp-redacted',
        spPassword: 'sp-password-redacted',
        certPath: '/certificates',
        signV2Path: '/sign/v2',
        confirmV2Path: '/confirm/v2',
        statusPathTmpl: '/status/{transactionId}',
      }),
    } as unknown as ConfigService
    const provider = new SmartCaProvider(configService)
    const sessionRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: Record<string, unknown>) => ({
        _id: new ObjectId(),
        ...value,
      })),
      save: jest.fn((value: Record<string, unknown>) => Promise.resolve(value)),
    }
    const contractsService = {
      recordSmartCaSignature: jest
        .fn()
        .mockResolvedValue({ status: 'awaiting-signature' }),
    }
    const service = new SmartCaSigningService(
      {
        findOne: jest.fn().mockResolvedValue({
          _id: new ObjectId(contractId),
          tenantId: 'tenant-1',
          landlordId: 'landlord-1',
          status: 'awaiting-signature',
          deposit: 0,
          contentLockedHash: artifactHash,
          contentLockedAt: new Date('2029-12-01T00:00:00.000Z'),
          artifactRef: {
            artifactId: 'artifact-1',
            revision: 1,
            templateKey: 'lease-vn',
            templateVersion: 1,
            hashSchemaVersion: 1,
            artifactHash,
            contentType: 'application/pdf',
            lockedAt: new Date('2029-12-01T00:00:00.000Z'),
          },
          executionPolicySnapshot: null,
        }),
      } as never,
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
          reference: {
            artifactId: 'artifact-1',
            revision: 1,
            artifactHash,
            contentType: 'application/pdf',
          },
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
    }
  }

  afterEach(() => jest.restoreAllMocks())

  it('maps official nested certificate, sign and confirm envelopes end to end', async () => {
    const context = setup()
    context.fetchMock
      .mockResolvedValueOnce(
        response({
          status_code: 200,
          message: 'success',
          data: {
            user_certificates: [
              {
                serial_number: 'SERIAL-001',
                status: 'ACTIVE',
                service_type: 'SMART_CA',
                subject_dn: 'CN=Test Tenant',
                issuer_dn: 'CN=VNPT Test CA',
                valid_from: '2026-01-01T00:00:00.000Z',
                valid_to: '2099-01-01T00:00:00.000Z',
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        response({
          status_code: 200,
          message: 'success',
          data: {
            transaction_id: 'provider-tx-1',
            tran_code: 'code-redacted',
            sad: 'sad-redacted',
            expired_in: 300,
          },
        })
      )
      .mockResolvedValueOnce(
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

    const session = await context.service.createSession(
      contractId,
      'tenant-1',
      {
        idempotencyKey: 'request-1',
        certificateSerial: 'SERIAL-001',
        smartCaPassword: 'password-redacted',
        smartCaOtp: '000000',
      }
    )

    expect(session.status).toBe('signed')
    expect(session.providerTransactionId).toBe('provider-tx-1')
    expect(session.signatureHash).toMatch(/^[a-f0-9]{64}$/)
    expect(
      context.contractsService.recordSmartCaSignature
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactHash,
        providerTransactionId: 'provider-tx-1',
        certificateSerial: 'SERIAL-001',
      })
    )
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
    await expect(
      context.provider.getSignatureStatus('provider-tx-1', documentId)
    ).resolves.toMatchObject({ status: 'signed' })
    const fetchCalls = context.fetchMock.mock.calls as unknown[][]
    const requestBodies = fetchCalls.map(call => {
      const init = call[1] as RequestInit
      return JSON.parse(init.body as string) as Record<string, unknown>
    })
    expect(requestBodies[1]).toEqual(
      expect.objectContaining({
        password: 'password-redacted',
        otp: '000000',
        sign_files: [
          expect.objectContaining({
            doc_id: documentId,
            data_to_be_signed: artifactHash,
          }),
        ],
      })
    )
  })

  it('rejects a flat sign payload and never persists signed evidence', async () => {
    const context = setup()
    context.fetchMock
      .mockResolvedValueOnce(
        response({
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
      )
      .mockResolvedValueOnce(
        response({
          status_code: 200,
          message: 'success',
          transaction_id: 'flat-transaction',
          sad: 'flat-sad',
          expired_in: 300,
        })
      )

    await expect(
      context.service.createSession(contractId, 'tenant-1', {
        idempotencyKey: 'request-malformed',
        certificateSerial: 'SERIAL-001',
        smartCaPassword: 'password-redacted',
        smartCaOtp: '000000',
      })
    ).rejects.toThrow('SMARTCA_PROVIDER_RESPONSE_INVALID')
    expect(
      context.contractsService.recordSmartCaSignature
    ).not.toHaveBeenCalled()
    expect(
      context.sessionRepository.save.mock.calls.some(
        ([session]: [{ status?: string }]) => session.status === 'signed'
      )
    ).toBe(false)
  })
})
