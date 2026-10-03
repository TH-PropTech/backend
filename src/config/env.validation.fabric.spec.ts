import { envValidationSchema } from './env.validation'

describe('envValidationSchema Fabric identities, Explorer and limits (PROP-399 task 6.1)', () => {
  const base = {
    DATABASE_URL: 'mongodb://localhost:27017/th_proptech_test',
    EKYC_SERVICE_URL: 'https://ekyc.example.com',
  }
  const liveCommon = {
    FABRIC_ENABLED: true,
    FABRIC_MSP_ID: 'Org1MSP',
    FABRIC_CHANNEL_NAME: 'proptech-channel',
    FABRIC_CHAINCODE_NAME: 'proptech',
    FABRIC_PEER_ENDPOINT: 'localhost:7051',
    FABRIC_PEER_HOST_ALIAS: 'peer0.org1.example.com',
    FABRIC_TLS_CERT_PATH: '/run/secrets/peer-tls-ca.crt',
  }
  const roleIdentities = {
    FABRIC_WRITER_CERT_PATH: '/run/secrets/writer/cert.pem',
    FABRIC_WRITER_KEY_PATH: '/run/secrets/writer/key.pem',
    FABRIC_READER_CERT_PATH: '/run/secrets/reader/cert.pem',
    FABRIC_READER_KEY_PATH: '/run/secrets/reader/key.pem',
    FABRIC_OPERATOR_CERT_PATH: '/run/secrets/operator/cert.pem',
    FABRIC_OPERATOR_KEY_PATH: '/run/secrets/operator/key.pem',
  }
  const production = {
    ...base,
    NODE_ENV: 'production',
    KYC_MEDIA_ENCRYPTION_KEY: 'a'.repeat(64),
  }

  function validate(env: Record<string, unknown>): {
    error?: { message: string }
    value: Record<string, unknown>
  } {
    return envValidationSchema.validate(env) as never
  }

  describe('defaults and boundaries', () => {
    it('applies safe defaults for every new setting', () => {
      const { error, value } = validate(base)
      expect(error).toBeUndefined()
      expect(value).toMatchObject({
        FABRIC_IDENTITY_EXPIRY_WARN_DAYS: 30,
        FABRIC_EXPLORER_ENABLED: false,
        EVIDENCE_PACKAGE_MAX_FILES: 50,
        EVIDENCE_PACKAGE_MAX_BYTES: 104857600,
        FABRIC_RECONCILIATION_PAGE_SIZE: 100,
        FABRIC_RECONCILIATION_ORPHAN_PAGE_BUDGET: 10,
        FABRIC_RECONCILIATION_MAX_CONTRACTS: 500,
      })
    })

    it.each([
      ['FABRIC_IDENTITY_EXPIRY_WARN_DAYS', 1, true],
      ['FABRIC_IDENTITY_EXPIRY_WARN_DAYS', 365, true],
      ['FABRIC_IDENTITY_EXPIRY_WARN_DAYS', 0, false],
      ['FABRIC_IDENTITY_EXPIRY_WARN_DAYS', -5, false],
      ['FABRIC_IDENTITY_EXPIRY_WARN_DAYS', 1.5, false],
      ['FABRIC_IDENTITY_EXPIRY_WARN_DAYS', 366, false],
      ['EVIDENCE_PACKAGE_MAX_FILES', 1, true],
      ['EVIDENCE_PACKAGE_MAX_FILES', 500, true],
      ['EVIDENCE_PACKAGE_MAX_FILES', 0, false],
      ['EVIDENCE_PACKAGE_MAX_FILES', 501, false],
      ['EVIDENCE_PACKAGE_MAX_BYTES', 1048576, true],
      ['EVIDENCE_PACKAGE_MAX_BYTES', 1073741824, true],
      ['EVIDENCE_PACKAGE_MAX_BYTES', 1048575, false],
      ['EVIDENCE_PACKAGE_MAX_BYTES', 1073741825, false],
      ['FABRIC_RECONCILIATION_PAGE_SIZE', 1, true],
      ['FABRIC_RECONCILIATION_PAGE_SIZE', 100, true],
      ['FABRIC_RECONCILIATION_PAGE_SIZE', 101, false],
      ['FABRIC_RECONCILIATION_PAGE_SIZE', 0, false],
      ['FABRIC_RECONCILIATION_ORPHAN_PAGE_BUDGET', 1, true],
      ['FABRIC_RECONCILIATION_ORPHAN_PAGE_BUDGET', 1000, true],
      ['FABRIC_RECONCILIATION_ORPHAN_PAGE_BUDGET', 0, false],
      ['FABRIC_RECONCILIATION_ORPHAN_PAGE_BUDGET', 1001, false],
      ['FABRIC_RECONCILIATION_MAX_CONTRACTS', 1, true],
      ['FABRIC_RECONCILIATION_MAX_CONTRACTS', 10000, true],
      ['FABRIC_RECONCILIATION_MAX_CONTRACTS', 0, false],
      ['FABRIC_RECONCILIATION_MAX_CONTRACTS', 10001, false],
    ])('%s=%s is %s', (key, value, ok) => {
      const { error } = validate({ ...base, [key]: value })
      if (ok) expect(error).toBeUndefined()
      else expect(error?.message).toContain(key)
    })
  })

  describe('Explorer URL and transaction template', () => {
    it('requires {txId} in the transaction template', () => {
      expect(
        validate({
          ...base,
          FABRIC_EXPLORER_TX_URL_TEMPLATE: 'https://explorer.example/tx/{txId}',
        }).error
      ).toBeUndefined()
      expect(
        validate({
          ...base,
          FABRIC_EXPLORER_TX_URL_TEMPLATE: 'https://explorer.example/tx',
        }).error?.message
      ).toContain('FABRIC_EXPLORER_TX_URL_TEMPLATE')
    })

    it('requires a public URL when Explorer is enabled', () => {
      expect(
        validate({ ...base, FABRIC_EXPLORER_ENABLED: true }).error?.message
      ).toContain('FABRIC_EXPLORER_PUBLIC_URL')
      expect(
        validate({
          ...base,
          FABRIC_EXPLORER_ENABLED: true,
          FABRIC_EXPLORER_PUBLIC_URL: 'http://localhost:8080',
        }).error
      ).toBeUndefined()
    })

    it.each([
      'http://explorer.example.com',
      'https://user:pass@explorer.example.com',
      'https://localhost',
      'https://127.0.0.1:8443',
      'https://explorer.example.com/path?token=x',
      'https://explorer.example.com/#frag',
    ])(
      'rejects the disallowed production Explorer origin %s with FABRIC_EXPLORER_URL_INVALID',
      url => {
        const { error } = validate({
          ...production,
          FABRIC_EXPLORER_ENABLED: true,
          FABRIC_EXPLORER_PUBLIC_URL: url,
        })
        expect(error?.message).toContain('FABRIC_EXPLORER_URL_INVALID')
      }
    )

    it('accepts an https production Explorer URL and an http health URL', () => {
      const { error } = validate({
        ...production,
        FABRIC_EXPLORER_ENABLED: true,
        FABRIC_EXPLORER_PUBLIC_URL: 'https://explorer.example.com/explorer',
        FABRIC_EXPLORER_HEALTH_URL: 'http://explorer:8080/',
      })
      expect(error).toBeUndefined()
    })

    it('rejects a non-http(s) health URL', () => {
      expect(
        validate({
          ...base,
          FABRIC_EXPLORER_HEALTH_URL: 'file:///etc/passwd',
        }).error?.message
      ).toContain('FABRIC_EXPLORER_HEALTH_URL')
    })
  })

  describe('identity separation and compatibility mode', () => {
    it('keeps the legacy single-identity setup valid outside production (compatibility window)', () => {
      const { error } = validate({
        ...base,
        ...liveCommon,
        FABRIC_CERT_PATH: '../blockchain/crypto/org1-user-msp/cert.pem',
        FABRIC_KEY_PATH: '../blockchain/crypto/org1-user-msp/keystore/',
      })
      expect(error).toBeUndefined()
    })

    it('accepts role-specific identities outside production without legacy paths', () => {
      expect(
        validate({ ...base, ...liveCommon, ...roleIdentities }).error
      ).toBeUndefined()
    })

    it('rejects compatibility mode (legacy paths only) in production with FABRIC_IDENTITY_SEPARATION_REQUIRED', () => {
      const { error } = validate({
        ...production,
        ...liveCommon,
        FABRIC_CERT_PATH: '/run/secrets/cert.pem',
        FABRIC_KEY_PATH: '/run/secrets/key.pem',
      })
      expect(error?.message).toContain('FABRIC_IDENTITY_SEPARATION_REQUIRED')
    })

    it('accepts complete role-specific identities in production without legacy paths', () => {
      expect(
        validate({ ...production, ...liveCommon, ...roleIdentities }).error
      ).toBeUndefined()
    })

    it.each(Object.keys(roleIdentities))(
      'rejects production when %s is missing',
      key => {
        const identities: Record<string, string> = { ...roleIdentities }
        delete identities[key]
        const { error } = validate({
          ...production,
          ...liveCommon,
          ...identities,
        })
        expect(error?.message).toContain('FABRIC_IDENTITY_SEPARATION_REQUIRED')
      }
    )

    it('rejects production when two roles share the same credential material', () => {
      const { error } = validate({
        ...production,
        ...liveCommon,
        ...roleIdentities,
        FABRIC_READER_CERT_PATH: roleIdentities.FABRIC_WRITER_CERT_PATH,
      })
      expect(error?.message).toContain('FABRIC_IDENTITY_SEPARATION_REQUIRED')
    })

    it('rejects a production Explorer certificate that points at a backend role certificate', () => {
      const { error } = validate({
        ...production,
        ...liveCommon,
        ...roleIdentities,
        FABRIC_EXPLORER_CERT_PATH: roleIdentities.FABRIC_WRITER_CERT_PATH,
      })
      expect(error?.message).toContain('FABRIC_IDENTITY_SEPARATION_REQUIRED')
    })

    it('does not constrain identities when Fabric is disabled, even in production', () => {
      expect(
        validate({ ...production, FABRIC_ENABLED: false }).error
      ).toBeUndefined()
    })

    it('never echoes a configured path in the separation error', () => {
      const { error } = validate({
        ...production,
        ...liveCommon,
        FABRIC_CERT_PATH: '/run/secrets/very-secret-cert.pem',
        FABRIC_KEY_PATH: '/run/secrets/very-secret-key.pem',
      })
      expect(error?.message).not.toContain('very-secret')
    })
  })
})
