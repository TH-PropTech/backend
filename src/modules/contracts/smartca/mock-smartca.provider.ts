import { Injectable } from '@nestjs/common'
import { createHash } from 'crypto'
import type {
  SmartCaCertificate,
  SmartCaSignResult,
  SmartCaSignV2Request,
  SmartCaSignV2Result,
  SmartCaSignature,
  SmartCaSigningRequest,
  SmartCaStatusResult,
} from './smartca.provider'

/**
 * MockSmartCaProvider — giả lập SmartCA v1 hoàn toàn offline.
 * Được inject thay thế SmartCaProvider khi SMARTCA_ENV=mock.
 *
 * Luồng giả lập (người ký "duyệt trong app" sau MOCK_APPROVAL_DELAY_MS):
 *  listCertificates   → trả 1 cert fake "MOCK-CERT-001"
 *  requestSignature   → ghi nhận giao dịch, trả transactionId (chưa có chữ ký)
 *  getSignatureStatus → 'pending' trước hạn duyệt, sau đó 'signed'
 */
@Injectable()
export class MockSmartCaProvider {
  private static readonly MOCK_CERT_SERIAL = 'MOCK-CERT-001'
  private static readonly MOCK_ISSUER = 'CN=VNPT-CA Test, O=VNPT-IT, C=VN'
  private static readonly MOCK_SUBJECT_PREFIX = 'CN=MockUser-'
  private static readonly MOCK_APPROVAL_DELAY_MS = 3000

  private readonly requestedAt = new Map<string, number>()

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
    this.requestedAt.set(input.transactionId, Date.now())
    return Promise.resolve({
      transactionId: input.transactionId,
      transactionCode: `MOCK-TC-${Date.now()}`,
    })
  }

  /** v2 giả lập: chấp nhận mọi mật khẩu/OTP không rỗng, trả chữ ký ngay (không cần sad). */
  signV2(input: SmartCaSignV2Request): Promise<SmartCaSignV2Result> {
    if (!input.password || !input.otp) {
      return Promise.reject(new Error('MOCK_CREDENTIAL_REJECTED'))
    }
    return Promise.resolve({
      transactionId: input.transactionId,
      signature: this.buildSignature(input.documentId, input.transactionId),
    })
  }

  confirmV2(input: {
    transactionId: string
    documentId: string
  }): Promise<SmartCaSignature> {
    return Promise.resolve(
      this.buildSignature(input.documentId, input.transactionId)
    )
  }

  getSignatureStatus(
    providerTransactionId: string,
    documentId: string
  ): Promise<SmartCaStatusResult> {
    const requestedAt = this.requestedAt.get(providerTransactionId)
    const approved =
      requestedAt !== undefined &&
      Date.now() - requestedAt >= MockSmartCaProvider.MOCK_APPROVAL_DELAY_MS
    if (!approved) {
      return Promise.resolve({
        transactionId: providerTransactionId,
        status: 'pending',
      })
    }
    return Promise.resolve({
      transactionId: providerTransactionId,
      status: 'signed',
      signature: this.buildSignature(documentId, providerTransactionId),
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
