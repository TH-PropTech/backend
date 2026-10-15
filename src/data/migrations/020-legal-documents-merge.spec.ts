import { ObjectId } from 'mongodb'
import {
  LEGAL_DOCUMENT_INDEXES,
  LEGAL_DOCUMENTS_MERGE_MIGRATION_ID,
  migrateLegalDocuments,
  rollbackLegalDocuments,
  type LegalDocumentMongoCollection,
  type LegalDocumentMongoDatabase,
} from './020-legal-documents-merge'

type Doc = Record<string, unknown> & { _id: ObjectId }

class FakeCollection implements LegalDocumentMongoCollection {
  docs: Doc[] = []
  indexes = new Map<
    string,
    { keys: Record<string, 1 | -1>; options: Record<string, unknown> }
  >()

  private matches(doc: Doc, filter: Record<string, unknown> = {}): boolean {
    return Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && '$in' in v) {
        return (v as { $in: ObjectId[] }).$in.some(x =>
          (doc[k] as ObjectId).equals(x)
        )
      }
      return v instanceof ObjectId
        ? (doc[k] as ObjectId | undefined)?.equals(v) === true
        : doc[k] === v
    })
  }

  find(filter?: Record<string, unknown>): { toArray(): Promise<Doc[]> } {
    return {
      toArray: () =>
        Promise.resolve(this.docs.filter(d => this.matches(d, filter))),
    }
  }

  countDocuments(filter?: Record<string, unknown>): Promise<number> {
    return Promise.resolve(
      this.docs.filter(d => this.matches(d, filter)).length
    )
  }

  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean }
  ): Promise<{ upsertedCount?: number }> {
    if (this.docs.some(d => this.matches(d, filter)))
      return Promise.resolve({ upsertedCount: 0 })
    if (!options?.upsert) return Promise.resolve({ upsertedCount: 0 })
    this.docs.push({
      ...(filter as { _id: ObjectId }),
      ...(update.$setOnInsert as Record<string, unknown>),
    })
    return Promise.resolve({ upsertedCount: 1 })
  }

  replaceOne(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>
  ): Promise<{ matchedCount?: number }> {
    const index = this.docs.findIndex(d => this.matches(d, filter))
    if (index < 0) return Promise.resolve({ matchedCount: 0 })
    const current = this.docs[index] as Doc
    this.docs[index] = { _id: current._id, ...replacement }
    return Promise.resolve({ matchedCount: 1 })
  }

  deleteMany(
    filter: Record<string, unknown>
  ): Promise<{ deletedCount?: number }> {
    const before = this.docs.length
    this.docs = this.docs.filter(d => !this.matches(d, filter))
    return Promise.resolve({ deletedCount: before - this.docs.length })
  }

  createIndex(
    keys: Record<string, 1 | -1>,
    options?: {
      name?: string
      unique?: boolean
      partialFilterExpression?: Record<string, unknown>
    }
  ): Promise<string> {
    const name = options?.name ?? JSON.stringify(keys)
    const { name: _name, ...rest } = options ?? {}
    void _name
    this.indexes.set(name, { keys, options: rest })
    return Promise.resolve(name)
  }

  dropIndex(name: string): Promise<unknown> {
    if (!this.indexes.delete(name)) return Promise.reject(new Error('no index'))
    return Promise.resolve()
  }
}

function buildDatabase(): {
  database: LegalDocumentMongoDatabase
  collections: Record<string, FakeCollection>
} {
  const collections: Record<string, FakeCollection> = {}
  return {
    collections,
    database: {
      collection: (name: string) =>
        (collections[name] ??= new FakeCollection()),
    },
  }
}

const t = (n: number): Date => new Date(Date.UTC(2026, 0, n))

describe('020 legal documents merge migration', () => {
  function seed(collections: Record<string, FakeCollection>): {
    knowledgeId: ObjectId
    sourceId: ObjectId
    legalTextId: ObjectId
    regulationId: ObjectId
    termsId: ObjectId
    draftId: ObjectId
  } {
    const ids = {
      knowledgeId: new ObjectId(),
      sourceId: new ObjectId(),
      legalTextId: new ObjectId(),
      regulationId: new ObjectId(),
      termsId: new ObjectId(),
      draftId: new ObjectId(),
    }
    collections.legal_knowledge_docs = new FakeCollection()
    collections.legal_knowledge_docs.docs.push({
      _id: ids.knowledgeId,
      title: 'Luật Nhà ở 2023',
      category: 'luat',
      docNumber: '27/2023/QH15',
      keywords: ['đặt cọc'],
      content: 'Điều 1. Nội dung',
      contentSource: 'manual',
      status: 'published',
      chunkCount: 1,
      createdAt: t(1),
      updatedAt: t(1),
    })
    collections.legal_sources = new FakeCollection()
    collections.legal_sources.docs.push(
      {
        _id: ids.sourceId,
        key: '1.004194',
        kind: 'procedure',
        code: 'TTHC 1.004194',
        title: 'Đăng ký tạm trú',
        order: 1,
        isActive: true,
        showInContractPanel: true,
        dossierItems: [{ name: 'CCCD' }],
        createdAt: t(2),
        updatedAt: t(2),
      },
      {
        _id: ids.legalTextId,
        key: 'housing-law-2023',
        kind: 'legal_text',
        code: 'Luật 27/2023',
        title: 'Luật Nhà ở',
        order: 2,
        isActive: true,
        createdAt: t(2),
        updatedAt: t(2),
      }
    )
    collections.platform_regulations = new FakeCollection()
    collections.platform_regulations.docs.push({
      _id: ids.regulationId,
      code: 'REG-RES-01',
      title: 'Quy định',
      summary: 'Tóm tắt',
      category: 'residence',
      severity: 'mandatory',
      scope: ['all'],
      linkedSourceKey: '1.004194',
      checklistItems: [],
      order: 1,
      isActive: true,
      isDefault: true,
      createdAt: t(3),
      updatedAt: t(3),
    })
    collections.legal_terms_documents = new FakeCollection()
    collections.legal_terms_documents.docs.push(
      {
        _id: ids.termsId,
        key: 'rental-service-terms',
        version: 1,
        title: 'Điều khoản v1',
        summary: 'Tóm tắt',
        sections: [{ id: 's1', heading: 'H', body: 'B', order: 1 }],
        contentHash: 'h1',
        status: 'published',
        draftRevision: 1,
        publishedAt: t(4),
        createdAt: t(4),
        updatedAt: t(4),
      },
      {
        _id: ids.draftId,
        key: 'rental-service-terms',
        version: 0,
        title: 'Nháp',
        summary: 'Nháp',
        sections: [],
        contentHash: '',
        status: 'draft',
        draftRevision: 2,
        createdAt: t(5),
        updatedAt: t(5),
      }
    )
    return ids
  }

  const LEGACY = [
    'legal_knowledge_docs',
    'legal_sources',
    'platform_regulations',
    'legal_terms_documents',
  ] as const

  /** Ảnh chụp sâu một cấp của các collection cũ (so sánh cấu trúc, không phụ thuộc thứ tự khóa). */
  const snapshotLegacy = (
    collections: Record<string, FakeCollection>
  ): unknown[] =>
    LEGACY.map(name => (collections[name]?.docs ?? []).map(doc => ({ ...doc })))

  it('is a dry run by default: reads and counts but writes nothing', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)

    const report = await migrateLegalDocuments(database)

    expect(report).toMatchObject({
      migrationId: LEGAL_DOCUMENTS_MERGE_MIGRATION_ID,
      dryRun: true,
      scanned: 6,
      updated: 6,
      skipped: 0,
      errors: [],
    })
    expect(collections.legal_documents?.docs ?? []).toHaveLength(0)
    expect(collections.legal_documents?.indexes.size ?? 0).toBe(0)
  })

  it('copies by _id with kind (source: docKind), keeps every other field, verifies counts and creates indexes', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)
    const before = snapshotLegacy(collections)

    const report = await migrateLegalDocuments(database, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(report).toMatchObject({ scanned: 6, updated: 6, skipped: 0 })
    expect(report.counts).toEqual({
      knowledge: { source: 1, target: 1 },
      source: { source: 2, target: 2 },
      regulation: { source: 1, target: 1 },
      terms: { source: 2, target: 2 },
    })
    const target = collections.legal_documents as FakeCollection
    const byId = (id: ObjectId): Doc =>
      target.docs.find(d => d._id.equals(id)) as Doc

    expect(byId(ids.knowledgeId)).toEqual({
      _id: ids.knowledgeId,
      kind: 'knowledge',
      title: 'Luật Nhà ở 2023',
      category: 'luat',
      docNumber: '27/2023/QH15',
      keywords: ['đặt cọc'],
      content: 'Điều 1. Nội dung',
      contentSource: 'manual',
      status: 'published',
      chunkCount: 1,
      createdAt: t(1),
      updatedAt: t(1),
    })
    // LegalSource.kind -> docKind; discriminator kind = 'source'
    expect(byId(ids.sourceId)).toMatchObject({
      kind: 'source',
      docKind: 'procedure',
      key: '1.004194',
      code: 'TTHC 1.004194',
      order: 1,
      dossierItems: [{ name: 'CCCD' }],
    })
    expect(byId(ids.legalTextId)).toMatchObject({
      kind: 'source',
      docKind: 'legal_text',
      key: 'housing-law-2023',
    })
    expect(byId(ids.regulationId)).toMatchObject({
      kind: 'regulation',
      code: 'REG-RES-01',
      linkedSourceKey: '1.004194',
    })
    expect(byId(ids.regulationId)).not.toHaveProperty('docKind')
    expect(byId(ids.termsId)).toMatchObject({
      kind: 'terms',
      key: 'rental-service-terms',
      version: 1,
      contentHash: 'h1',
    })
    expect(byId(ids.draftId)).toMatchObject({ kind: 'terms', status: 'draft' })

    expect([...target.indexes.keys()]).toEqual(
      LEGAL_DOCUMENT_INDEXES.map(i => i.name)
    )
    const uniqueSource = target.indexes.get('legal_documents_source_key_unique')
    expect(uniqueSource?.options).toEqual({
      unique: true,
      partialFilterExpression: { kind: 'source' },
    })
    const uniqueRegulation = target.indexes.get(
      'legal_documents_regulation_code_unique'
    )
    expect(uniqueRegulation?.options).toEqual({
      unique: true,
      partialFilterExpression: { kind: 'regulation' },
    })
    // collection cũ không bị sửa
    expect(snapshotLegacy(collections)).toEqual(before)
  })

  it('is idempotent: running twice copies nothing the second time', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)

    await migrateLegalDocuments(database, { dryRun: false })
    const second = await migrateLegalDocuments(database, { dryRun: false })

    expect(second).toMatchObject({ scanned: 6, updated: 0, skipped: 6 })
    expect(collections.legal_documents?.docs).toHaveLength(6)
  })

  it('applies and warns when a row lacks its key or keys repeat within a kind, keeping every row', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)
    const noKeyId = new ObjectId()
    const dupKeyId = new ObjectId()
    const noCodeId = new ObjectId()
    const dupCodeId = new ObjectId()
    ;(collections.legal_sources as FakeCollection).docs.push(
      { _id: noKeyId, kind: 'procedure', title: 'no key' },
      { _id: dupKeyId, key: '1.004194', kind: 'procedure' }
    )
    ;(collections.platform_regulations as FakeCollection).docs.push(
      { _id: noCodeId, title: 'no code' },
      { _id: dupCodeId, code: 'REG-RES-01' }
    )

    const dry = await migrateLegalDocuments(database)
    expect(dry.errors).toEqual([])
    expect(dry.warnings.join(' ')).toContain('thiếu hoặc sai kiểu key')
    expect(dry.warnings.join(' ')).toContain('thiếu hoặc sai kiểu code')
    expect(dry.warnings).toContain(
      'legal_documents_source_key_unique: unique skipped: 1 duplicate keys'
    )
    expect(dry.warnings).toContain(
      'legal_documents_regulation_code_unique: unique skipped: 1 duplicate keys'
    )
    expect(collections.legal_documents?.docs ?? []).toHaveLength(0)

    const report = await migrateLegalDocuments(database, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(report.warnings).toHaveLength(4)
    expect(report.counts.source).toEqual({ source: 4, target: 4 })
    expect(report.counts.regulation).toEqual({ source: 3, target: 3 })
    const target = collections.legal_documents as FakeCollection
    expect(target.docs).toHaveLength(10)
    const byId = (id: ObjectId): Doc =>
      target.docs.find(d => d._id.equals(id)) as Doc
    expect(byId(noKeyId)).toEqual({
      _id: noKeyId,
      kind: 'source',
      docKind: 'procedure',
      title: 'no key',
    })
    expect(byId(noKeyId)).not.toHaveProperty('key')
    expect(byId(dupKeyId)).toMatchObject({ kind: 'source', key: '1.004194' })
    expect(byId(noCodeId)).toEqual({
      _id: noCodeId,
      kind: 'regulation',
      title: 'no code',
    })
    expect(byId(dupCodeId)).toMatchObject({
      kind: 'regulation',
      code: 'REG-RES-01',
    })
    // trùng khóa: chỉ mục thường thay cho unique, các chỉ mục khác vẫn đủ
    expect(
      target.indexes.get('legal_documents_source_key_unique')?.options
    ).toEqual({})
    expect(
      target.indexes.get('legal_documents_regulation_code_unique')?.options
    ).toEqual({})
    expect(target.indexes.size).toBe(LEGAL_DOCUMENT_INDEXES.length)
  })

  it('reports the duplicate and never writes an _id twice when the same _id appears in two sources', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)
    ;(collections.platform_regulations as FakeCollection).docs.push({
      _id: ids.knowledgeId,
      code: 'REG-NEW',
    })

    const dry = await migrateLegalDocuments(database)
    expect(dry.errors).toHaveLength(1)
    expect(dry.errors[0]).toContain('trùng _id')

    const applied = await migrateLegalDocuments(database, { dryRun: false })
    expect(applied.errors).toHaveLength(1)
    const written = collections.legal_documents?.docs ?? []
    expect(new Set(written.map(d => String(d._id))).size).toBe(written.length)
  })

  it('a same key in another kind is not a duplicate (kind isolation)', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)
    // đích đã có bản ghi kind khác trùng key nguồn: không được coi là trùng
    collections.legal_documents = new FakeCollection()
    collections.legal_documents.docs.push({
      _id: new ObjectId(),
      kind: 'terms',
      key: '1.004194',
      version: 9,
    })

    const report = await migrateLegalDocuments(database, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(report.counts.source).toEqual({ source: 2, target: 2 })
    expect(report.counts.terms.target).toBe(3)
  })

  it('reports and keeps an existing target row with the same _id and another kind', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)
    collections.legal_documents = new FakeCollection()
    collections.legal_documents.docs.push({
      _id: ids.regulationId,
      kind: 'source',
      key: 'x',
    })

    const report = await migrateLegalDocuments(database, { dryRun: false })

    expect(report.errors).toHaveLength(1)
    const kept = collections.legal_documents.docs.filter(
      d => String(d._id) === String(ids.regulationId)
    )
    expect(kept).toHaveLength(1)
    expect(kept[0]?.kind).toBe('source')
  })

  it('throws when a regulation _id is missing from the target after writing', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)
    const target = new FakeCollection()
    const realUpdate = target.updateOne.bind(target)
    target.updateOne = (
      filter,
      update,
      options
    ): Promise<{ upsertedCount?: number }> =>
      (update.$setOnInsert as { kind: string }).kind === 'regulation'
        ? Promise.resolve({ upsertedCount: 0 })
        : realUpdate(filter, update, options)
    collections.legal_documents = target

    await expect(
      migrateLegalDocuments(database, { dryRun: false })
    ).rejects.toThrow('count mismatch for kind regulation')
  })

  describe('rollback', () => {
    it('is a dry run by default and changes nothing', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      await migrateLegalDocuments(database, { dryRun: false })

      const report = await rollbackLegalDocuments(database)

      expect(report.dryRun).toBe(true)
      expect(report.updated).toBe(6)
      expect(collections.legal_documents?.docs).toHaveLength(6)
      expect(collections.legal_documents?.indexes.size).toBe(8)
    })

    it('restores the legacy shape, then drops the new rows and the indexes', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      const original = snapshotLegacy(collections)
      await migrateLegalDocuments(database, { dryRun: false })

      const report = await rollbackLegalDocuments(database, { dryRun: false })

      expect(report.errors).toEqual([])
      expect(report.counts).toEqual({
        knowledge: { source: 1, target: 0 },
        source: { source: 2, target: 0 },
        regulation: { source: 1, target: 0 },
        terms: { source: 2, target: 0 },
      })
      expect(collections.legal_documents?.docs).toHaveLength(0)
      expect(collections.legal_documents?.indexes.size).toBe(0)
      expect(snapshotLegacy(collections)).toEqual(original)
    })

    it('copies back changes and rows written after the code switch', async () => {
      const { database, collections } = buildDatabase()
      const ids = seed(collections)
      await migrateLegalDocuments(database, { dryRun: false })
      const target = collections.legal_documents as FakeCollection

      // sau khi chuyển code: source bị đổi, có nguồn và quy định mới
      const sourceRow = target.docs.find(d => d._id.equals(ids.sourceId)) as Doc
      sourceRow['isActive'] = false
      sourceRow['updatedBy'] = 'admin-9'
      const newSourceId = new ObjectId()
      const newRegulationId = new ObjectId()
      target.docs.push(
        {
          _id: newSourceId,
          kind: 'source',
          docKind: 'legal_text',
          key: 'new-source',
          order: 3,
        },
        {
          _id: newRegulationId,
          kind: 'regulation',
          code: 'REG-NEW',
          order: 2,
        }
      )

      const report = await rollbackLegalDocuments(database, { dryRun: false })

      expect(report.errors).toEqual([])
      // 1 knowledge + 3 source (2 cũ, 1 mới) + 2 regulation (1 cũ, 1 mới) + 2 terms
      expect(report.restored).toBe(8)
      const sources = collections.legal_sources as FakeCollection
      expect(sources.docs.find(d => d._id.equals(ids.sourceId))).toMatchObject({
        key: '1.004194',
        kind: 'procedure',
        isActive: false,
        updatedBy: 'admin-9',
      })
      expect(
        sources.docs.find(d => d._id.equals(ids.sourceId))
      ).not.toHaveProperty('docKind')
      expect(sources.docs.find(d => d._id.equals(newSourceId))).toEqual({
        _id: newSourceId,
        key: 'new-source',
        kind: 'legal_text',
        order: 3,
      })
      expect(
        (collections.platform_regulations as FakeCollection).docs.find(d =>
          d._id.equals(newRegulationId)
        )
      ).toEqual({ _id: newRegulationId, code: 'REG-NEW', order: 2 })
      expect(
        (collections.legal_knowledge_docs as FakeCollection).docs[0]
      ).not.toHaveProperty('kind')
      expect(target.docs).toHaveLength(0)
    })

    it('keeps the new rows and the indexes when restoring fails the count check', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      await migrateLegalDocuments(database, { dryRun: false })
      const regulations = collections.platform_regulations as FakeCollection
      regulations.replaceOne = (): Promise<{ matchedCount?: number }> =>
        Promise.resolve({ matchedCount: 0 })
      const target = collections.legal_documents as FakeCollection
      target.docs.push({
        _id: new ObjectId(),
        kind: 'regulation',
        code: 'NEW',
      })
      regulations.updateOne = (): Promise<{ upsertedCount?: number }> =>
        Promise.resolve({ upsertedCount: 0 })

      const report = await rollbackLegalDocuments(database, { dryRun: false })

      expect(report.errors).toHaveLength(1)
      expect(target.docs.filter(d => d.kind === 'regulation')).toHaveLength(2)
      expect(target.indexes.size).toBe(8)
    })
  })
})
