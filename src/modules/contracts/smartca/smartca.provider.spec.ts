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
    mobileCode: 'mobile-redacted',
    certPath: '/certificate',
    signV2Path: '/sign',
    confirmV2Path: '/confirm',
    statusPathTmpl: '/status/{transactionId}',
  }
  const signerCccd = '000000000001'
  const password = 'user-password-redacted'
  const otp = '000000'
  const sad = 'sad-redacted'
  const documentId = 'contract-contract-1-r2'
  const artifactHash = 'a'.repeat(64)

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
    expect(parseJsonBody(request)).toEqual(
      expect.objectContaining({ user_id: signerCccd })
    )
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

  it('sends the complete v2 sign request and parses transaction data from nested data', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        status_code: 200,
        message: 'sig_wait_for_user_confirm',
        data: {
          transaction_id: 'vnpt-transaction-1',
          tran_code: 'transaction-code-redacted',
          sad,
          expired_in: 299,
        },
      })
    )
    const provider = createProvider()

    await expect(
      provider.requestSignature({
        transactionId: 'client-transaction-1',
        artifactHash,
        signerCccd,
        password,
        otp,
        certificateSerial: 'SERIAL-001',
        documentId,
      })
    ).resolves.toEqual({
      transactionId: 'vnpt-transaction-1',
      transactionCode: 'transaction-code-redacted',
      sad,
      expiresIn: 299,
    })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    const body = parseJsonBody(init)
    expect(url).toBe('https://smartca.test/sign')
    expect(init?.method).toBe('POST')
    expect(body).toEqual(
      expect.objectContaining({
        user_id: signerCccd,
        password,
        otp,
        transaction_id: 'client-transaction-1',
        serial_number: 'SERIAL-001',
      })
    )
    expect(body).not.toEqual(expect.objectContaining({ user_id: 'mongo-id' }))
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
    {
      status_code: 200,
      message: 'Success',
      data: { transaction_id: 'vnpt-transaction-1', expired_in: 299 },
    },
    { transaction_id: 'flat-response-must-not-be-accepted', sad },
  ])(
    'rejects sign responses missing the required nested SAD contract',
    async payload => {
      jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(payload))
      const provider = createProvider()

      await expect(
        provider.requestSignature({
          transactionId: 'client-transaction-1',
          artifactHash,
          signerCccd,
          password,
          otp,
          certificateSerial: 'SERIAL-001',
          documentId,
        })
      ).rejects.toThrow('SMARTCA_PROVIDER_RESPONSE_INVALID')
    }
  )

  it('confirms with SAD and selects the signature matching the requested document', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        status_code: 200,
        message: 'Success',
        data: {
          transaction_id: 'vnpt-transaction-1',
          expired_in: 299,
          signatures: [
            {
              doc_id: 'another-document',
              signature_value: 'wrong-signature',
              timestamp_signature: '2026-09-23T09:00:00.000Z',
            },
            {
              doc_id: documentId,
              signature_value: 'signature-value-redacted',
              timestamp_signature: null,
            },
          ],
        },
      })
    )
    const provider = createProvider()

    await expect(
      provider.confirmSignature({
        transactionId: 'vnpt-transaction-1',
        signerCccd,
        password,
        sad,
        documentId,
      })
    ).resolves.toEqual({
      transactionId: 'vnpt-transaction-1',
      signature: {
        documentId,
        signatureValue: 'signature-value-redacted',
        signedAt: null,
      },
    })
    const request = fetchMock.mock.calls[0]?.[1]
    expect(parseJsonBody(request)).toEqual(
      expect.objectContaining({ password, sad })
    )
  })

  it('rejects confirm when no signature matches the requested document', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        status_code: 200,
        message: 'Success',
        data: {
          transaction_id: 'vnpt-transaction-1',
          signatures: [
            { doc_id: 'another-document', signature_value: 'redacted' },
          ],
        },
      })
    )
    const provider = createProvider()

    await expect(
      provider.confirmSignature({
        transactionId: 'vnpt-transaction-1',
        signerCccd,
        password,
        sad,
        documentId,
      })
    ).rejects.toThrow('SMARTCA_PROVIDER_RESPONSE_INVALID')
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

  it('never includes credential, SAD, CCCD or signature values in thrown errors', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        status_code: 200,
        message: 'Success',
        data: { transaction_id: 'vnpt-transaction-1', signatures: [] },
      })
    )
    const provider = createProvider()

    let thrown: unknown
    try {
      await provider.confirmSignature({
        transactionId: 'vnpt-transaction-1',
        signerCccd,
        password,
        sad,
        documentId,
      })
    } catch (error: unknown) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(BadGatewayException)
    const serialized = JSON.stringify(thrown)
    expect(serialized).not.toContain(password)
    expect(serialized).not.toContain(otp)
    expect(serialized).not.toContain(sad)
    expect(serialized).not.toContain(signerCccd)
    expect(serialized).not.toContain('signature-value-redacted')
  })
})
