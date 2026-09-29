import { Injectable } from '@nestjs/common'
import { createHash, randomBytes } from 'crypto'
import type {
  SmartCaCertificate,
  SmartCaConfirmResult,
  SmartCaSignResult,
  SmartCaSignature,
  SmartCaSigningRequest,
  SmartCaStatusResult,
} from './smartca.provider'

/**
 * MockSmartCaProvider — giả lập SmartCA hoàn toàn offline.
 * Được inject thay thế SmartCaProvider khi SMARTCA_ENV=mock.
 *
 * Luồng giả lập:
 *  listCertificates   → trả 1 cert fake "MOCK-CERT-001"
 *  requestSignature   → trả sad + transactionId ngay lập tức
 *  confirmSignature   → trả signature fake (SHA-256 của artifactHash)
 *  getSignatureStatus → luôn trả 'signed'
 */
@Injectable()
export class MockSmartCaProvider {
  private static readonly MOCK_CERT_SERIAL = 'MOCK-CERT-001'
  private static readonly MOCK_ISSUER = 'CN=VNPT-CA Test, O=VNPT-IT, C=VN'
  private static readonly MOCK_SUBJECT_PREFIX = 'CN=MockUser-'

  listCertificates(signerCccd: string): Promise<SmartCaCertificate[]> {
    const now = new Date()
    const from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
    const to = new Date(now.getFullYear() + 2, now.getMonth(), now.getDate())

    return Promise.resolve([
      {
        serialNumber: MockSmartCaProvider.MOCK_CERT_SERIAL,
        status: 'ACTIVE',
        serviceType: 'SIGN',
        subject: `${MockSmartCaProvider.MOCK_SUBJECT_PREFIX}${signerCccd}`,
        issuer: MockSmartCaProvider.MOCK_ISSUER,
        validFrom: from.toISOString(),
        validTo: to.toISOString(),
        isValid: true,
      },
    ])
  }

  requestSignature(input: SmartCaSigningRequest): Promise<SmartCaSignResult> {
    // sad = base64 của randomBytes (giả lập token xác nhận)
    const sad = randomBytes(32).toString('base64url')
    return Promise.resolve({
      transactionId: input.transactionId,
      transactionCode: `MOCK-TC-${Date.now()}`,
      sad,
      expiresIn: 900, // 15 phút
    })
  }

  confirmSignature(input: {
    transactionId: string
    signerCccd: string
    password: string
    sad: string
    documentId: string
  }): Promise<SmartCaConfirmResult> {
    const signature = this.buildSignature(input.documentId, input.sad)
    return Promise.resolve({
      transactionId: input.transactionId,
      signature,
    })
  }

  getSignatureStatus(
    providerTransactionId: string,
    documentId: string
  ): Promise<SmartCaStatusResult> {
    const signature = this.buildSignature(documentId, providerTransactionId)
    return Promise.resolve({
      transactionId: providerTransactionId,
      status: 'signed',
      signature,
    })
  }

  // ─── private ───────────────────────────────────────────────────────────────

  private buildSignature(documentId: string, seed: string): SmartCaSignature {
    // signatureValue = SHA-256(documentId + seed) — deterministic & unique per doc
    const signatureValue = createHash('sha256')
      .update(`${documentId}:${seed}`)
      .digest('base64')

    return {
      documentId,
      signatureValue,
      signedAt: new Date().toISOString(),
    }
  }
}
