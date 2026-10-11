import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { SmartCaProvider } from './smartca.provider'

describe('SmartCaProvider', () => {
  const configValue = {
    apiUrl: 'https://smartca.test',
    spId: 'partner-redacted',
    spPassword: 'partner-secret-redacted',
    certPath: '/certificate',
    signPath: '/sign',
    statusPathTmpl: '/status/{transactionId}',
  }
  const signerCccd = '000000000001'
  const documentId = 'contract-contract-1-r2'
  const artifactHash = 'a'.repeat(64)
  const signingRequest = {
    transactionId: 'client-transaction-1',
    artifactHash,
    signerCccd,
    certificateSerial: 'SERIAL-001',
    documentId,
  }

  function createProvider(
    config: Partial<typeof configValue> = configValue
  ): SmartCaProvider {
    const configService = { get: jest.fn().mockReturnValue(config) }
    return new SmartCaProvider(configService as unknown as ConfigService)
  }

  function jsonResponse(payload: unknown, ok = true): Response {
    return {
      ok,
      status: ok ? 200 : 502,
      json: () => Promise.resolve(payload),
    } as unknown as Response
  }

  function parseJsonBody(
    init: RequestInit | undefined
  ): Record<string, unknown> {
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body')
    const parsed = JSON.parse(init.body) as unknown
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error('Expected JSON object body')
    }
    return parsed as Record<string, unknown>
  }

  afterEach(() => jest.restoreAllMocks())

  it('fails closed when required VNPT configuration is missing', async () => {
    const provider = createProvider({})

    await expect(provider.listCertificates(signerCccd)).rejects.toBeInstanceOf(
      ServiceUnavailableException
    )
  })

  it('accepts a production certificate whose cert_status is a Vietnamese label and cert_status_code is VALID', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        status_code: 200,
        message: 'Success',
        data: {
          user_certificates: [
            {
              serial_number: 'SERIAL-PROD-001',
              service_type: 'SMARTCA',
              cert_status_code: 'VALID',
              cert_status: 'Đang hoạt động',
              cert_subject: 'CN=TEST,UID=CCCD:000000000000',
              cert_valid_from: '2026-01-01T00:00:00Z',
              cert_valid_to: '2099-01-01T00:00:00Z',
            },
          ],
        },
      })
    )
    const provider = createProvider()

    const [certificate] = await provider.listCertificates(signerCccd)

    expect(certificate).toMatchObject({
      serialNumber: 'SERIAL-PROD-001',
      isValid: true,
    })
  })

  it('maps an expired service pack (65000) to a specific error instead of a generic gateway failure', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        status_code: 65000,
        message:
          'Service pack has expired, please renew or contact the package administrator',
        data: null,
      })
    )
    const provider = createProvider()

    await expect(provider.listCertificates(signerCccd)).rejects.toThrow(
      'SMARTCA_SERVICE_PACK_EXPIRED'
    )
  })

  it('parses and sanitizes certificate metadata from the VNPT envelope', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        status_code: 200,
        message: 'Success',
        data: {
          user_certificates: [
            {
              cert_id: 'cert-id-redacted',
              cert_data: 'raw-certificate-must-not-leave-provider',
              chain: ['raw-chain-must-not-leave-provider'],
              serial: 'SERIAL-001',
              cert_status: 'ACTIVE',
              service_type: 'SMART_CA',
              cert_subject: 'CN=Test User',
              cert_issuer: 'CN=VNPT Test CA',
              cert_valid_from: '2026-01-01T00:00:00.000Z',
              cert_valid_to: '2099-01-01T00:00:00.000Z',
            },
          ],
        },
      })
    )
    const provider = createProvider()

    await expect(provider.listCertificates(signerCccd)).resolves.toEqual([
      {
        serialNumber: 'SERIAL-001',
        status: 'ACTIVE',
        serviceType: 'SMART_CA',
        subject: 'CN=Test User',
        issuer: 'CN=VNPT Test CA',
        validFrom: '2026-01-01T00:00:00.000Z',
        validTo: '2099-01-01T00:00:00.000Z',
        isValid: true,
      },
    ])
    const request = fetchMock.mock.calls[0]?.[1]
    const body = parseJsonBody(request) as {
      user_id?: string
      transaction_id?: string
    }
    expect(body.user_id).toBe(signerCccd)
    expect(body.transaction_id).toMatch(/^cert-/)
  })

  it('rejects a malformed certificate envelope', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse({ status_code: 200, message: 'Success', data: {} })
      )
    const provider = createProvider()

    await expect(provider.listCertificates(signerCccd)).rejects.toThrow(
      'SMARTCA_PROVIDER_RESPONSE_INVALID'
    )
  })

  it('sends a v1 sign request without any user credential and parses nested transaction data', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        status_code: 200,
        message: 'sig_wait_for_user_confirm',
        data: {
          transaction_id: 'vnpt-transaction-1',
          tran_code: 'transaction-code-redacted',
        },
      })
    )
    const provider = createProvider()

    await expect(provider.requestSignature(signingRequest)).resolves.toEqual({
      transactionId: 'vnpt-transaction-1',
      transactionCode: 'transaction-code-redacted',
    })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    const body = parseJsonBody(init)
    expect(url).toBe('https://smartca.test/sign')
    expect(init?.method).toBe('POST')
    expect(body).toEqual(
      expect.objectContaining({
        sp_id: 'partner-redacted',
        sp_password: 'partner-secret-redacted',
        user_id: signerCccd,
        transaction_id: 'client-transaction-1',
        serial_number: 'SERIAL-001',
      })
    )
    expect(body).not.toHaveProperty('password')
    expect(body).not.toHaveProperty('otp')
    expect(body).not.toHaveProperty('mobile_code')
    expect(body).not.toHaveProperty('sad')
    expect(body.sign_files).toEqual([
      {
        doc_id: documentId,
        file_type: 'pdf',
        sign_type: 'hash',
        data_to_be_signed: artifactHash,
      },
    ])
  })

  it.each([
    { status_code: 200, message: 'Success', data: {} },
    {
      status_code: 200,
      message: 'Success',
      data: { tran_code: 'code-without-transaction-id' },
    },
    { transaction_id: 'flat-response-must-not-be-accepted' },
  ])(
    'rejects sign responses missing the required nested transaction id',
    async payload => {
      jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(payload))
      const provider = createProvider()

      await expect(provider.requestSignature(signingRequest)).rejects.toThrow(
        'SMARTCA_PROVIDER_RESPONSE_INVALID'
      )
    }
  )

  it('maps a rejected sign status_code to a sanitized credential/request error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        status_code: 401,
        message: 'SP_CREDENTIAL_INVALID detail',
        data: null,
      })
    )
    const provider = createProvider()

    await expect(provider.requestSignature(signingRequest)).rejects.toThrow(
      'SMARTCA_CREDENTIAL_OR_REQUEST_REJECTED'
    )
  })

  it('does not expose a confirm step in the v1 flow', () => {
    expect(
      (createProvider() as unknown as Record<string, unknown>).confirmSignature
    ).toBeUndefined()
  })

  it('polls with POST empty body and parses the matching nested signature', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        status_code: 200,
        message: 'Success',
        data: {
          transaction_id: 'vnpt-transaction-1',
          signatures: [
            {
              doc_id: documentId,
              signature_value: 'signature-value-redacted',
              timestamp_signature: '2026-09-23T10:00:00.000Z',
            },
          ],
        },
      })
    )
    const provider = createProvider()

    await expect(
      provider.getSignatureStatus('vnpt-transaction-1', documentId)
    ).resolves.toEqual({
      transactionId: 'vnpt-transaction-1',
      status: 'signed',
      signature: {
        documentId,
        signatureValue: 'signature-value-redacted',
        signedAt: '2026-09-23T10:00:00.000Z',
      },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://smartca.test/status/vnpt-transaction-1',
      expect.objectContaining({ method: 'POST', body: '{}' })
    )
  })

  it('maps pending status without fabricating a signature', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        status_code: 200,
        message: 'sig_wait_for_user_confirm',
        data: { transaction_id: 'vnpt-transaction-1', signatures: [] },
      })
    )
    const provider = createProvider()

    await expect(
      provider.getSignatureStatus('vnpt-transaction-1', documentId)
    ).resolves.toEqual({
      transactionId: 'vnpt-transaction-1',
      status: 'pending',
    })
  })

  it('maps transport, malformed JSON, HTTP and provider status failures to typed safe errors', async () => {
    const provider = createProvider()
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('timeout'))
    await expect(provider.listCertificates(signerCccd)).rejects.toBeInstanceOf(
      ServiceUnavailableException
    )

    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('invalid json')),
    } as unknown as Response)
    await expect(provider.listCertificates(signerCccd)).rejects.toBeInstanceOf(
      BadGatewayException
    )

    jest.spyOn(global, 'fetch').mockResolvedValueOnce(jsonResponse({}, false))
    await expect(provider.listCertificates(signerCccd)).rejects.toBeInstanceOf(
      BadGatewayException
    )

    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        status_code: 500,
        message: 'internal detail',
        data: null,
      })
    )
    await expect(provider.listCertificates(signerCccd)).rejects.toThrow(
      'SMARTCA_REQUEST_FAILED'
    )
  })

  it('never includes SP credential, CCCD or signature values in thrown errors', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        status_code: 200,
        message: 'Success',
        data: {
          transaction_id: 'vnpt-transaction-1',
          signatures: [
            { doc_id: 'another-document', signature_value: 'signature-leak' },
          ],
        },
      })
    )
    const provider = createProvider()

    let thrown: unknown
    try {
      await provider.getSignatureStatus('vnpt-transaction-1', documentId)
    } catch (error: unknown) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(BadGatewayException)
    const serialized = JSON.stringify(thrown)
    expect(serialized).not.toContain('partner-secret-redacted')
    expect(serialized).not.toContain(signerCccd)
    expect(serialized).not.toContain('signature-leak')
  })
})
