import { configuration } from './configuration'

describe('configuration() Fabric identities, Explorer and limits (PROP-399 task 6.2)', () => {
  const KEYS = [
    'FABRIC_CERT_PATH',
    'FABRIC_KEY_PATH',
    'FABRIC_WRITER_CERT_PATH',
    'FABRIC_WRITER_KEY_PATH',
    'FABRIC_READER_CERT_PATH',
    'FABRIC_READER_KEY_PATH',
    'FABRIC_OPERATOR_CERT_PATH',
    'FABRIC_OPERATOR_KEY_PATH',
    'FABRIC_EXPLORER_CERT_PATH',
    'FABRIC_EXPLORER_ENABLED',
    'FABRIC_EXPLORER_PUBLIC_URL',
    'FABRIC_EXPLORER_HEALTH_URL',
    'FABRIC_EXPLORER_TX_URL_TEMPLATE',
    'FABRIC_IDENTITY_EXPIRY_WARN_DAYS',
    'EVIDENCE_PACKAGE_MAX_FILES',
    'EVIDENCE_PACKAGE_MAX_BYTES',
    'FABRIC_RECONCILIATION_PAGE_SIZE',
    'FABRIC_RECONCILIATION_ORPHAN_PAGE_BUDGET',
    'FABRIC_RECONCILIATION_MAX_CONTRACTS',
  ]
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })
  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  it('exposes empty role identities, a disabled Explorer and documented defaults', () => {
    const config = configuration()
    expect(config.fabric.identities).toEqual({
      writer: { certPath: '', keyPath: '' },
      reader: { certPath: '', keyPath: '' },
      operator: { certPath: '', keyPath: '' },
    })
    expect(config.fabric.explorer).toEqual({
      enabled: false,
      publicUrl: undefined,
      healthUrl: undefined,
      certPath: '',
    })
    expect(config.fabric.identityExpiryWarnDays).toBe(30)
    expect(config.evidencePackage).toEqual({
      maxFiles: 50,
      maxBytes: 104857600,
    })
    expect(config.fabric.reconciliation).toEqual({
      pageSize: 100,
      orphanPageBudget: 10,
      maxContracts: 500,
    })
  })

  it('maps path-based role identities, Explorer settings and numeric limits from the environment', () => {
    process.env.FABRIC_WRITER_CERT_PATH = '/s/w/cert.pem'
    process.env.FABRIC_WRITER_KEY_PATH = '/s/w/key.pem'
    process.env.FABRIC_READER_CERT_PATH = '/s/r/cert.pem'
    process.env.FABRIC_READER_KEY_PATH = '/s/r/key.pem'
    process.env.FABRIC_OPERATOR_CERT_PATH = '/s/o/cert.pem'
    process.env.FABRIC_OPERATOR_KEY_PATH = '/s/o/key.pem'
    process.env.FABRIC_EXPLORER_CERT_PATH = '/s/e/cert.pem'
    process.env.FABRIC_EXPLORER_ENABLED = 'true'
    process.env.FABRIC_EXPLORER_PUBLIC_URL = 'https://explorer.example.com'
    process.env.FABRIC_EXPLORER_HEALTH_URL = 'http://explorer:8080/'
    process.env.FABRIC_IDENTITY_EXPIRY_WARN_DAYS = '14'
    process.env.EVIDENCE_PACKAGE_MAX_FILES = '20'
    process.env.EVIDENCE_PACKAGE_MAX_BYTES = '2097152'
    process.env.FABRIC_RECONCILIATION_PAGE_SIZE = '25'
    process.env.FABRIC_RECONCILIATION_ORPHAN_PAGE_BUDGET = '3'
    process.env.FABRIC_RECONCILIATION_MAX_CONTRACTS = '40'

    const config = configuration()
    expect(config.fabric.identities.writer).toEqual({
      certPath: '/s/w/cert.pem',
      keyPath: '/s/w/key.pem',
    })
    expect(config.fabric.identities.operator.keyPath).toBe('/s/o/key.pem')
    expect(config.fabric.explorer).toEqual({
      enabled: true,
      publicUrl: 'https://explorer.example.com',
      healthUrl: 'http://explorer:8080/',
      certPath: '/s/e/cert.pem',
    })
    expect(config.fabric.identityExpiryWarnDays).toBe(14)
    expect(config.evidencePackage).toEqual({ maxFiles: 20, maxBytes: 2097152 })
    expect(config.fabric.reconciliation).toEqual({
      pageSize: 25,
      orphanPageBudget: 3,
      maxContracts: 40,
    })
  })

  it('keeps the legacy single-identity paths readable for the compatibility window', () => {
    process.env.FABRIC_CERT_PATH = '/legacy/cert.pem'
    process.env.FABRIC_KEY_PATH = '/legacy/key.pem'
    const config = configuration()
    expect(config.fabric.certPath).toBe('/legacy/cert.pem')
    expect(config.fabric.keyPath).toBe('/legacy/key.pem')
  })
})
