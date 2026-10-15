import { MockSmartCaProvider } from './mock-smartca.provider'

describe('MockSmartCaProvider', () => {
  const request = {
    transactionId: 'mock-transaction-1',
    artifactHash: 'a'.repeat(64),
    signerCccd: '000000000001',
    certificateSerial: 'MOCK-CERT-001',
    documentId: 'contract-contract-1-r1',
  }

  afterEach(() => jest.restoreAllMocks())

  it('lists a single valid fake certificate for the signer', async () => {
    const provider = new MockSmartCaProvider()

    const certificates = await provider.listCertificates(request.signerCccd)

    expect(certificates).toHaveLength(1)
    expect(certificates[0]).toEqual(
      expect.objectContaining({
        serialNumber: 'MOCK-CERT-001',
        isValid: true,
      })
    )
  })

  it('accepts a sign request without any user credential and returns the same transaction id', async () => {
    const provider = new MockSmartCaProvider()

    const result = await provider.requestSignature(request)

    expect(result.transactionId).toBe(request.transactionId)
    expect(result).not.toHaveProperty('sad')
    expect(provider).not.toHaveProperty('confirmSignature')
  })

  it('keeps the transaction pending while the signer has not approved yet', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const provider = new MockSmartCaProvider()
    await provider.requestSignature(request)

    now.mockReturnValue(1_000_000 + 2_999)
    const status = await provider.getSignatureStatus(
      request.transactionId,
      request.documentId
    )

    expect(status).toEqual({
      transactionId: request.transactionId,
      status: 'pending',
    })
  })

  it('returns a signature for the requested document once the approval delay passed', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const provider = new MockSmartCaProvider()
    await provider.requestSignature(request)

    now.mockReturnValue(1_000_000 + 3_000)
    const status = await provider.getSignatureStatus(
      request.transactionId,
      request.documentId
    )

    expect(status.status).toBe('signed')
    expect(status.signature?.documentId).toBe(request.documentId)
    expect(status.signature?.signatureValue).toBeTruthy()
  })

  it('reports pending for a transaction it never received', async () => {
    const provider = new MockSmartCaProvider()

    const status = await provider.getSignatureStatus(
      'unknown-transaction',
      request.documentId
    )

    expect(status).toEqual({
      transactionId: 'unknown-transaction',
      status: 'pending',
    })
  })
})
