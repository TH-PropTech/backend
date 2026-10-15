import { ObjectId } from 'mongodb'
import {
  RENTAL_FLOW_ASSIGNMENT_INDEXES,
  RENTAL_FLOW_ASSIGNMENTS_MERGE_MIGRATION_ID,
  migrateRentalFlowAssignments,
  rollbackRentalFlowAssignments,
  type RentalFlowAssignmentIndexOptions,
  type RentalFlowAssignmentMongoCollection,
  type RentalFlowAssignmentMongoDatabase,
} from './024-rental-flow-assignments-merge'

type Doc = Record<string, unknown> & { _id: ObjectId }

class FakeCollection implements RentalFlowAssignmentMongoCollection {
  docs: Doc[] = []
  indexes = new Map<
    string,
    {
      keys: Record<string, 1 | -1>
      options: RentalFlowAssignmentIndexOptions | undefined
    }
  >()

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
    options?: RentalFlowAssignmentIndexOptions
  ): Promise<string> {
    const name = options?.name ?? JSON.stringify(keys)
    this.indexes.set(name, { keys, options })
    return Promise.resolve(name)
  }

  dropIndex(name: string): Promise<unknown> {
    if (!this.indexes.delete(name)) return Promise.reject(new Error('no index'))
    return Promise.resolve()
  }
}

interface Tables {
  rental_flow_assignments: FakeCollection
  rental_flow_configs: FakeCollection
}

function buildDatabase(): {
  database: RentalFlowAssignmentMongoDatabase
  collections: Tables
} {
  const collections: Tables = {
    rental_flow_assignments: new FakeCollection(),
    rental_flow_configs: new FakeCollection(),
  }
  return {
    collections,
    database: {
      collection: (name: string): RentalFlowAssignmentMongoCollection => {
        if (
          name === 'rental_flow_assignments' ||
          name === 'rental_flow_configs'
        )
          return collections[name]
        throw new Error(`unexpected collection ${name}`)
      },
    },
  }
}

const t = (n: number): Date => new Date(Date.UTC(2026, 0, n))

const KEY_INDEX_NAME = 'rental_flow_configs_assignment_key'
const SCOPE_INDEX = RENTAL_FLOW_ASSIGNMENT_INDEXES.find(
  i => i.name === 'rental_flow_configs_assignment_scope_superseded'
)

describe('024 rental flow assignments merge migration', () => {
  /**
   * Nguồn có hai assignment; đích đã có một profile có key trùng với assignmentId
   * (bẫy: khóa trùng khác kind không được coi là trùng assignment).
   */
  function seed(collections: Tables): {
    seedId: ObjectId
    durId: ObjectId
    trapId: ObjectId
  } {
    const ids = {
      seedId: new ObjectId(),
      durId: new ObjectId(),
      trapId: new ObjectId(),
    }
    collections.rental_flow_assignments = new FakeCollection()
    collections.rental_flow_assignments.docs.push(
      {
        _id: ids.seedId,
        assignmentId: 'asgn-global-seed',
        scope: 'GLOBAL',
        scopeValue: null,
        profileRef: {
          profileId: 'safe-default-profile',
          version: 1,
          contentHash: 'h1',
        },
        effectiveAt: t(1),
        supersededAt: null,
        createdBy: 'system',
        createdAt: t(1),
        updatedAt: t(1),
      },
      {
        _id: ids.durId,
        assignmentId: 'asgn-dur',
        scope: 'DURATION',
        scopeValue: '12',
        profileRef: { profileId: 'prof-vip', version: 2, contentHash: 'h2' },
        effectiveAt: t(2),
        supersededAt: t(3),
        createdBy: 'admin',
        createdAt: t(2),
        updatedAt: t(3),
      }
    )
    collections.rental_flow_configs = new FakeCollection()
    collections.rental_flow_configs.docs.push({
      _id: ids.trapId,
      kind: 'profile',
      key: 'asgn-dur',
      name: 'Profile trùng khóa',
      status: 'published',
      version: 1,
    })
    return ids
  }

  it('is a dry run by default: reads and counts but writes nothing', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)

    const report = await migrateRentalFlowAssignments(database)

    expect(report).toMatchObject({
      migrationId: RENTAL_FLOW_ASSIGNMENTS_MERGE_MIGRATION_ID,
      dryRun: true,
      scanned: 2,
      updated: 2,
      skipped: 0,
      errors: [],
      counts: { source: 2, target: 0 },
    })
    expect(
      collections.rental_flow_configs.docs.filter(d => d.kind === 'assignment')
    ).toHaveLength(0)
    expect(collections.rental_flow_configs.indexes.size).toBe(0)
  })

  it('copies by _id with kind/key, drops assignmentId, keeps other fields, creates both indexes', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)

    const report = await migrateRentalFlowAssignments(database, {
      dryRun: false,
    })

    expect(report).toMatchObject({
      dryRun: false,
      updated: 2,
      skipped: 0,
      errors: [],
      counts: { source: 2, target: 2 },
    })
    const target = collections.rental_flow_configs
    const moved = target.docs.find(d => d._id.equals(ids.durId))
    expect(moved).toMatchObject({
      kind: 'assignment',
      key: 'asgn-dur',
      scope: 'DURATION',
      scopeValue: '12',
      profileRef: { profileId: 'prof-vip', version: 2, contentHash: 'h2' },
      supersededAt: t(3),
      createdBy: 'admin',
    })
    expect(moved).not.toHaveProperty('assignmentId')
    expect(target.docs.find(d => d._id.equals(ids.trapId))).toMatchObject({
      kind: 'profile',
      key: 'asgn-dur',
    })
    expect([...target.indexes.keys()].sort()).toEqual(
      RENTAL_FLOW_ASSIGNMENT_INDEXES.map(i => i.name).sort()
    )
    expect(SCOPE_INDEX).toBeDefined()
    expect(target.indexes.get(KEY_INDEX_NAME)).toMatchObject({
      keys: { kind: 1, key: 1 },
      options: {
        partialFilterExpression: { kind: 'assignment' },
      },
    })
    expect(target.indexes.get(SCOPE_INDEX?.name ?? '')).toMatchObject({
      keys: { kind: 1, scope: 1, scopeValue: 1, supersededAt: 1 },
    })
  })

  it('is idempotent: running twice copies nothing the second time', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)
    await migrateRentalFlowAssignments(database, { dryRun: false })

    const again = await migrateRentalFlowAssignments(database, {
      dryRun: false,
    })

    expect(again).toMatchObject({ updated: 0, skipped: 2, errors: [] })
    expect(
      collections.rental_flow_configs.docs.filter(d => d.kind === 'assignment')
    ).toHaveLength(2)
  })

  it('applies and warns when a source row lacks assignmentId, keeping the row without inventing a key', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)
    const noKeyId = new ObjectId()
    const badTypeId = new ObjectId()
    collections.rental_flow_assignments.docs.push(
      { _id: noKeyId, scope: 'GLOBAL' },
      { _id: badTypeId, assignmentId: 77, scope: 'GLOBAL' }
    )

    const dry = await migrateRentalFlowAssignments(database)
    expect(dry.errors).toEqual([])
    expect(dry.warnings).toHaveLength(2)
    expect(dry.counts).toEqual({ source: 4, target: 0 })
    expect(
      collections.rental_flow_configs.docs.filter(d => d.kind === 'assignment')
    ).toHaveLength(0)

    const report = await migrateRentalFlowAssignments(database, {
      dryRun: false,
    })

    expect(report.errors).toEqual([])
    expect(report.warnings).toHaveLength(2)
    expect(report.warnings.join('\n')).toContain(
      `rental_flow_assignments:${noKeyId.toString()}`
    )
    expect(report.counts).toEqual({ source: 4, target: 4 })
    const target = collections.rental_flow_configs
    const noKey = target.docs.find(d => d._id.equals(noKeyId)) as Doc
    expect(noKey).toEqual({ _id: noKeyId, kind: 'assignment', scope: 'GLOBAL' })
    expect(noKey).not.toHaveProperty('key')
    const badType = target.docs.find(d => d._id.equals(badTypeId))
    expect(badType).toMatchObject({ kind: 'assignment', key: 77 })
    expect(target.indexes.size).toBe(RENTAL_FLOW_ASSIGNMENT_INDEXES.length)
  })

  it('rollback restores dirty source rows exactly (no invented assignmentId)', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)
    collections.rental_flow_assignments.docs.push(
      { _id: new ObjectId(), scope: 'GLOBAL' },
      { _id: new ObjectId(), assignmentId: 77, scope: 'GLOBAL' }
    )
    const before = JSON.stringify(collections.rental_flow_assignments.docs)
    await migrateRentalFlowAssignments(database, { dryRun: false })

    const report = await rollbackRentalFlowAssignments(database, {
      dryRun: false,
    })

    expect(report.errors).toEqual([])
    expect(
      collections.rental_flow_configs.docs.filter(d => d.kind === 'assignment')
    ).toHaveLength(0)
    expect(JSON.stringify(collections.rental_flow_assignments.docs)).toBe(
      before
    )
  })

  it('refuses when an existing target row with the same _id has another kind', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)
    collections.rental_flow_configs.docs.push({
      _id: ids.durId,
      kind: 'policy',
      key: 'other',
    })

    const dry = await migrateRentalFlowAssignments(database)
    expect(dry.errors).toHaveLength(1)

    await expect(
      migrateRentalFlowAssignments(database, { dryRun: false })
    ).rejects.toThrow('refusing to apply')
  })

  it('applies when a target assignment already has the same assignmentId under another _id (no unique)', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)
    const otherId = new ObjectId()
    collections.rental_flow_configs.docs.push({
      _id: otherId,
      kind: 'assignment',
      key: 'asgn-dur',
    })

    const dry = await migrateRentalFlowAssignments(database)
    expect(dry.errors).toHaveLength(0)

    const report = await migrateRentalFlowAssignments(database, {
      dryRun: false,
    })
    expect(report).toMatchObject({ updated: 2, skipped: 0, errors: [] })
    const assignments = collections.rental_flow_configs.docs.filter(
      d => d.kind === 'assignment'
    )
    expect(assignments).toHaveLength(3)
    expect(assignments.some(d => d._id.equals(ids.durId))).toBe(true)
    expect(assignments.some(d => d._id.equals(otherId))).toBe(true)
  })

  it('copies every source row when several share one assignmentId (distinct _id), idempotent, rollback restores all', async () => {
    const { database, collections } = buildDatabase()
    const dupIds = [new ObjectId(), new ObjectId(), new ObjectId()]
    collections.rental_flow_assignments = new FakeCollection()
    collections.rental_flow_assignments.docs.push(
      ...dupIds.map((_id, i) => ({
        _id,
        assignmentId: 'asgn-dup',
        scope: 'DURATION',
        scopeValue: String(i),
        supersededAt: null,
      }))
    )

    const report = await migrateRentalFlowAssignments(database, {
      dryRun: false,
    })
    expect(report).toMatchObject({
      updated: 3,
      skipped: 0,
      errors: [],
      counts: { source: 3, target: 3 },
    })
    const target = collections.rental_flow_configs
    const copied = target.docs.filter(d => d.kind === 'assignment')
    expect(copied).toHaveLength(3)
    for (const id of dupIds) {
      expect(copied.some(d => d._id.equals(id))).toBe(true)
    }
    expect(copied.every(d => d.key === 'asgn-dup')).toBe(true)

    const again = await migrateRentalFlowAssignments(database, {
      dryRun: false,
    })
    expect(again).toMatchObject({ updated: 0, skipped: 3, errors: [] })
    expect(target.docs.filter(d => d.kind === 'assignment')).toHaveLength(3)

    const back = await rollbackRentalFlowAssignments(database, {
      dryRun: false,
    })
    expect(back).toMatchObject({ errors: [] })
    const legacy = collections.rental_flow_assignments.docs
    expect(legacy).toHaveLength(3)
    for (const id of dupIds) {
      expect(legacy.find(d => d._id.equals(id))).toMatchObject({
        assignmentId: 'asgn-dup',
      })
    }
    expect(target.docs.filter(d => d.kind === 'assignment')).toHaveLength(0)
  })

  it('creates the assignment key index as non-unique (partial on kind assignment)', async () => {
    const { database, collections } = buildDatabase()
    seed(collections)

    await migrateRentalFlowAssignments(database, { dryRun: false })

    const index = collections.rental_flow_configs.indexes.get(KEY_INDEX_NAME)
    expect(index).toBeDefined()
    expect(index?.options).not.toHaveProperty('unique')
    expect(index?.options?.partialFilterExpression).toEqual({
      kind: 'assignment',
    })
    expect(RENTAL_FLOW_ASSIGNMENT_INDEXES.some(i => 'unique' in i)).toBe(false)
  })

  it('throws when a source _id is missing from the target after writing', async () => {
    const { database, collections } = buildDatabase()
    const ids = seed(collections)
    const target = collections.rental_flow_configs
    const realUpdate = target.updateOne.bind(target)
    target.updateOne = (
      filter,
      update,
      options
    ): Promise<{ upsertedCount?: number }> =>
      (filter._id as ObjectId).equals(ids.seedId)
        ? Promise.resolve({ upsertedCount: 0 })
        : realUpdate(filter, update, options)

    await expect(
      migrateRentalFlowAssignments(database, { dryRun: false })
    ).rejects.toThrow('count mismatch for kind assignment')
  })

  describe('rollback', () => {
    it('is a dry run by default and changes nothing', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      await migrateRentalFlowAssignments(database, { dryRun: false })

      const report = await rollbackRentalFlowAssignments(database)

      expect(report).toMatchObject({ dryRun: true, errors: [] })
      expect(
        collections.rental_flow_configs.docs.filter(
          d => d.kind === 'assignment'
        )
      ).toHaveLength(2)
      expect(collections.rental_flow_configs.indexes.size).toBe(
        RENTAL_FLOW_ASSIGNMENT_INDEXES.length
      )
    })

    it('restores the legacy shape, then drops the assignment rows and both indexes, keeping other kinds', async () => {
      const { database, collections } = buildDatabase()
      const ids = seed(collections)
      await migrateRentalFlowAssignments(database, { dryRun: false })

      const report = await rollbackRentalFlowAssignments(database, {
        dryRun: false,
      })

      expect(report).toMatchObject({ dryRun: false, errors: [] })
      const legacy = collections.rental_flow_assignments.docs.find(d =>
        d._id.equals(ids.durId)
      )
      expect(legacy).toMatchObject({
        assignmentId: 'asgn-dur',
        scope: 'DURATION',
        scopeValue: '12',
      })
      expect(legacy).not.toHaveProperty('kind')
      expect(legacy).not.toHaveProperty('key')
      const target = collections.rental_flow_configs
      expect(target.docs.filter(d => d.kind === 'assignment')).toHaveLength(0)
      expect(target.docs.find(d => d.kind === 'profile')).toBeDefined()
      expect(target.indexes.size).toBe(0)
    })

    it('copies back changes and rows written after the code switch', async () => {
      const { database, collections } = buildDatabase()
      const ids = seed(collections)
      await migrateRentalFlowAssignments(database, { dryRun: false })
      const target = collections.rental_flow_configs
      const moved = target.docs.find(d => d._id.equals(ids.durId))
      if (moved) moved.supersededAt = t(9)
      const newId = new ObjectId()
      target.docs.push({
        _id: newId,
        kind: 'assignment',
        key: 'asgn-new',
        scope: 'GLOBAL',
        scopeValue: null,
        supersededAt: null,
      })

      await rollbackRentalFlowAssignments(database, { dryRun: false })

      const legacy = collections.rental_flow_assignments.docs
      expect(legacy.find(d => d._id.equals(ids.durId))).toMatchObject({
        assignmentId: 'asgn-dur',
        supersededAt: t(9),
      })
      expect(legacy.find(d => d._id.equals(newId))).toMatchObject({
        assignmentId: 'asgn-new',
        scope: 'GLOBAL',
      })
    })

    it('keeps the rows and the indexes when restoring fails the count check', async () => {
      const { database, collections } = buildDatabase()
      seed(collections)
      await migrateRentalFlowAssignments(database, { dryRun: false })
      collections.rental_flow_assignments.countDocuments =
        (): Promise<number> => Promise.resolve(0)

      const report = await rollbackRentalFlowAssignments(database, {
        dryRun: false,
      })

      expect(report.errors).toHaveLength(1)
      expect(
        collections.rental_flow_configs.docs.filter(
          d => d.kind === 'assignment'
        )
      ).toHaveLength(2)
      expect(collections.rental_flow_configs.indexes.size).toBe(
        RENTAL_FLOW_ASSIGNMENT_INDEXES.length
      )
    })
  })
})
