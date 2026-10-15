/* eslint-disable @typescript-eslint/explicit-function-return-type -- in-memory Mongo fakes */
import { ObjectId } from 'mongodb'
import { getMetadataArgsStorage } from 'typeorm'
import {
  CONTRACT_DOCUMENT_INDEXES,
  migrateContractDocuments,
  rollbackContractDocuments,
  type ContractDocumentsCollection,
  type ContractDocumentsMergeDb,
} from './011-contract-documents-merge'
import {
  CONTRACT_DOCUMENT_CANONICAL_UNIQUE_INDEX,
  CONTRACT_DOCUMENT_KIND_REVISION_INDEX,
  ContractDocument,
} from '../../modules/contracts/schemas/contract-document.schema'

type Doc = Record<string, unknown>

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && '$in' in (cond as Doc)) {
      return ((cond as Doc).$in as unknown[]).some(
        x => String(x) === String(doc[key])
      )
    }
    return String(doc[key]) === String(cond)
  })
}

function fake(docs: Doc[]): ContractDocumentsCollection & {
  docs: Doc[]
  indexes: Map<string, { keys: unknown; options: unknown }>
} {
  const indexes = new Map<string, { keys: unknown; options: unknown }>()
  return {
    docs,
    indexes,
    find: (filter = {}) => ({
      toArray: () => Promise.resolve(docs.filter(d => matches(d, filter))),
    }),
    countDocuments: (filter = {}) =>
      Promise.resolve(docs.filter(d => matches(d, filter)).length),
    insertOne: doc => {
      docs.push({ ...doc })
      return Promise.resolve({})
    },
    updateOne: (filter, update, options) => {
      const found = docs.find(d => matches(d, filter))
      if (found) return Promise.resolve({ matchedCount: 1 })
      if (options?.upsert) {
        docs.push({ ...(update.$setOnInsert as Doc) })
        return Promise.resolve({ matchedCount: 0, upsertedCount: 1 })
      }
      return Promise.resolve({ matchedCount: 0 })
    },
    replaceOne: (filter, doc) => {
      const idx = docs.findIndex(d => matches(d, filter))
      if (idx < 0) return Promise.resolve({ matchedCount: 0 })
      docs[idx] = { ...doc }
      return Promise.resolve({ matchedCount: 1 })
    },
    createIndex: (keys, options) => {
      indexes.set(
        typeof options?.name === 'string' ? options.name : JSON.stringify(keys),
        {
          keys,
          options,
        }
      )
      return Promise.resolve('ok')
    },
    dropIndex: name => {
      if (!indexes.delete(name)) return Promise.reject(new Error('no index'))
      return Promise.resolve()
    },
    deleteMany: filter => {
      let deleted = 0
      for (let i = docs.length - 1; i >= 0; i -= 1) {
        if (matches(docs[i] as Doc, filter)) {
          docs.splice(i, 1)
          deleted += 1
        }
      }
      return Promise.resolve({ deletedCount: deleted })
    },
  }
}

function setup(artifacts: Doc[], signed: Doc[], documents: Doc[] = []) {
  const cols = {
    contract_artifacts: fake(artifacts),
    contract_signed_artifacts: fake(signed),
    contract_documents: fake(documents),
  }
  const db: ContractDocumentsMergeDb = {
    collection: name => cols[name as keyof typeof cols],
  }
  return { db, ...cols }
}

const artifact = (overrides: Doc = {}): Doc => ({
  _id: new ObjectId(),
  contractId: 'c1',
  revision: 1,
  templateRef: { key: 'k', version: 1, contentHash: 'h' },
  legalProfile: 'P',
  gridFsFileId: new ObjectId(),
  artifactHash: 'a'.repeat(64),
  amendmentId: null,
  byteLength: 10,
  contentType: 'application/pdf',
  lockedAt: new Date('2026-10-01T00:00:00.000Z'),
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  ...overrides,
})

const signedDoc = (overrides: Doc = {}): Doc => ({
  _id: new ObjectId(),
  contractId: 'c1',
  signerId: 'tenant-1',
  signerRole: 'tenant',
  canonicalHash: 'a'.repeat(64),
  revision: 1,
  status: 'ready',
  preparedFileId: new ObjectId(),
  contentDigest: 'd',
  signedAttrsDigest: 's',
  signingTime: new Date('2026-10-02T00:00:00.000Z'),
  signerPem: 'pem',
  chainPem: [],
  signedFileId: new ObjectId(),
  sha256: 'b'.repeat(64),
  byteLength: 20,
  createdAt: new Date('2026-10-02T00:00:00.000Z'),
  updatedAt: new Date('2026-10-02T00:00:00.000Z'),
  ...overrides,
})

describe('011 contract documents merge migration (G-DOC)', () => {
  it('is a dry run by default and writes nothing', async () => {
    const { db, contract_documents } = setup([artifact()], [signedDoc()])

    const report = await migrateContractDocuments(db)

    expect(report).toMatchObject({
      dryRun: true,
      scanned: 2,
      updated: 2,
      sourceCounts: { canonical: 1, signed: 1 },
      errors: [],
    })
    expect(contract_documents.docs).toHaveLength(0)
    expect(contract_documents.indexes.size).toBe(0)
  })

  it('copies both collections keeping _id, tags kind, and leaves the legacy data untouched', async () => {
    const a = artifact()
    const am = artifact({ amendmentId: 'am-1', revision: 2 })
    const s = signedDoc()
    const {
      db,
      contract_documents,
      contract_artifacts,
      contract_signed_artifacts,
    } = setup([a, am], [s])

    const report = await migrateContractDocuments(db, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(report.targetCounts).toEqual({ canonical: 2, signed: 1 })
    const byId = new Map(contract_documents.docs.map(d => [String(d._id), d]))
    expect(byId.get(String(a._id))).toEqual({ ...a, kind: 'canonical' })
    expect(byId.get(String(am._id))).toEqual({ ...am, kind: 'canonical' })
    expect(byId.get(String(s._id))).toEqual({ ...s, kind: 'signed' })
    expect(contract_artifacts.docs).toHaveLength(2)
    expect(contract_signed_artifacts.docs).toHaveLength(1)
  })

  it('creates the per-kind index and the canonical-only partial unique index', async () => {
    const { db, contract_documents } = setup([artifact()], [signedDoc()])

    await migrateContractDocuments(db, { dryRun: false })

    const partial = contract_documents.indexes.get(
      CONTRACT_DOCUMENT_CANONICAL_UNIQUE_INDEX.name
    )
    expect(partial?.keys).toEqual({
      contractId: 1,
      revision: 1,
      amendmentId: 1,
    })
    expect(partial?.options).toMatchObject({
      unique: true,
      partialFilterExpression: { kind: 'canonical' },
    })
    expect(
      contract_documents.indexes.get(CONTRACT_DOCUMENT_KIND_REVISION_INDEX.name)
        ?.keys
    ).toEqual({ kind: 1, contractId: 1, revision: 1 })
  })

  it('declares exactly the indexes that the entity exposes', () => {
    expect(CONTRACT_DOCUMENT_INDEXES.map(i => i.name)).toEqual([
      CONTRACT_DOCUMENT_KIND_REVISION_INDEX.name,
      CONTRACT_DOCUMENT_CANONICAL_UNIQUE_INDEX.name,
    ])
    expect(CONTRACT_DOCUMENT_INDEXES[1]).toMatchObject({
      keys: CONTRACT_DOCUMENT_CANONICAL_UNIQUE_INDEX.keys,
      options: CONTRACT_DOCUMENT_CANONICAL_UNIQUE_INDEX.options,
    })
    // TypeORM không tạo được partial index: entity chỉ khai báo index thường.
    expect(
      getMetadataArgsStorage().indices.filter(
        index => index.target === ContractDocument
      )
    ).toHaveLength(1)
  })

  it('is idempotent: a second apply skips every document', async () => {
    const { db, contract_documents } = setup([artifact()], [signedDoc()])
    await migrateContractDocuments(db, { dryRun: false })

    const again = await migrateContractDocuments(db, { dryRun: false })

    expect(again).toMatchObject({ updated: 0, skipped: 2, errors: [] })
    expect(contract_documents.docs).toHaveLength(2)
  })

  it('reports an _id already used by another kind and never overwrites it', async () => {
    const shared = new ObjectId()
    const { db, contract_documents } = setup(
      [artifact({ _id: shared })],
      [signedDoc({ _id: shared })]
    )

    const report = await migrateContractDocuments(db, { dryRun: false })

    expect(report.errors[0]).toContain('already used by kind=canonical')
    expect(contract_documents.docs).toHaveLength(1)
    expect(contract_documents.docs[0]).toMatchObject({ kind: 'canonical' })
  })

  it('stops with an error when the post-apply count does not match (R1 #5)', async () => {
    const { db, contract_documents } = setup([artifact(), artifact()], [])
    const original = contract_documents.updateOne
    let calls = 0
    contract_documents.updateOne = (filter, update, options) => {
      calls += 1
      if (calls === 2) return Promise.resolve({ matchedCount: 0 })
      return original(filter, update, options)
    }

    const report = await migrateContractDocuments(db, { dryRun: false })

    expect(report.errors[0]).toContain(
      '1/2 documents present as kind=canonical'
    )
    expect(contract_documents.indexes.size).toBe(0)
  })

  it('does not hide a missing source document behind documents written after the code switch', async () => {
    const lost = artifact()
    const written = artifact({ revision: 7 })
    // Đích đã có bản mới (ghi sau khi chuyển code) nhưng thiếu `lost`.
    const { db, contract_documents } = setup(
      [lost],
      [],
      [{ ...written, kind: 'canonical' }]
    )
    const original = contract_documents.updateOne
    contract_documents.updateOne = () => Promise.resolve({ matchedCount: 0 })

    const report = await migrateContractDocuments(db, { dryRun: false })
    contract_documents.updateOne = original

    expect(report.errors[0]).toContain(
      '0/1 documents present as kind=canonical'
    )
  })

  describe('rollback', () => {
    it('copies state written after the code switch back, then removes the merged rows and indexes', async () => {
      const a = artifact()
      const s = signedDoc({ status: 'prepared', sha256: null })
      const {
        db,
        contract_documents,
        contract_artifacts,
        contract_signed_artifacts,
      } = setup([a], [s])
      await migrateContractDocuments(db, { dryRun: false })

      // Sau khi chuyển code: signed -> ready, thêm canonical mới + signed mới.
      const merged = contract_documents.docs.find(
        d => String(d._id) === String(s._id)
      ) as Doc
      merged.status = 'ready'
      merged.sha256 = 'c'.repeat(64)
      const fresh: Doc = {
        ...artifact({ contractId: 'c2' }),
        kind: 'canonical',
        updatedAt: new Date(),
        signerId: null,
        status: null,
      }
      const freshSigned: Doc = {
        ...signedDoc({ contractId: 'c2' }),
        kind: 'signed',
        templateRef: null,
        gridFsFileId: null,
        lockedAt: null,
      }
      contract_documents.docs.push(fresh, freshSigned)

      const report = await rollbackContractDocuments(db, { dryRun: false })

      expect(report.errors).toEqual([])
      expect(contract_documents.docs).toHaveLength(0)
      expect(contract_documents.indexes.size).toBe(0)
      const restoredSigned = contract_signed_artifacts.docs.find(
        d => String(d._id) === String(s._id)
      )
      expect(restoredSigned).toMatchObject({
        status: 'ready',
        sha256: 'c'.repeat(64),
      })
      expect(restoredSigned).not.toHaveProperty('kind')
      const restoredFresh = contract_artifacts.docs.find(
        d => String(d._id) === String(fresh._id)
      ) as Doc
      expect(restoredFresh).toBeDefined()
      expect(restoredFresh).not.toHaveProperty('kind')
      expect(restoredFresh).not.toHaveProperty('updatedAt')
      expect(restoredFresh).not.toHaveProperty('signerId')
      expect(restoredFresh).not.toHaveProperty('status')
      const restoredFreshSigned = contract_signed_artifacts.docs.find(
        d => String(d._id) === String(freshSigned._id)
      ) as Doc
      expect(restoredFreshSigned).toBeDefined()
      expect(restoredFreshSigned).not.toHaveProperty('templateRef')
      expect(restoredFreshSigned).not.toHaveProperty('gridFsFileId')
      expect(restoredFreshSigned).not.toHaveProperty('lockedAt')
      expect(contract_artifacts.docs).toHaveLength(2)
      expect(contract_signed_artifacts.docs).toHaveLength(2)
    })

    it('reports legacy rows deleted after the switch instead of resurrecting them', async () => {
      const kept = artifact()
      const gone = artifact({ revision: 3 })
      const { db, contract_documents, contract_artifacts } = setup(
        [kept, gone],
        []
      )
      await migrateContractDocuments(db, { dryRun: false })
      contract_documents.docs.splice(
        contract_documents.docs.findIndex(
          d => String(d._id) === String(gone._id)
        ),
        1
      )

      const report = await rollbackContractDocuments(db, { dryRun: false })

      expect(report.deletedAtTarget).toEqual([String(gone._id)])
      expect(contract_documents.docs).toHaveLength(0)
      expect(contract_artifacts.docs).toHaveLength(2)
    })

    it('is a dry run by default and keeps the merged rows', async () => {
      const { db, contract_documents } = setup([artifact()], [signedDoc()])
      await migrateContractDocuments(db, { dryRun: false })

      const report = await rollbackContractDocuments(db)

      expect(report).toMatchObject({ dryRun: true, scanned: 2 })
      expect(contract_documents.docs).toHaveLength(2)
      expect(contract_documents.indexes.size).toBe(2)
    })

    it('keeps the merged rows when the legacy collection cannot be completed', async () => {
      const { db, contract_documents, contract_artifacts } = setup(
        [artifact()],
        []
      )
      await migrateContractDocuments(db, { dryRun: false })
      contract_documents.docs.push({
        ...artifact({ revision: 9 }),
        kind: 'canonical',
      })
      contract_artifacts.insertOne = () => Promise.resolve({})

      const report = await rollbackContractDocuments(db, { dryRun: false })

      expect(report.errors[0]).toContain('entries restored')
      expect(contract_documents.docs).toHaveLength(2)
    })

    it('can run twice (index drop tolerates a missing index)', async () => {
      const { db } = setup([artifact()], [signedDoc()])
      await migrateContractDocuments(db, { dryRun: false })
      await rollbackContractDocuments(db, { dryRun: false })

      const second = await rollbackContractDocuments(db, { dryRun: false })

      expect(second.errors).toEqual([])
    })
  })
})
