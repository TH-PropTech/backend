import { ObjectId } from 'mongodb'
import {
  RENTAL_FLOW_CONFIG_INDEXES,
  RENTAL_FLOW_CONFIGS_MERGE_MIGRATION_ID,
  migrateRentalFlowConfigs,
  rollbackRentalFlowConfigs,
  type RentalFlowConfigMongoCollection,
  type RentalFlowConfigMongoDatabase,
} from './014-rental-flow-configs-merge'

type Doc = Record<string, unknown> & { _id: ObjectId }

class FakeCollection implements RentalFlowConfigMongoCollection {
  docs: Doc[] = []
  indexes = new Map<string, Record<string, 1 | -1>>()

  private matches(doc: Doc, filter: Record<string, unknown> = {}): boolean {
    return Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && '$in' in v) {
        return (v as { $in: ObjectId[] }).$in.some(x =>
          (doc[k] as ObjectId).equals(x)
        )
      }
      return v instanceof ObjectId
        ? (doc[k] as ObjectId).equals(v)
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
    options?: { name?: string }
  ): Promise<string> {
    const name = options?.name ?? JSON.stringify(keys)
    this.indexes.set(name, keys)
    return Promise.resolve(name)
  }

  dropIndex(name: string): Promise<unknown> {
    if (!this.indexes.delete(name)) return Promise.reject(new Error('no index'))
    return Promise.resolve()
  }
}

function buildDatabase(): {
  database: RentalFlowConfigMongoDatabase
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

describe('014 rental flow configs merge migration', () => {
  function seed(collections: Record<string, FakeCollection>): {
    profileId: ObjectId
    draftId: ObjectId
    policyId: ObjectId
  } {
    const ids = {
      profileId: new ObjectId(),
      draftId: new ObjectId(),
      policyId: new ObjectId(),
    }
    collections.rental_flow_profiles = new FakeCollection()
    collections.rental_flow_profiles.docs.push(
      {
        _id: ids.profileId,
        profileId: 'safe-default-profile',
        name: 'P',
        description: 'd',
        status: 'published',
        version: 1,
        draftRevision: 1,
        contentHash: 'h1',
        schemaVersion: 1,
        changeClassification: 'PRESENTATION',
        steps: { step1: { a: 1 } },
        createdBy: 'system',
        publishedBy: 'system',
        publishedAt: t(1),
        createdAt: t(1),
        updatedAt: t(1),
      },
      {
        _id: ids.draftId,
        profileId: 'safe-default-profile',
        name: 'P',
        description: 'd',
        status: 'draft',
        version: null,
        draftRevision: 2,
        contentHash: null,
        schemaVersion: 1,
        changeClassification: 'PRESENTATION',
        steps: { step1: { a: 2 } },
        createdAt: t(2),
        updatedAt: t(2),
      }
    )
    collections.rental_execution_policies = new FakeCollection()
    collections.rental_execution_policies.docs.push({
      _id: ids.policyId,
      policyId: 'deposit-first',
      version: 1,
      status: 'published',
      strategy: 'DEPOSIT_FIRST',
      name: 'N',
      description: 'd',
      disclosure: { sequenceLabel: 's' },
      contentHash: 'h2',
      draftRevision: 1,
      createdBy: 'system',
      publishedAt: t(3),
      createdAt: t(3),
      updatedAt: t(3),
    })
    return ids
  }

  it('is a dry run by default: reads and counts but writes nothing', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)

    const report = await migrateRentalFlowConfigs(database)

    expect(report).toMatchObject({
      migrationId: RENTAL_FLOW_CONFIGS_MERGE_MIGRATION_ID,
      dryRun: true,
      scanned: 3,
      updated: 3,
      skipped: 0,
      errors: [],
    })
    expect(collections.rental_flow_configs?.docs ?? []).toHaveLength(0)
    expect(collections.rental_flow_configs?.indexes.size ?? 0).toBe(0)
  })

  it('copies by _id with kind/key, keeps every other field, verifies counts and creates the index', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)

    const report = await migrateRentalFlowConfigs(database, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(report).toMatchObject({ scanned: 3, updated: 3, skipped: 0 })
    expect(report.counts).toEqual({
      profile: { source: 2, target: 2 },
      policy: { source: 1, target: 1 },
    })
    const target = collections.rental_flow_configs as FakeCollection
    const byId = (id: ObjectId): Doc =>
      target.docs.find(d => d._id.equals(id)) as Doc
    expect(byId(ids.profileId)).toEqual({
      _id: ids.profileId,
      kind: 'profile',
      key: 'safe-default-profile',
      name: 'P',
      description: 'd',
      status: 'published',
      version: 1,
      draftRevision: 1,
      contentHash: 'h1',
      schemaVersion: 1,
      changeClassification: 'PRESENTATION',
      steps: { step1: { a: 1 } },
      createdBy: 'system',
      publishedBy: 'system',
      publishedAt: t(1),
      createdAt: t(1),
      updatedAt: t(1),
    })
    expect(byId(ids.policyId)).toMatchObject({
      kind: 'policy',
      key: 'deposit-first',
      strategy: 'DEPOSIT_FIRST',
    })
    expect(byId(ids.policyId)).not.toHaveProperty('policyId')
    expect([...target.indexes.keys()]).toEqual(
      RENTAL_FLOW_CONFIG_INDEXES.map(i => i.name)
    )
    // collection cũ không bị sửa
    expect(collections.rental_flow_profiles?.docs).toHaveLength(2)
    expect(collections.rental_execution_policies?.docs).toHaveLength(1)
  })

  it('is idempotent: running twice copies nothing the second time', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)

    await migrateRentalFlowConfigs(database, { dryRun: false })
    const second = await migrateRentalFlowConfigs(database, { dryRun: false })

    expect(second).toMatchObject({ scanned: 3, updated: 0, skipped: 3 })
    expect(collections.rental_flow_configs?.docs).toHaveLength(3)
  })

  it('refuses to apply (and writes nothing) when a source row lacks its key or _ids collide', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)
    ;(collections.rental_flow_profiles as FakeCollection).docs.push({
      _id: new ObjectId(),
      name: 'no key',
    })
    ;(collections.rental_execution_policies as FakeCollection).docs.push({
      _id: ids.profileId,
      policyId: 'dup',
    })

    const dry = await migrateRentalFlowConfigs(database)
    expect(dry.errors).toHaveLength(2)

    await expect(
      migrateRentalFlowConfigs(database, { dryRun: false })
    ).rejects.toThrow('refusing to apply')
    expect(collections.rental_flow_configs?.docs ?? []).toHaveLength(0)
  })

  it('refuses when an existing target row with the same _id has another kind', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)
    collections.rental_flow_configs = new FakeCollection()
    collections.rental_flow_configs.docs.push({
      _id: ids.policyId,
      kind: 'profile',
      key: 'x',
    })

    await expect(
      migrateRentalFlowConfigs(database, { dryRun: false })
    ).rejects.toThrow('refusing to apply')
  })

  it('throws when a source _id is missing from the target after writing', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)
    const target = new FakeCollection()
    const realUpdate = target.updateOne.bind(target)
    target.updateOne = (
      filter,
      update,
      options
    ): Promise<{ upsertedCount?: number }> =>
      (update.$setOnInsert as { kind: string }).kind === 'policy'
        ? Promise.resolve({ upsertedCount: 0 })
        : realUpdate(filter, update, options)
    collections.rental_flow_configs = target

    await expect(
      migrateRentalFlowConfigs(database, { dryRun: false })
    ).rejects.toThrow('count mismatch for kind policy')
  })

  describe('rollback', () => {
    it('is a dry run by default and changes nothing', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      await migrateRentalFlowConfigs(database, { dryRun: false })

      const report = await rollbackRentalFlowConfigs(database)

      expect(report.dryRun).toBe(true)
      expect(report.updated).toBe(3)
      expect(collections.rental_flow_configs?.docs).toHaveLength(3)
      expect(collections.rental_flow_configs?.indexes.size).toBe(1)
    })

    it('restores the legacy shape, then drops the new rows and the index', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      const original = JSON.stringify([
        collections.rental_flow_profiles?.docs,
        collections.rental_execution_policies?.docs,
      ])
      await migrateRentalFlowConfigs(database, { dryRun: false })

      const report = await rollbackRentalFlowConfigs(database, {
        dryRun: false,
      })

      expect(report.errors).toEqual([])
      expect(report.counts).toEqual({
        profile: { source: 2, target: 0 },
        policy: { source: 1, target: 0 },
      })
      expect(collections.rental_flow_configs?.docs).toHaveLength(0)
      expect(collections.rental_flow_configs?.indexes.size).toBe(0)
      expect(
        JSON.stringify([
          collections.rental_flow_profiles?.docs,
          collections.rental_execution_policies?.docs,
        ])
      ).toBe(original)
    })

    it('copies back changes and rows written after the code switch', async () => {
      const { database, collections } = buildDatabase()
      const ids = seed(collections)
      await migrateRentalFlowConfigs(database, { dryRun: false })
      const target = collections.rental_flow_configs as FakeCollection

      // sau khi chuyển code: policy bị lưu trữ, có policy và profile mới
      const policyRow = target.docs.find(d => d._id.equals(ids.policyId)) as Doc
      policyRow.status = 'archived'
      policyRow.archivedAt = t(9)
      const newPolicyId = new ObjectId()
      const newProfileId = new ObjectId()
      target.docs.push(
        {
          _id: newPolicyId,
          kind: 'policy',
          key: 'sign-first',
          status: 'draft',
          strategy: 'SIGN_FIRST',
        },
        {
          _id: newProfileId,
          kind: 'profile',
          key: 'custom',
          status: 'draft',
          draftRevision: 3,
        }
      )

      const report = await rollbackRentalFlowConfigs(database, {
        dryRun: false,
      })

      expect(report.errors).toEqual([])
      expect(report.restored).toBe(5)
      const policies = collections.rental_execution_policies as FakeCollection
      expect(policies.docs.find(d => d._id.equals(ids.policyId))).toMatchObject(
        {
          policyId: 'deposit-first',
          status: 'archived',
          archivedAt: t(9),
        }
      )
      expect(policies.docs.find(d => d._id.equals(newPolicyId))).toMatchObject({
        policyId: 'sign-first',
        strategy: 'SIGN_FIRST',
      })
      expect(
        (collections.rental_flow_profiles as FakeCollection).docs.find(d =>
          d._id.equals(newProfileId)
        )
      ).toMatchObject({ profileId: 'custom', draftRevision: 3 })
      expect(
        (collections.rental_flow_profiles as FakeCollection).docs[0]
      ).not.toHaveProperty('kind')
      expect(target.docs).toHaveLength(0)
    })

    it('keeps the new rows and the index when restoring fails the count check', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      await migrateRentalFlowConfigs(database, { dryRun: false })
      const policies = collections.rental_execution_policies as FakeCollection
      policies.replaceOne = (): Promise<{ matchedCount?: number }> =>
        Promise.resolve({ matchedCount: 0 })
      const target = collections.rental_flow_configs as FakeCollection
      target.docs.push({
        _id: new ObjectId(),
        kind: 'policy',
        key: 'new',
        status: 'draft',
      })
      policies.updateOne = (): Promise<{ upsertedCount?: number }> =>
        Promise.resolve({ upsertedCount: 0 })

      const report = await rollbackRentalFlowConfigs(database, {
        dryRun: false,
      })

      expect(report.errors).toHaveLength(1)
      expect(target.docs.filter(d => d.kind === 'policy')).toHaveLength(2)
      expect(target.indexes.size).toBe(1)
    })
  })
})
