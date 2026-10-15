import { ObjectId } from 'mongodb'
import {
  CONTRACT_LAYOUT_MERGE_INDEXES,
  CONTRACT_LAYOUT_PROFILES_MERGE_MIGRATION_ID,
  CONTRACT_LAYOUT_SOURCE_COLLECTION,
  CONTRACT_TEMPLATES_COLLECTION,
  migrateContractLayoutProfiles,
  rollbackContractLayoutProfiles,
  type ContractLayoutMongoCollection,
  type ContractLayoutMongoDatabase,
} from './025-contract-layout-profiles-merge'

type Doc = Record<string, unknown> & { _id: ObjectId }
type IndexInfo = {
  name: string
  key: Record<string, 1 | -1>
  unique?: boolean
  partialFilterExpression?: Record<string, unknown>
}

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object') {
    const op = expected as Record<string, unknown>
    if ('$in' in op) {
      return (op.$in as unknown[]).some(x =>
        x instanceof ObjectId
          ? actual instanceof ObjectId && actual.equals(x)
          : (actual ?? null) === x
      )
    }
    if ('$exists' in op) return (actual !== undefined) === op.$exists
    if ('$ne' in op) return (actual ?? null) !== op.$ne
  }
  if (expected instanceof ObjectId) {
    return actual instanceof ObjectId && actual.equals(expected)
  }
  return (actual ?? null) === (expected ?? null)
}

class FakeCollection implements ContractLayoutMongoCollection {
  docs: Doc[] = []
  indexStore = new Map<string, IndexInfo>()

  private matches(doc: Doc, filter: Record<string, unknown> = {}): boolean {
    return Object.entries(filter).every(([k, v]) => matchValue(doc[k], v))
  }

  find(filter?: Record<string, unknown>): { toArray(): Promise<Doc[]> } {
    return {
      toArray: () =>
        Promise.resolve(
          this.docs.filter(d => this.matches(d, filter)).map(d => ({ ...d }))
        ),
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

  updateMany(
    filter: Record<string, unknown>,
    update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> }
  ): Promise<{ modifiedCount?: number }> {
    let modified = 0
    for (const doc of this.docs.filter(d => this.matches(d, filter))) {
      modified += 1
      for (const key of Object.keys(update.$set ?? {})) {
        doc[key] = (update.$set as Record<string, unknown>)[key]
      }
      for (const key of Object.keys(update.$unset ?? {})) delete doc[key]
    }
    return Promise.resolve({ modifiedCount: modified })
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
    this.indexStore.set(name, {
      name,
      key: keys,
      ...(options?.unique !== undefined ? { unique: options.unique } : {}),
      ...(options?.partialFilterExpression
        ? { partialFilterExpression: options.partialFilterExpression }
        : {}),
    })
    return Promise.resolve(name)
  }

  dropIndex(name: string): Promise<unknown> {
    if (!this.indexStore.delete(name))
      return Promise.reject(new Error('no index'))
    return Promise.resolve()
  }

  indexes(): Promise<IndexInfo[]> {
    return Promise.resolve([...this.indexStore.values()])
  }
}

function buildDatabase(): {
  database: ContractLayoutMongoDatabase
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

const OLD_TEMPLATE_UNIQUE: IndexInfo = {
  name: 'templateKey_1_version_1',
  key: { templateKey: 1, version: 1 },
  unique: true,
}

/** Giống lỗi driver thật khi `listIndexes` gọi trên collection chưa tồn tại. */
function namespaceNotFound(): Error {
  return Object.assign(
    new Error('ns does not exist: proptech.contract_templates'),
    {
      code: 26,
      codeName: 'NamespaceNotFound',
    }
  )
}

describe('025 contract layout profiles merge migration', () => {
  function seed(collections: Record<string, FakeCollection>): {
    layoutPublishedId: ObjectId
    layoutDraftId: ObjectId
    templateId: ObjectId
  } {
    const ids = {
      layoutPublishedId: new ObjectId(),
      layoutDraftId: new ObjectId(),
      templateId: new ObjectId(),
    }
    collections[CONTRACT_LAYOUT_SOURCE_COLLECTION] = new FakeCollection()
    collections[CONTRACT_LAYOUT_SOURCE_COLLECTION].docs.push(
      {
        _id: ids.layoutPublishedId,
        profileKey: 'standard',
        version: 1,
        status: 'published',
        legalProfile: 'PRIVATE_CIVIL_APARTMENT_LEASE',
        templateKey: null,
        blocks: [{ blockId: 'PARTIES', order: 1, title: 'P', visible: true }],
        supplementaryClauses: [],
        disclosures: [],
        contentHash: 'hash-1',
        draftRevision: 1,
        createdBy: 'admin',
        publishedBy: 'admin',
        publishedAt: t(2),
        createdAt: t(1),
        updatedAt: t(2),
      },
      {
        _id: ids.layoutDraftId,
        profileKey: 'standard',
        version: 0,
        status: 'draft',
        legalProfile: 'PRIVATE_CIVIL_APARTMENT_LEASE',
        templateKey: 'VN_RE',
        blocks: [],
        supplementaryClauses: [],
        disclosures: [],
        contentHash: 'hash-2',
        draftRevision: 3,
        createdBy: 'admin',
        createdAt: t(3),
        updatedAt: t(3),
      }
    )
    collections[CONTRACT_TEMPLATES_COLLECTION] = new FakeCollection()
    // Template cũ: chưa có `kind` (trước migration), trùng status published với layout.
    collections[CONTRACT_TEMPLATES_COLLECTION].docs.push({
      _id: ids.templateId,
      templateKey: 'VN_RE',
      version: 1,
      status: 'published',
      legalProfile: 'PRIVATE_CIVIL_APARTMENT_LEASE',
      clauses: [],
      createdAt: t(1),
      updatedAt: t(1),
    })
    collections[CONTRACT_TEMPLATES_COLLECTION].indexStore.set(
      OLD_TEMPLATE_UNIQUE.name,
      OLD_TEMPLATE_UNIQUE
    )
    return ids
  }

  it('is a dry run by default: reads and counts but writes nothing', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)
    const templates = collections[CONTRACT_TEMPLATES_COLLECTION]!
    const before = JSON.stringify(templates.docs)

    const report = await migrateContractLayoutProfiles(database)

    expect(report.dryRun).toBe(true)
    expect(report.migrationId).toBe(CONTRACT_LAYOUT_PROFILES_MERGE_MIGRATION_ID)
    expect(report.counts.layout).toEqual({ source: 2, target: 0 })
    expect(report.updated).toBe(2)
    expect(report.errors).toEqual([])
    expect(JSON.stringify(templates.docs)).toBe(before)
    expect(templates.indexStore.has(OLD_TEMPLATE_UNIQUE.name)).toBe(true)
    expect(
      collections[CONTRACT_TEMPLATES_COLLECTION]!.docs.some(d =>
        d._id.equals(ids.layoutPublishedId)
      )
    ).toBe(false)
  })

  it('backfills kind on templates, copies layouts by _id with kind, verifies counts and rebuilds indexes', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)
    const templates = collections[CONTRACT_TEMPLATES_COLLECTION]!

    const report = await migrateContractLayoutProfiles(database, {
      dryRun: false,
    })

    expect(report.errors).toEqual([])
    expect(report.counts.layout).toEqual({ source: 2, target: 2 })
    expect(report.counts.template.target).toBe(1)

    const template = templates.docs.find(d => d._id.equals(ids.templateId))
    expect(template?.kind).toBe('template')

    const layout = templates.docs.find(d => d._id.equals(ids.layoutPublishedId))
    expect(layout).toEqual(
      expect.objectContaining({
        kind: 'layout',
        profileKey: 'standard',
        version: 1,
        status: 'published',
        contentHash: 'hash-1',
        publishedAt: t(2),
      })
    )

    // Chỉ mục: unique cũ (templateKey,version) bị gỡ, unique partial theo kind được tạo.
    expect(templates.indexStore.has(OLD_TEMPLATE_UNIQUE.name)).toBe(false)
    const templateUnique = templates.indexStore.get(
      'contract_templates_template_key_version_unique'
    )
    expect(templateUnique).toEqual(
      expect.objectContaining({
        key: { templateKey: 1, version: 1 },
        unique: true,
        partialFilterExpression: { kind: 'template' },
      })
    )
    const layoutUnique = templates.indexStore.get(
      'contract_templates_layout_profile_version_unique'
    )
    expect(layoutUnique).toEqual(
      expect.objectContaining({
        key: { profileKey: 1, version: 1 },
        unique: true,
        partialFilterExpression: { kind: 'layout' },
      })
    )
    for (const index of CONTRACT_LAYOUT_MERGE_INDEXES) {
      expect(templates.indexStore.has(index.name)).toBe(true)
    }
    // Collection cũ không bị xóa hay sửa.
    expect(collections[CONTRACT_LAYOUT_SOURCE_COLLECTION]!.docs).toHaveLength(2)
  })

  it('is idempotent: running twice copies nothing the second time', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)
    await migrateContractLayoutProfiles(database, { dryRun: false })

    const second = await migrateContractLayoutProfiles(database, {
      dryRun: false,
    })

    expect(second.updated).toBe(0)
    expect(second.skipped).toBe(2)
    expect(second.errors).toEqual([])
    expect(collections[CONTRACT_TEMPLATES_COLLECTION]!.docs).toHaveLength(3)
  })

  it('reports and leaves the template untouched when a layout _id exists as a template', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)
    collections[CONTRACT_TEMPLATES_COLLECTION]!.docs[0]!._id =
      ids.layoutPublishedId

    const report = await migrateContractLayoutProfiles(database, {
      dryRun: false,
    })

    expect(report.errors).toHaveLength(1)
    const clashing = collections[CONTRACT_TEMPLATES_COLLECTION]!.docs.filter(
      d => String(d._id) === String(ids.layoutPublishedId)
    )
    expect(clashing).toHaveLength(1)
    expect(clashing[0]?.kind).not.toBe('layout')
  })

  it('throws when the target count check fails after writing', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)
    const target = collections[CONTRACT_TEMPLATES_COLLECTION]!
    const updateOne = target.updateOne.bind(target)
    // Lặng lẽ không ghi layout: kiểm đếm phải phát hiện.
    target.updateOne = (
      filter,
      update,
      options
    ): Promise<{ upsertedCount?: number }> =>
      update.$setOnInsert && (update.$setOnInsert as Doc).kind === 'layout'
        ? Promise.resolve({ upsertedCount: 0 })
        : updateOne(filter, update, options)

    await expect(
      migrateContractLayoutProfiles(database, { dryRun: false })
    ).rejects.toThrow('count mismatch')
  })

  describe('khi collection đích chưa tồn tại (driver ném NamespaceNotFound)', () => {
    /** Collection đích chưa có: không bản ghi, `indexes()` ném NamespaceNotFound. */
    function seedMissingTarget(): {
      database: ContractLayoutMongoDatabase
      collections: Record<string, FakeCollection>
    } {
      const built = buildDatabase()
      seed(built.collections)
      const target = built.collections[CONTRACT_TEMPLATES_COLLECTION]!
      target.docs = []
      target.indexStore.clear()
      target.indexes = (): Promise<IndexInfo[]> =>
        Promise.reject(namespaceNotFound())
      return built
    }

    it('migrate dry-run không ném và không ghi', async () => {
      const { database, collections } = seedMissingTarget()

      const report = await migrateContractLayoutProfiles(database)

      expect(report.dryRun).toBe(true)
      expect(report.errors).toEqual([])
      expect(report.updated).toBe(2)
      expect(collections[CONTRACT_TEMPLATES_COLLECTION]!.docs).toHaveLength(0)
    })

    it('migrate apply không ném và tạo đủ chỉ mục khi collection chưa có', async () => {
      const { database, collections } = seedMissingTarget()

      const report = await migrateContractLayoutProfiles(database, {
        dryRun: false,
      })

      expect(report.errors).toEqual([])
      expect(report.counts.layout).toEqual({ source: 2, target: 2 })
      const target = collections[CONTRACT_TEMPLATES_COLLECTION]!
      for (const index of CONTRACT_LAYOUT_MERGE_INDEXES) {
        expect(target.indexStore.has(index.name)).toBe(true)
      }
    })

    it('rollback dry-run và apply không ném khi collection đích chưa có', async () => {
      const { database, collections } = seedMissingTarget()

      const dry = await rollbackContractLayoutProfiles(database)
      expect(dry.dryRun).toBe(true)
      expect(dry.errors).toEqual([])

      const applied = await rollbackContractLayoutProfiles(database, {
        dryRun: false,
      })
      expect(applied.errors).toEqual([])
      expect(collections[CONTRACT_LAYOUT_SOURCE_COLLECTION]!.docs).toHaveLength(
        2
      )
    })
  })

  describe('rollback', () => {
    it('is a dry run by default and changes nothing', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      await migrateContractLayoutProfiles(database, { dryRun: false })
      const before = JSON.stringify(
        collections[CONTRACT_TEMPLATES_COLLECTION]!.docs
      )

      const report = await rollbackContractLayoutProfiles(database)

      expect(report.dryRun).toBe(true)
      expect(
        JSON.stringify(collections[CONTRACT_TEMPLATES_COLLECTION]!.docs)
      ).toBe(before)
    })

    it('restores the legacy shape, then removes layout rows, the kind marker and the new indexes', async () => {
      const { database, collections } = buildDatabase()
      const ids = seed(collections)
      await migrateContractLayoutProfiles(database, { dryRun: false })
      const templates = collections[CONTRACT_TEMPLATES_COLLECTION]!

      const report = await rollbackContractLayoutProfiles(database, {
        dryRun: false,
      })

      expect(report.errors).toEqual([])
      const legacy = collections[CONTRACT_LAYOUT_SOURCE_COLLECTION]!.docs.find(
        d => d._id.equals(ids.layoutPublishedId)
      )
      expect(legacy).not.toHaveProperty('kind')
      expect(legacy?.contentHash).toBe('hash-1')
      expect(templates.docs.some(d => d.kind === 'layout')).toBe(false)
      expect(templates.docs.every(d => !('kind' in d))).toBe(true)
      expect(
        templates.indexStore.has(
          'contract_templates_template_key_version_unique'
        )
      ).toBe(false)
      expect(templates.indexStore.get(OLD_TEMPLATE_UNIQUE.name)).toEqual(
        expect.objectContaining({
          key: { templateKey: 1, version: 1 },
          unique: true,
        })
      )
    })

    it('copies back changes and rows written after the code switch', async () => {
      const { database, collections } = buildDatabase()
      const ids = seed(collections)
      await migrateContractLayoutProfiles(database, { dryRun: false })
      const layouts = collections[CONTRACT_TEMPLATES_COLLECTION]!
      // Sau khi chuyển code: bản published bị đổi trạng thái, và có thêm một layout mới.
      const row = layouts.docs.find(d => d._id.equals(ids.layoutPublishedId))!
      row.status = 'archived'
      const newId = new ObjectId()
      layouts.docs.push({
        _id: newId,
        kind: 'layout',
        profileKey: 'compact',
        version: 1,
        status: 'published',
        legalProfile: 'PRIVATE_CIVIL_APARTMENT_LEASE',
        templateKey: null,
        blocks: [],
        supplementaryClauses: [],
        disclosures: [],
        contentHash: 'hash-new',
        draftRevision: 1,
        createdBy: 'admin',
        createdAt: t(9),
        updatedAt: t(9),
      })

      const report = await rollbackContractLayoutProfiles(database, {
        dryRun: false,
      })

      expect(report.errors).toEqual([])
      const legacy = collections[CONTRACT_LAYOUT_SOURCE_COLLECTION]!.docs
      expect(
        legacy.find(d => d._id.equals(ids.layoutPublishedId))?.status
      ).toBe('archived')
      expect(legacy.find(d => d._id.equals(newId))).toEqual(
        expect.objectContaining({
          profileKey: 'compact',
          contentHash: 'hash-new',
        })
      )
      expect(legacy.find(d => d._id.equals(newId))).not.toHaveProperty('kind')
    })

    it('keeps the layout rows and the template index state when the restore count check fails', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      await migrateContractLayoutProfiles(database, { dryRun: false })
      const legacy = collections[CONTRACT_LAYOUT_SOURCE_COLLECTION]!
      // Collection cũ "mất" dữ liệu khi sao ngược: kiểm đếm phải chặn việc xóa layout ở đích.
      legacy.docs = []
      legacy.replaceOne = (): Promise<{ matchedCount?: number }> =>
        Promise.resolve({ matchedCount: 0 })
      legacy.updateOne = (): Promise<{ upsertedCount?: number }> =>
        Promise.resolve({ upsertedCount: 0 })

      const report = await rollbackContractLayoutProfiles(database, {
        dryRun: false,
      })

      expect(report.errors.length).toBeGreaterThan(0)
      expect(
        collections[CONTRACT_TEMPLATES_COLLECTION]!.docs.filter(
          d => d.kind === 'layout'
        )
      ).toHaveLength(2)
      expect(
        collections[CONTRACT_TEMPLATES_COLLECTION]!.indexStore.has(
          'contract_templates_template_key_version_unique'
        )
      ).toBe(true)
    })
  })
})
