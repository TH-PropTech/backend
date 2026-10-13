import { X509Certificate } from 'node:crypto'

export type FabricIdentityState =
  | 'ok'
  | 'expiring'
  | 'expired'
  | 'invalid'
  | 'missing'

export type FabricIdentityInspection = {
  state: FabricIdentityState
  expiringSoon: boolean
  expiresAt: string | null
  /** SHA-256 fingerprint của chứng chỉ (công khai) — dùng so sánh tách biệt identity, không phải bí mật. */
  fingerprint: string | null
  errorCode: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * PROP-399 D5: đọc hạn chứng chỉ identity (NotAfter) mà không bao giờ trả lại nội dung
 * chứng chỉ/khóa. `now` được truyền vào để kiểm thử xác định.
 */
export function inspectCertificate(
  pem: Buffer | string,
  now: Date,
  warnDays: number
): FabricIdentityInspection {
  let certificate: X509Certificate
  try {
    certificate = new X509Certificate(pem)
  } catch {
    return {
      state: 'invalid',
      expiringSoon: false,
      expiresAt: null,
      fingerprint: null,
      errorCode: 'FABRIC_IDENTITY_INVALID',
    }
  }

  const notBefore = certificate.validFromDate
  const notAfter = certificate.validToDate
  const base = {
    expiresAt: notAfter.toISOString(),
    fingerprint: certificate.fingerprint256,
  }

  if (now.getTime() < notBefore.getTime()) {
    return {
      ...base,
      state: 'invalid',
      expiringSoon: false,
      errorCode: 'FABRIC_IDENTITY_INVALID',
    }
  }
  if (now.getTime() > notAfter.getTime()) {
    return {
      ...base,
      state: 'expired',
      expiringSoon: false,
      errorCode: 'FABRIC_IDENTITY_EXPIRED',
    }
  }
  if (notAfter.getTime() - now.getTime() <= warnDays * DAY_MS) {
    return {
      ...base,
      state: 'expiring',
      expiringSoon: true,
      errorCode: 'FABRIC_IDENTITY_EXPIRING',
    }
  }
  return { ...base, state: 'ok', expiringSoon: false, errorCode: null }
}
