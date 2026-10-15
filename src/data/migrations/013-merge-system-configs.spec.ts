/* eslint-disable @typescript-eslint/explicit-function-return-type -- in-memory fakes */
import { ObjectId } from 'mongodb'
import {
  MERGE_SYSTEM_CONFIGS_MIGRATION_ID,
  SYSTEM_CONFIG_INDEX,
  migrateMergeSystemConfigs,
  rollbackMergeSystemConfigs,
  type SystemConfigMongoCollection,
  type SystemConfigMongoDatabase,
} from './013-merge-system-configs'

type Doc = Record<string, unknown> & { _id: ObjectId }

class FakeCollection implements SystemConfigMongoCollection {
  docs: Doc[] = []
  indexes = new Map<
    string,
    { keys: Record<string, 1 | -1>; unique?: boolean | undefined }
  >()
  writes = 0

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
  ): Promise<unknown> {
    const target = this.docs.find(d => this.matches(d, filter))
    if (target) {
      if (update.$set) {
        this.writes += 1
        Object.assign(target, update.$set)
      }
      return Promise.resolve({})
    }
    if (!options?.upsert) return Promise.resolve({})
    this.writes += 1
    this.docs.push({
      ...(filter as { _id: ObjectId }),
      ...(update.$setOnInsert as Record<string, unknown>),
    })
    return Promise.resolve({})
  }

  deleteMany(
    filter: Record<string, unknown>
  ): Promise<{ deletedCount?: number }> {
    const before = this.docs.length
    this.docs = this.docs.filter(d => !this.matches(d, filter))
    this.writes += 1
    return Promise.resolve({ deletedCount: before - this.docs.length })
  }

  createIndex(
    keys: Record<string, 1 | -1>,
    options?: { name?: string; unique?: boolean }
  ): Promise<string> {
    const name = options?.name ?? JSON.stringify(keys)
    this.indexes.set(name, { keys, unique: options?.unique })
    return Promise.resolve(name)
  }

  dropIndex(name: string): Promise<unknown> {
    if (!this.indexes.delete(name)) return Promise.reject(new Error('no index'))
    return Promise.resolve()
  }
}

function setup(): {
  db: SystemConfigMongoDatabase
  jobs: FakeCollection
  recs: FakeCollection
  target: FakeCollection
} {
  const jobs = new FakeCollection()
  const recs = new FakeCollection()
  const target = new FakeCollection()
  const db: SystemConfigMongoDatabase = {
    collection: name =>
      name === 'job_configs'
        ? jobs
        : name === 'recommendation_configs'
          ? recs
          : target,
  }
  return { db, jobs, recs, target }
}

const t0 = new Date('2026-01-01T00:00:00Z')

function seedLegacy(jobs: FakeCollection, recs: FakeCollection) {
  const j1 = {
    _id: new ObjectId(),
    jobName: 'job-a',
    enabled: false,
    createdAt: t0,
    updatedAt: t0,
  }
  const j2 = {
    _id: new ObjectId(),
    jobName: 'job-b',
    enabled: true,
    createdAt: t0,
    updatedAt: t0,
  }
  const r1 = {
    _id: new ObjectId(),
    configId: 'global',
    strategy: 'map',
    alpha: 2,
    nbWeight: 0.7,
    ruleWeight: 0.3,
    updatedAt: t0,
    updatedBy: 'admin@x.vn',
  }
  jobs.docs.push(j1, j2)
  recs.docs.push(r1)
  return { j1, j2, r1 }
}

describe('013-merge-system-configs', () => {
  it('dry-run counts but writes nothing', async () => {
    const { db, jobs, recs, target } = setup()
    seedLegacy(jobs, recs)

    const report = await migrateMergeSystemConfigs(db)

    expect(report).toMatchObject({
      migrationId: MERGE_SYSTEM_CONFIGS_MIGRATION_ID,
      dryRun: true,
      scanned: 3,
      updated: 3,
      errors: [],
    })
    expect(report.counts.job.source).toBe(2)
    expect(target.docs).toHaveLength(0)
    expect(target.indexes.size).toBe(0)
  })

  it('copies by _id with scope/key, creates the unique index and is idempotent', async () => {
    const { db, jobs, recs, target } = setup()
    const { j1, r1 } = seedLegacy(jobs, recs)

    const first = await migrateMergeSystemConfigs(db, { dryRun: false })

    expect(first).toMatchObject({ updated: 3, errors: [] })
    expect(first.counts).toEqual({
      job: { source: 2, target: 2 },
      recommendation: { source: 1, target: 1 },
    })
    expect(target.docs.find(d => d._id.equals(j1._id))).toEqual({
      _id: j1._id,
      scope: 'job',
      key: 'job-a',
      enabled: false,
      createdAt: t0,
      updatedAt: t0,
    })
    expect(target.docs.find(d => d._id.equals(r1._id))).toMatchObject({
      scope: 'recommendation',
      key: 'global',
      strategy: 'map',
      updatedBy: 'admin@x.vn',
    })
    expect(target.indexes.get(SYSTEM_CONFIG_INDEX.name)).toEqual({
      keys: { scope: 1, key: 1 },
      unique: true,
    })
    expect(jobs.docs).toHaveLength(2)
    expect(recs.docs).toHaveLength(1)

    const writes = target.writes
    const second = await migrateMergeSystemConfigs(db, { dryRun: false })
    expect(second).toMatchObject({ updated: 0, skipped: 3, errors: [] })
    expect(target.writes).toBe(writes)
  })

  it('copies only the first recommendation config per key and reports the rest', async () => {
    const { db, recs, target } = setup()
    const first = { _id: new ObjectId(), configId: 'global', alpha: 1 }
    const dup = { _id: new ObjectId(), configId: 'global', alpha: 9 }
    recs.docs.push(first, dup)

    const report = await migrateMergeSystemConfigs(db, { dryRun: false })

    expect(report.duplicateIds).toEqual([
      `recommendation_configs:${String(dup._id)}`,
    ])
    expect(target.docs).toHaveLength(1)
    expect(target.docs[0]?._id.equals(first._id)).toBe(true)
  })

  it('reports a key clash with a different _id instead of overwriting', async () => {
    const { db, jobs, target } = setup()
    jobs.docs.push({
      _id: new ObjectId(),
      jobName: 'job-a',
      enabled: false,
      createdAt: t0,
      updatedAt: t0,
    })
    target.docs.push({
      _id: new ObjectId(),
      scope: 'job',
      key: 'job-a',
      enabled: true,
    })

    const report = await migrateMergeSystemConfigs(db, { dryRun: false })

    expect(report.errors).toHaveLength(1)
    expect(target.docs).toHaveLength(1)
    expect(target.docs[0]?.enabled).toBe(true)
  })

  it('rolls back including configs created and changed after the code switch', async () => {
    const { db, jobs, recs, target } = setup()
    const { j1, r1 } = seedLegacy(jobs, recs)
    await migrateMergeSystemConfigs(db, { dryRun: false })

    // Sau khi chuyển code: job-a bật lại, cấu hình engine đổi, thêm job mới.
    const t1 = new Date('2026-02-01T00:00:00Z')
    Object.assign(target.docs.find(d => d._id.equals(j1._id)) as Doc, {
      enabled: true,
      updatedAt: t1,
    })
    Object.assign(target.docs.find(d => d._id.equals(r1._id)) as Doc, {
      strategy: 'weighted',
      updatedBy: 'new@x.vn',
      updatedAt: t1,
    })
    const fresh = {
      _id: new ObjectId(),
      scope: 'job',
      key: 'job-c',
      enabled: false,
      createdAt: t1,
      updatedAt: t1,
    }
    target.docs.push(fresh)

    const dry = await rollbackMergeSystemConfigs(db)
    expect(dry).toMatchObject({ dryRun: true, restored: 4 })
    expect(jobs.docs).toHaveLength(2)
    expect(target.docs).toHaveLength(4)

    const report = await rollbackMergeSystemConfigs(db, { dryRun: false })

    expect(report).toMatchObject({ restored: 4, errors: [] })
    expect(jobs.docs.find(d => d.jobName === 'job-a')).toMatchObject({
      enabled: true,
      updatedAt: t1,
    })
    expect(jobs.docs.find(d => d.jobName === 'job-c')).toMatchObject({
      _id: fresh._id,
      enabled: false,
    })
    expect(recs.docs[0]).toMatchObject({
      configId: 'global',
      strategy: 'weighted',
      updatedBy: 'new@x.vn',
    })
    expect(target.docs).toHaveLength(0)
    expect(target.indexes.size).toBe(0)

    // Chạy lại: không còn gì để làm.
    const again = await rollbackMergeSystemConfigs(db, { dryRun: false })
    expect(again).toMatchObject({ scanned: 0, restored: 0, errors: [] })
  })

  it('rollback matches by key when code switched before migrating (no duplicate legacy key)', async () => {
    const { db, jobs, target } = setup()
    const legacy = {
      _id: new ObjectId(),
      jobName: 'job-a',
      enabled: false,
      createdAt: t0,
      updatedAt: t0,
    }
    jobs.docs.push(legacy)
    target.docs.push({
      _id: new ObjectId(),
      scope: 'job',
      key: 'job-a',
      enabled: true,
      createdAt: t0,
      updatedAt: t0,
    })

    await rollbackMergeSystemConfigs(db, { dryRun: false })

    expect(jobs.docs).toHaveLength(1)
    expect(jobs.docs[0]).toMatchObject({ _id: legacy._id, enabled: true })
  })
})
