import { ObjectId } from 'mongodb'
import {
  CONFIG_AUDIT_INDEXES,
  MERGE_CONFIG_AUDITS_MIGRATION_ID,
  migrateMergeConfigAudits,
  rollbackMergeConfigAudits,
  type AuditMongoCollection,
  type ConfigAuditMongoDatabase,
} from './010-merge-config-audits'

type Doc = Record<string, unknown> & { _id: ObjectId }

class FakeCollection implements AuditMongoCollection {
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
  database: ConfigAuditMongoDatabase
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

describe('010 merge config audits migration', () => {
  const t = (n: number): Date => new Date(Date.UTC(2026, 0, n))
  function seed(collections: Record<string, FakeCollection>): {
    ids: { layout: ObjectId; template: ObjectId; fee: ObjectId; flow: ObjectId }
  } {
    const ids = {
      layout: new ObjectId(),
      template: new ObjectId(),
      fee: new ObjectId(),
      flow: new ObjectId(),
    }
    collections.contract_layout_audits = new FakeCollection()
    collections.contract_layout_audits.docs.push({
      _id: ids.layout,
      profileKey: 'standard',
      version: 1,
      action: 'protected-change-denied',
      actorId: 'a1',
      deniedField: 'blocks',
      createdAt: t(1),
    })
    collections.contract_template_audits = new FakeCollection()
    collections.contract_template_audits.docs.push({
      _id: ids.template,
      templateKey: 'VN_RE',
      version: 2,
      action: 'legal-release-published',
      actorId: 'system',
      reason: null,
      reviewReference: 'REV-1',
      metadata: { a: 'b' },
      afterHash: 'h',
      createdAt: t(2),
    })
    collections.platform_fee_audits = new FakeCollection()
    collections.platform_fee_audits.docs.push({
      _id: ids.fee,
      scheduleId: 'fee-1',
      version: 1,
      action: 'published',
      actorId: 'a2',
      reason: 'go',
      changedFields: ['status'],
      beforeHash: 'x',
      afterHash: 'x',
      createdAt: t(3),
    })
    collections.rental_flow_audits = new FakeCollection()
    collections.rental_flow_audits.docs.push({
      _id: ids.flow,
      action: 'PROFILE_PUBLISHED',
      actorId: 'a3',
      targetType: 'profile',
      targetId: 'prof-1',
      version: null,
      details: { contentHash: 'c' },
      createdAt: t(4),
    })
    return { ids }
  }

  it('is a dry run by default: reads and counts but writes nothing', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)

    const report = await migrateMergeConfigAudits(database)

    expect(report).toMatchObject({
      migrationId: MERGE_CONFIG_AUDITS_MIGRATION_ID,
      dryRun: true,
      scanned: 4,
      updated: 4,
      skipped: 0,
      errors: [],
    })
    expect(collections.config_audits?.docs ?? []).toHaveLength(0)
    expect(collections.config_audits?.indexes.size ?? 0).toBe(0)
  })

  it('copies verbatim by _id, maps scope-specific fields, verifies counts per scope and creates both indexes', async () => {
    const { database, collections } = buildDatabase()
    const { ids } = seed(collections)

    const report = await migrateMergeConfigAudits(database, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(report).toMatchObject({ scanned: 4, updated: 4, skipped: 0 })
    expect(report.counts).toEqual({
      'contract-layout': { source: 1, target: 1 },
      'contract-template': { source: 1, target: 1 },
      'platform-fee': { source: 1, target: 1 },
      'rental-flow': { source: 1, target: 1 },
    })
    const target = collections.config_audits as FakeCollection
    const byId = (id: ObjectId): Doc =>
      target.docs.find(d => d._id.equals(id)) as Doc
    expect(byId(ids.layout)).toEqual({
      _id: ids.layout,
      scope: 'contract-layout',
      key: 'standard',
      version: 1,
      action: 'protected-change-denied',
      actorId: 'a1',
      details: { deniedField: 'blocks' },
      createdAt: t(1),
    })
    expect(byId(ids.template)).toEqual({
      _id: ids.template,
      scope: 'contract-template',
      key: 'VN_RE',
      version: 2,
      action: 'legal-release-published',
      actorId: 'system',
      reason: null,
      afterHash: 'h',
      details: { reviewReference: 'REV-1', metadata: { a: 'b' } },
      createdAt: t(2),
    })
    expect(byId(ids.fee)).toEqual({
      _id: ids.fee,
      scope: 'platform-fee',
      key: 'fee-1',
      version: 1,
      action: 'published',
      actorId: 'a2',
      reason: 'go',
      beforeHash: 'x',
      afterHash: 'x',
      details: { changedFields: ['status'] },
      createdAt: t(3),
    })
    expect(byId(ids.flow)).toEqual({
      _id: ids.flow,
      scope: 'rental-flow',
      key: 'prof-1',
      version: null,
      action: 'PROFILE_PUBLISHED',
      actorId: 'a3',
      targetType: 'profile',
      details: { contentHash: 'c' },
      createdAt: t(4),
    })
    expect([...target.indexes.keys()].sort()).toEqual(
      CONFIG_AUDIT_INDEXES.map(i => i.name).sort()
    )
    expect(
      target.indexes.get('config_audits_scope_key_version_created')
    ).toEqual({ scope: 1, key: 1, version: 1, createdAt: 1 })
    expect(target.indexes.get('config_audits_scope_created')).toEqual({
      scope: 1,
      createdAt: 1,
    })
    // 4 collection cũ không bị đụng tới
    expect(collections.contract_layout_audits?.docs).toHaveLength(1)
    expect(collections.rental_flow_audits?.docs).toHaveLength(1)
  })

  it('is idempotent: a second apply copies nothing and keeps rows written since', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)
    await migrateMergeConfigAudits(database, { dryRun: false })
    const target = collections.config_audits as FakeCollection
    target.docs.push({
      _id: new ObjectId(),
      scope: 'rental-flow',
      key: 'new',
      action: 'DRAFT_SAVED',
      actorId: 'a9',
      createdAt: t(9),
    })

    const second = await migrateMergeConfigAudits(database, { dryRun: false })

    expect(second).toMatchObject({ scanned: 4, updated: 0, skipped: 4 })
    expect(second.errors).toEqual([])
    expect(second.counts['rental-flow']).toEqual({ source: 1, target: 2 })
    expect(target.docs).toHaveLength(5)
  })

  it('reports a source document without its key instead of copying it', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)
    collections.platform_fee_audits?.docs.push({
      _id: new ObjectId(),
      action: 'published',
      actorId: 'a2',
      createdAt: t(3),
    })

    const report = await migrateMergeConfigAudits(database, { dryRun: false })

    expect(report.errors).toHaveLength(1)
    expect(report.errors[0]).toContain('platform_fee_audits')
  })

  it('throws when a source document is missing from the target after apply', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)
    const target = (collections.config_audits ??= new FakeCollection())
    // rows written after the code switch must not mask a missing source row
    target.docs.push(
      ...[1, 2, 3, 4].map(n => ({
        _id: new ObjectId(),
        scope: 'rental-flow',
        key: 'new-' + String(n),
        createdAt: t(9),
      }))
    )
    target.updateOne = (): Promise<{ upsertedCount?: number }> =>
      Promise.resolve({ upsertedCount: 0 }) // drops writes

    await expect(
      migrateMergeConfigAudits(database, { dryRun: false })
    ).rejects.toThrow('count mismatch')
  })

  it('rolls back: copies post-cutover rows to the legacy collections by scope with reversed mapping, then empties the scope', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)
    await migrateMergeConfigAudits(database, { dryRun: false })
    const target = collections.config_audits as FakeCollection
    const ids = {
      layout: new ObjectId(),
      template: new ObjectId(),
      fee: new ObjectId(),
      flow: new ObjectId(),
    }
    target.docs.push(
      {
        _id: ids.layout,
        scope: 'contract-layout',
        key: 'standard',
        version: 2,
        action: 'protected-change-denied',
        actorId: 'a1',
        details: { deniedField: 'blocks' },
        createdAt: t(11),
      },
      {
        _id: ids.template,
        scope: 'contract-template',
        key: 'VN_RE',
        version: 3,
        action: 'legal-release-published',
        actorId: 's',
        details: { reviewReference: 'REV-2', metadata: { z: 1 } },
        createdAt: t(12),
      },
      {
        _id: ids.fee,
        scope: 'platform-fee',
        key: 'fee-2',
        version: 1,
        action: 'published',
        actorId: 'a2',
        details: { changedFields: ['rate'] },
        createdAt: t(13),
      },
      {
        _id: ids.flow,
        scope: 'rental-flow',
        key: 'prof-2',
        targetType: 'profile',
        action: 'DRAFT_SAVED',
        actorId: 'a3',
        details: { contentHash: 'q' },
        createdAt: t(14),
      }
    )

    const dry = await rollbackMergeConfigAudits(database)
    expect(dry).toMatchObject({ dryRun: true, restored: 4, updated: 8 })
    expect(target.docs).toHaveLength(8)
    expect(collections.rental_flow_audits?.docs).toHaveLength(1)

    const report = await rollbackMergeConfigAudits(database, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(report).toMatchObject({ restored: 4, updated: 8 })
    const legacyOf = (name: string, id: ObjectId): Doc =>
      collections[name]?.docs.find(d => d._id.equals(id)) as Doc
    expect(legacyOf('contract_layout_audits', ids.layout)).toEqual({
      _id: ids.layout,
      profileKey: 'standard',
      version: 2,
      action: 'protected-change-denied',
      actorId: 'a1',
      deniedField: 'blocks',
      createdAt: t(11),
    })
    expect(legacyOf('contract_template_audits', ids.template)).toEqual({
      _id: ids.template,
      templateKey: 'VN_RE',
      version: 3,
      action: 'legal-release-published',
      actorId: 's',
      reviewReference: 'REV-2',
      metadata: { z: 1 },
      createdAt: t(12),
    })
    expect(legacyOf('platform_fee_audits', ids.fee)).toEqual({
      _id: ids.fee,
      scheduleId: 'fee-2',
      version: 1,
      action: 'published',
      actorId: 'a2',
      changedFields: ['rate'],
      createdAt: t(13),
    })
    expect(legacyOf('rental_flow_audits', ids.flow)).toEqual({
      _id: ids.flow,
      targetId: 'prof-2',
      targetType: 'profile',
      action: 'DRAFT_SAVED',
      actorId: 'a3',
      details: { contentHash: 'q' },
      createdAt: t(14),
    })
    expect(target.docs).toHaveLength(0)
    expect(target.indexes.size).toBe(0)
  })

  it('does not empty a scope when copying back failed', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)
    await migrateMergeConfigAudits(database, { dryRun: false })
    const target = collections.config_audits as FakeCollection
    target.docs.push({
      _id: new ObjectId(),
      scope: 'rental-flow',
      key: 'new',
      action: 'DRAFT_SAVED',
      actorId: 'a9',
      createdAt: t(9),
    })
    const legacyFlow = collections.rental_flow_audits as FakeCollection
    legacyFlow.updateOne = (): Promise<{ upsertedCount?: number }> =>
      Promise.resolve({ upsertedCount: 0 })

    const report = await rollbackMergeConfigAudits(database, { dryRun: false })

    expect(report.errors).toHaveLength(1)
    expect(target.docs.filter(d => d.scope === 'rental-flow')).toHaveLength(2)
    expect(target.docs.filter(d => d.scope === 'contract-layout')).toHaveLength(
      0
    )
  })

  it('rolls back only the copied rows and indexes, keeping the old collections', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)
    await migrateMergeConfigAudits(database, { dryRun: false })
    const target = collections.config_audits as FakeCollection
    const newRowId = new ObjectId()
    target.docs.push({
      _id: newRowId,
      scope: 'rental-flow',
      key: 'new',
      action: 'DRAFT_SAVED',
      actorId: 'a9',
      createdAt: t(9),
    })

    const dry = await rollbackMergeConfigAudits(database)
    expect(dry).toMatchObject({ dryRun: true, updated: 5, restored: 1 })
    expect(target.docs).toHaveLength(5)

    const report = await rollbackMergeConfigAudits(database, { dryRun: false })

    expect(report).toMatchObject({
      scanned: 4,
      updated: 5,
      skipped: 0,
      restored: 1,
    })
    expect(target.docs).toHaveLength(0)
    expect(
      collections.rental_flow_audits?.docs.some(d => d._id.equals(newRowId))
    ).toBe(true)
    expect(target.indexes.size).toBe(0)
    expect(collections.contract_template_audits?.docs).toHaveLength(1)
    expect(collections.platform_fee_audits?.docs).toHaveLength(1)

    const again = await rollbackMergeConfigAudits(database, { dryRun: false })
    expect(again).toMatchObject({ updated: 0, skipped: 5, errors: [] })
  })
})
