import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import forge from 'node-forge'
import PDFDocument from 'pdfkit'
import { ContractArtifactService } from './contract-artifact.service'
import { SignedArtifactService } from '../signed-artifact/signed-artifact.service'
import { CONTRACT_DOCUMENT_CANONICAL_UNIQUE_INDEX } from '../schemas/contract-document.schema'
import type { Contract } from '../schemas/contract.schema'

/**
 * G-DOC: hành vi quan sát được của artifact canonical (gồm bản sửa đổi) và bản
 * đã ký, trên collection chung `contract_documents` (kind='canonical'|'signed'). Repo giả lập mô phỏng Mongo:
 * lọc theo `where` và áp unique index khai báo trên entity.
 */

type Doc = Record<string, unknown>

type UniqueIndex = {
  columns: string[]
  appliesTo: (doc: Doc) => boolean
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b)
  return (a ?? null) === (b ?? null)
}

function matches(doc: Doc, where: Doc | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, value]) =>
    sameValue(doc[key], value)
  )
}

/** Mô phỏng một collection Mongo: unique index chỉ áp lên bản ghi `appliesTo`. */
function createFakeCollection(unique: UniqueIndex[]): {
  rows: Doc[]
  repo: {
    create: jest.Mock
    save: jest.Mock
    find: jest.Mock
    findOne: jest.Mock
  }
} {
  const rows: Doc[] = []
  const repo = {
    create: jest.fn((value: Doc) => ({ ...value })),
    save: jest.fn(async (value: Doc) => {
      await Promise.resolve()
      const existing = rows.find(
        row => row['_id'] instanceof ObjectId && row['_id'] === value['_id']
      )
      if (existing) {
        Object.assign(existing, value)
        return existing
      }
      for (const index of unique) {
        if (!index.appliesTo(value)) continue
        const clash = rows.some(
          row =>
            index.appliesTo(row) &&
            index.columns.every(column => sameValue(row[column], value[column]))
        )
        if (clash) {
          throw new Error(
            `E11000 duplicate key error (${index.columns.join(',')})`
          )
        }
      }
      const stored = { ...value, _id: value['_id'] ?? new ObjectId() }
      rows.push(stored)
      return stored
    }),
    find: jest.fn(async (options?: { where?: Doc }) => {
      await Promise.resolve()
      return rows.filter(row => matches(row, options?.where))
    }),
    findOne: jest.fn(async (options: { where: Doc }) => {
      await Promise.resolve()
      return rows.find(row => matches(row, options.where)) ?? null
    }),
  }
  return { rows, repo }
}

// --- Khác biệt lớp lưu trữ nằm trọn trong hai hàm dưới ---------------------

function uniqueIndexes(): UniqueIndex[] {
  // Unique canonical là partial index do migration 011 tạo; mô phỏng đúng
  // `partialFilterExpression` của nó. TypeORM chỉ khai báo index thường.
  const { keys, options } = CONTRACT_DOCUMENT_CANONICAL_UNIQUE_INDEX
  return [
    {
      columns: Object.keys(keys),
      appliesTo: doc => doc['kind'] === options.partialFilterExpression.kind,
    },
  ]
}

function createCollections(): {
  artifactRepo: ReturnType<typeof createFakeCollection>['repo']
  signedRepo: ReturnType<typeof createFakeCollection>['repo']
  artifactRows: () => Doc[]
  signedRows: () => Doc[]
} {
  // Một collection `contract_documents` dùng chung cho cả hai repo.
  const documents = createFakeCollection(uniqueIndexes())
  return {
    artifactRepo: documents.repo,
    signedRepo: documents.repo,
    artifactRows: () =>
      documents.rows.filter(row => row['kind'] === 'canonical'),
    signedRows: () => documents.rows.filter(row => row['kind'] === 'signed'),
  }
}

// ---------------------------------------------------------------------------

const PDF = Buffer.from('%PDF-1.7\nG-DOC canonical bytes')
const PDF_HASH = createHash('sha256').update(PDF).digest('hex')

function makeContract(): Contract {
  return {
    _id: new ObjectId(),
    contractCode: 'CT-DOC-1',
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
    contentLockedHash: PDF_HASH,
    contentLockedAt: new Date('2026-10-01T00:00:00.000Z'),
    contentRevision: 1,
    hashSchemaVersion: 1,
  } as unknown as Contract
}

function makeStorage(): {
  upload: jest.Mock
  download: jest.Mock
  files: Map<string, Buffer>
} {
  const files = new Map<string, Buffer>()
  return {
    files,
    upload: jest.fn((bytes: Buffer) => {
      const id = new ObjectId()
      files.set(id.toHexString(), bytes)
      return Promise.resolve(id)
    }),
    download: jest.fn((id: ObjectId) =>
      Promise.resolve(files.get(id.toHexString()) as Buffer)
    ),
  }
}

function makePdf(): Promise<Buffer> {
  return new Promise(resolve => {
    const doc = new PDFDocument({ compress: false })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.text('Hop dong')
    doc.end()
  })
}

function makeIdentity(): {
  privateKey: forge.pki.rsa.PrivateKey
  certPem: string
} {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.now() - 86_400_000)
  cert.validity.notAfter = new Date(Date.now() + 86_400_000)
  const attrs = [{ name: 'commonName', value: 'Signer' }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return {
    privateKey: keys.privateKey,
    certPem: forge.pki.certificateToPem(cert),
  }
}

function signHash(
  privateKey: forge.pki.rsa.PrivateKey,
  hashHex: string
): string {
  const md = {
    algorithm: 'sha256',
    digest: (): forge.util.ByteStringBuffer =>
      forge.util.createBuffer(forge.util.hexToBytes(hashHex)),
  }
  return forge.util.encode64(
    privateKey.sign(md as unknown as forge.md.MessageDigest)
  )
}

describe('G-DOC canonical artifact behaviour', () => {
  function buildArtifactService(contract: Contract): {
    service: ContractArtifactService
    artifactRows: () => Doc[]
    signedRows: () => Doc[]
    collections: ReturnType<typeof createCollections>
    storage: ReturnType<typeof makeStorage>
  } {
    const collections = createCollections()
    const storage = makeStorage()
    const contractRepository = {
      // Mỗi lần đọc trả bản sao riêng: mô phỏng hai request đồng thời.
      findOne: jest.fn(() => Promise.resolve({ ...contract })),
      save: jest.fn((value: Contract) => Promise.resolve(value)),
    }
    const service = new ContractArtifactService(
      contractRepository as never,
      collections.artifactRepo as never,
      storage
    )
    return {
      service,
      artifactRows: collections.artifactRows,
      signedRows: collections.signedRows,
      collections,
      storage,
    }
  }

  it('returns the pre-kind artifact shape and keeps GridFS id, hash and lock time', async () => {
    const contract = makeContract()
    const { service, artifactRows, storage } = buildArtifactService(contract)

    const locked = await service.lockCanonicalArtifact(
      contract._id.toHexString(),
      'staff-1',
      true,
      PDF
    )

    expect(artifactRows()).toHaveLength(1)
    expect(locked).toMatchObject({
      contractId: contract._id.toHexString(),
      revision: 1,
      artifactHash: PDF_HASH,
      canonicalContentHash: PDF_HASH,
      byteLength: PDF.length,
      contentType: 'application/pdf',
      lockedAt: contract.contentLockedAt,
    })
    expect(locked.gridFsFileId).toBeInstanceOf(ObjectId)
    expect(storage.files.get(locked.gridFsFileId.toHexString())).toEqual(PDF)
    expect(locked).not.toHaveProperty('kind')
    expect(locked).not.toHaveProperty('signerId')
  })

  it('lets only one of two concurrent canonical locks for the same (contractId, revision) win', async () => {
    const contract = makeContract()
    const { service, artifactRows } = buildArtifactService(contract)
    const id = contract._id.toHexString()

    const results = await Promise.allSettled([
      service.lockCanonicalArtifact(id, 'staff-1', true, PDF),
      service.lockCanonicalArtifact(id, 'staff-1', true, PDF),
    ])

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected'
    )
    expect(rejected).toHaveLength(1)
    expect(String(rejected[0]?.reason)).toContain('E11000')
    expect(artifactRows()).toHaveLength(1)
  })

  it('allows an amendment artifact next to the canonical one with a different amendmentId, but never a duplicate', async () => {
    const contract = makeContract()
    const { collections, service } = buildArtifactService(contract)
    await service.lockCanonicalArtifact(
      contract._id.toHexString(),
      'staff-1',
      true,
      PDF
    )

    await collections.artifactRepo.save({
      contractId: contract._id.toHexString(),
      revision: 1,
      amendmentId: 'am-1',
      ...kindFields('canonical'),
    })
    await expect(
      collections.artifactRepo.save({
        contractId: contract._id.toHexString(),
        revision: 1,
        amendmentId: 'am-1',
        ...kindFields('canonical'),
      })
    ).rejects.toThrow('E11000')
    expect(collections.artifactRows()).toHaveLength(2)
  })

  it('never resolves a signed row through the canonical artifact lookup by _id', async () => {
    const contract = makeContract()
    const { collections, service } = buildArtifactService(contract)
    const signed = (await collections.signedRepo.save({
      contractId: contract._id.toHexString(),
      revision: 1,
      status: 'ready',
      ...kindFields('signed'),
    })) as Doc
    const holder = {
      ...contract,
      artifactRef: {
        artifactId: String(signed['_id']),
        revision: 1,
        artifactHash: PDF_HASH,
        contentType: 'application/pdf',
        lockedAt: contract.contentLockedAt,
      },
    } as unknown as Contract

    await expect(service.resolveCanonicalArtifact(holder)).rejects.toThrow(
      'CONTRACT_ARTIFACT_NOT_FOUND'
    )
  })

  it('resolves a different canonical revision for export by (contractId, revision), ignoring amendment and signed rows', async () => {
    const contract = makeContract()
    const { collections, service } = buildArtifactService(contract)
    const id = contract._id.toHexString()
    const fileId = new ObjectId()
    // Phiên bản cũ r1 (canonical), một bản sửa đổi r1 và một bản đã ký r1.
    await collections.artifactRepo.save({
      contractId: id,
      revision: 1,
      artifactHash: 'b'.repeat(64),
      gridFsFileId: fileId,
      contentType: 'application/pdf',
      byteLength: 3,
      amendmentId: null,
      ...kindFields('canonical'),
    })
    await collections.artifactRepo.save({
      contractId: id,
      revision: 1,
      artifactHash: 'c'.repeat(64),
      gridFsFileId: new ObjectId(),
      contentType: 'application/pdf',
      byteLength: 3,
      amendmentId: 'am-1',
      ...kindFields('canonical'),
    })
    await collections.signedRepo.save({
      contractId: id,
      revision: 1,
      status: 'ready',
      sha256: 'd'.repeat(64),
      ...kindFields('signed'),
    })
    const current = {
      ...contract,
      artifactRef: {
        artifactId: new ObjectId().toHexString(),
        revision: 2,
        artifactHash: 'e'.repeat(64),
        contentType: 'application/pdf',
        lockedAt: contract.contentLockedAt,
      },
    } as unknown as Contract
    ;(service as unknown as { storage: Record<string, unknown> }).storage = {
      ...makeStorage(),
      openDownloadStream: jest.fn(),
    }

    const result = await service.openCanonicalArtifactForExport(current, 1)

    expect(result.recordedHash).toBe('b'.repeat(64))
    expect(result.artifact.gridFsFileId).toBe(fileId)
  })
})

/** Trường phân loại `kind` của entity ContractDocument. */
function kindFields(kind: 'canonical' | 'signed'): Doc {
  return { kind }
}

describe('G-DOC signed artifact behaviour', () => {
  const canonicalHash = 'c'.repeat(64)

  function buildSignedService(canonicalBytes: Buffer = PDF): {
    service: SignedArtifactService
    signedRows: () => Doc[]
    artifactRows: () => Doc[]
    collections: ReturnType<typeof createCollections>
  } {
    const collections = createCollections()
    const storage = makeStorage()
    const artifactService = {
      resolveCanonicalArtifact: jest.fn().mockResolvedValue({
        bytes: canonicalBytes,
        reference: { artifactHash: canonicalHash },
      }),
    }
    const service = new SignedArtifactService(
      collections.signedRepo as never,
      { findOne: jest.fn() } as never,
      storage,
      artifactService as never
    )
    return {
      service,
      signedRows: collections.signedRows,
      artifactRows: collections.artifactRows,
      collections,
    }
  }

  it('computes revision as latest ready + 1 and ignores canonical rows and other contracts', async () => {
    const { service, collections, signedRows } = buildSignedService(
      await makePdf()
    )
    const contract = makeContract()
    const id = contract._id.toHexString()
    const { privateKey, certPem } = makeIdentity()
    const input = {
      contract,
      signerId: 'tenant-1',
      signerRole: 'tenant' as const,
      signerPem: certPem,
      chainPem: [],
      signerName: 'A',
      certificateSerial: 'S',
    }
    // Canonical r5 và bản ready của hợp đồng khác (r40) không được tính.
    await collections.artifactRepo.save({
      contractId: id,
      revision: 5,
      artifactHash: 'f'.repeat(64),
      ...kindFields('canonical'),
    })
    await collections.signedRepo.save({
      contractId: new ObjectId().toHexString(),
      revision: 40,
      status: 'ready',
      ...kindFields('signed'),
    })

    const first = await service.prepare(input)
    await service.finalize(
      first.id,
      signHash(privateKey, first.signedAttrsDigest)
    )
    const second = await service.prepare({
      ...input,
      signerId: 'landlord-1',
      signerRole: 'landlord',
    })

    const mine = signedRows().filter(row => row['contractId'] === id)
    expect(mine.map(row => row['revision'])).toEqual([1, 2])
    expect(mine.map(row => row['status'])).toEqual(['ready', 'prepared'])
    expect(second.id).toBe(String(mine[1]?.['_id']))
  })

  it('stores two signed copies with the same revision without a unique clash (prepare is not atomic)', async () => {
    const { collections } = buildSignedService()
    const id = makeContract()._id.toHexString()
    await collections.signedRepo.save({
      contractId: id,
      revision: 1,
      status: 'prepared',
      ...kindFields('signed'),
    })
    await collections.signedRepo.save({
      contractId: id,
      revision: 1,
      status: 'prepared',
      ...kindFields('signed'),
    })
    expect(collections.signedRows()).toHaveLength(2)
  })

  it('allows a signed copy at the same (contractId, revision) as a canonical artifact', async () => {
    const { collections } = buildSignedService()
    const id = makeContract()._id.toHexString()
    await collections.artifactRepo.save({
      contractId: id,
      revision: 1,
      amendmentId: null,
      ...kindFields('canonical'),
    })
    await collections.signedRepo.save({
      contractId: id,
      revision: 1,
      status: 'prepared',
      ...kindFields('signed'),
    })
    expect(collections.artifactRows()).toHaveLength(1)
    expect(collections.signedRows()).toHaveLength(1)
  })
})
