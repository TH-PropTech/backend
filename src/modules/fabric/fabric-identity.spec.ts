import { X509Certificate } from 'node:crypto'
import { inspectCertificate } from './fabric-identity'
import {
  TEST_IDENTITY_CERT_PEM,
  TEST_IDENTITY_CERT_PEM_2,
} from './fabric-identity.fixtures'

describe('inspectCertificate (PROP-399 D5 identity expiry)', () => {
  const notAfter = new X509Certificate(TEST_IDENTITY_CERT_PEM).validToDate
  const day = 24 * 60 * 60 * 1000

  it('reports ok with expiresAt and a stable fingerprint far from expiry', () => {
    const result = inspectCertificate(
      TEST_IDENTITY_CERT_PEM,
      new Date(notAfter.getTime() - 400 * day),
      30
    )
    expect(result).toMatchObject({
      state: 'ok',
      expiringSoon: false,
      expiresAt: notAfter.toISOString(),
      errorCode: null,
    })
    expect(result.fingerprint).toMatch(/^[A-F0-9:]+$/)
    expect(
      inspectCertificate(TEST_IDENTITY_CERT_PEM_2, new Date(), 30).fingerprint
    ).not.toBe(result.fingerprint)
  })

  it('warns (still usable) inside the warning window with FABRIC_IDENTITY_EXPIRING', () => {
    const result = inspectCertificate(
      Buffer.from(TEST_IDENTITY_CERT_PEM),
      new Date(notAfter.getTime() - 10 * day),
      30
    )
    expect(result).toMatchObject({
      state: 'expiring',
      expiringSoon: true,
      errorCode: 'FABRIC_IDENTITY_EXPIRING',
      expiresAt: notAfter.toISOString(),
    })
  })

  it('treats exactly the window boundary as expiring and one day before as ok', () => {
    expect(
      inspectCertificate(
        TEST_IDENTITY_CERT_PEM,
        new Date(notAfter.getTime() - 30 * day),
        30
      ).state
    ).toBe('expiring')
    expect(
      inspectCertificate(
        TEST_IDENTITY_CERT_PEM,
        new Date(notAfter.getTime() - 31 * day),
        30
      ).state
    ).toBe('ok')
  })

  it('fails with FABRIC_IDENTITY_EXPIRED after NotAfter without leaking certificate content', () => {
    const result = inspectCertificate(
      TEST_IDENTITY_CERT_PEM,
      new Date(notAfter.getTime() + day),
      30
    )
    expect(result).toMatchObject({
      state: 'expired',
      errorCode: 'FABRIC_IDENTITY_EXPIRED',
    })
    expect(JSON.stringify(result)).not.toContain('BEGIN CERTIFICATE')
    expect(JSON.stringify(result)).not.toContain('thproptech-test')
  })

  it('fails closed on a certificate that is not yet valid', () => {
    const notBefore = new X509Certificate(TEST_IDENTITY_CERT_PEM).validFromDate
    const result = inspectCertificate(
      TEST_IDENTITY_CERT_PEM,
      new Date(notBefore.getTime() - day),
      30
    )
    expect(result.state).toBe('invalid')
    expect(result.errorCode).toBe('FABRIC_IDENTITY_INVALID')
  })

  it.each([
    ['garbage', 'mock-file-content:cert.pem'],
    ['empty', ''],
  ])('reports invalid for %s without echoing the input', (_label, input) => {
    const result = inspectCertificate(input, new Date(), 30)
    expect(result).toEqual({
      state: 'invalid',
      expiringSoon: false,
      expiresAt: null,
      fingerprint: null,
      errorCode: 'FABRIC_IDENTITY_INVALID',
    })
  })
})
