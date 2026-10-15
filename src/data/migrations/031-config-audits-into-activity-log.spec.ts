/* eslint-disable @typescript-eslint/explicit-function-return-type -- in-memory Mongo fakes */
import { ObjectId } from 'mongodb'
import {
  CONFIG_AUDIT_INDEXES,
  CONFIG_AUDIT_KIND,
  CONFIG_AUDITS_INTO_ACTIVITY_LOG_MIGRATION_ID,
  migrateConfigAuditsIntoActivityLog,
  rollbackConfigAuditsFromActivityLog,
  type ConfigAuditIntoActivityLogCollection,
  type ConfigAuditIntoActivityLogDatabase,
} from './031-config-audits-into-activity-log'

type Doc = Record<string, unknown> & { _id: unknown }

function get(doc: Doc, path: string): unknown[] {
  return [(doc as Record<string, unknown>)[path]]
}

function same(a: unknown, b: unknown): boolean {
  return String(a) === String(b)
}

function matchCond(values: unknown[], cond: unknown): boolean {
  if (
    cond &&
    typeof cond === 'object' &&
    !(cond instanceof ObjectId) &&
    !Array.isArray(cond)
  ) {
    return Object.entries(cond as Record<string, unknown>).every(
      ([op, arg]) => {
        const list = arg as unknown[]
        switch (op) {
          case '$in':
            return values.some(v => list.some(x => same(x, v)))
          case '$gt':
            return values.some(v => String(v) > String(arg))
          default:
            throw new Error(`unsupported operator ${op}`)
        }
      }
    )
  }
  return values.some(v => same(v, cond))
}

function matches(doc: Doc, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) =>
    matchCond(get(doc, key), cond)
  )
}

interface FakeCollection extends ConfigAuditIntoActivityLogCollection {
  docs: Doc[]
  writes: number
  indexes: Map<string, Record<string, number>>
}

function fakeCollection(
  docs: Doc[],
  opts: { dropInsert?: boolean; dropReplace?: boolean } = {}
): FakeCollection {
  const col: FakeCollection = {
    docs,
    writes: 0,
    indexes: new Map(),
    find: (filter: Record<string, unknown> = {}) => {
      let rows = docs.filter(d => matches(d, filter))
      let limit: number | undefined
      const chain = {
        sort: () => {
          rows = [...rows].sort((a, b) =>
            String(a._id) < String(b._id) ? -1 : 1
          )
          return chain
        },
        limit: (n: number) => {
          limit = n
          return chain
        },
        toArray: () =>
          Promise.resolve(limit === undefined ? rows : rows.slice(0, limit)),
      }
      return chain
    },
    countDocuments: (filter: Record<string, unknown> = {}) =>
      Promise.resolve(docs.filter(d => matches(d, filter)).length),
    updateOne: (
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options?: { upsert?: boolean }
    ) => {
      const target = docs.find(d => matches(d, filter))
      if (target) {
        col.writes += 1
        if (update.$set) Object.assign(target, update.$set)
        if (update.$unset) {
          for (const k of Object.keys(update.$unset)) delete target[k]
        }
        return Promise.resolve({ matchedCount: 1 })
      }
      if (options?.upsert && update.$setOnInsert && !opts.dropInsert) {
        col.writes += 1
        docs.push({
          ...(update.$setOnInsert as Doc),
          _id: filter._id,
        })
      }
      return Promise.resolve({ matchedCount: 0 })
    },
    replaceOne: (
      filter: Record<string, unknown>,
      doc: Record<string, unknown>,
      options?: { upsert?: boolean }
    ) => {
      const target = docs.find(d => matches(d, filter))
      if (target && !opts.dropReplace) {
        col.writes += 1
        for (const k of Object.keys(target)) delete target[k]
        Object.assign(target, doc)
        return Promise.resolve({ matchedCount: 1 })
      }
      if (!target && options?.upsert && !opts.dropReplace) {
        col.writes += 1
        docs.push({ ...doc } as Doc)
      }
      return Promise.resolve({ matchedCount: target ? 1 : 0 })
    },
    deleteMany: (filter: Record<string, unknown>) => {
      const before = docs.length
      const kept = docs.filter(d => !matches(d, filter))
      docs.splice(0, docs.length, ...kept)
      col.writes += before - docs.length
      return Promise.resolve({ deletedCount: before - docs.length })
    },
    createIndex: (
      keys: Record<string, number>,
      options?: { name?: string }
    ) => {
      const name = options?.name ?? Object.keys(keys).join('_')
      col.indexes.set(name, keys)
      return Promise.resolve(name)
    },
    dropIndex: (name: string) => {
      if (!col.indexes.has(name))
        return Promise.reject(new Error('ns not found'))
      col.indexes.delete(name)
      return Promise.resolve({})
    },
  }
  return col
}

function setup(
  data: { legacy?: Doc[]; target?: Doc[] },
  opts: { dropInsert?: boolean; dropReplace?: boolean } = {}
) {
  const legacy = fakeCollection(data.legacy ?? [], opts)
  const target = fakeCollection(data.target ?? [], opts)
  const cols: Record<string, FakeCollection> = {
    config_audits: legacy,
    activity_logs: target,
  }
  const db: ConfigAuditIntoActivityLogDatabase = {
    collection: name => {
      const col = cols[name]
      if (!col) throw new Error(`unexpected collection ${name}`)
      return col
    },
  }
  return { db, legacy, target }
}

const day = (n: number): Date => new Date(Date.UTC(2026, 0, n))

function audit(extra: Partial<Doc> = {}): Doc {
  return {
    _id: new ObjectId(),
    scope: 'contract-template',
    key: 'tpl-1',
    version: 1,
    action: 'draft-created',
    actorId: 'admin-1',
    reason: null,
    beforeHash: null,
    afterHash: 'h1',
    details: { note: 'x' },
    createdAt: day(1),
    ...extra,
  }
}

describe('031-config-audits-into-activity-log', () => {
  it('uses the expected id, kind and index definitions', () => {
    expect(CONFIG_AUDITS_INTO_ACTIVITY_LOG_MIGRATION_ID).toBe(
      '031-config-audits-into-activity-log'
    )
    expect(CONFIG_AUDIT_KIND).toBe('config-audit')
    expect(CONFIG_AUDIT_INDEXES.map(i => i.name)).toEqual([
      'activity_logs_kind_scope_key_version_created',
      'activity_logs_kind_scope_created',
    ])
  })

  it('dry-run is the default: it reads and counts, writes nothing, creates no index', async () => {
    const a = audit()
    const { db, legacy, target } = setup({ legacy: [a] })

    const report = await migrateConfigAuditsIntoActivityLog(db)

    expect(report).toMatchObject({
      dryRun: true,
      scanned: 1,
      updated: 1,
      source: 1,
      target: 0,
      errors: [],
    })
    expect(legacy.writes + target.writes).toBe(0)
    expect(target.indexes.size).toBe(0)
  })

  it('copies every row with kind config-audit, keeps _id and fields, keeps the source', async () => {
    const a = audit({ version: undefined, reason: 'r' })
    const b = audit({
      scope: 'rental-flow',
      key: 'flow-1',
      targetType: 'profile',
    })
    const { db, legacy, target } = setup({ legacy: [a, b] })

    const report = await migrateConfigAuditsIntoActivityLog(db, {
      dryRun: false,
    })

    expect(report).toMatchObject({
      dryRun: false,
      source: 2,
      target: 2,
      errors: [],
    })
    const copied = target.docs.find(d => same(d._id, a._id))
    expect(copied).toEqual({ ...a, kind: 'config-audit' })
    expect(target.docs.find(d => same(d._id, b._id))).toMatchObject({
      kind: 'config-audit',
      targetType: 'profile',
    })
    expect(legacy.docs).toHaveLength(2)
    expect([...target.indexes.keys()].sort()).toEqual(
      CONFIG_AUDIT_INDEXES.map(i => i.name).sort()
    )
    expect(
      target.indexes.get('activity_logs_kind_scope_key_version_created')
    ).toEqual({ kind: 1, scope: 1, key: 1, version: 1, createdAt: 1 })
  })

  it('is idempotent by _id: a second apply copies nothing and does not duplicate', async () => {
    const a = audit()
    const { db, target } = setup({ legacy: [a] })
    await migrateConfigAuditsIntoActivityLog(db, { dryRun: false })
    const docsAfterFirst = target.docs.length

    const second = await migrateConfigAuditsIntoActivityLog(db, {
      dryRun: false,
    })

    expect(second).toMatchObject({ updated: 0, skipped: 1, errors: [] })
    expect(target.docs.length).toBe(docsAfterFirst)
  })

  it('does not deduplicate: identical-looking audits with different _id are all copied', async () => {
    const a = audit()
    const b = audit()
    const c = audit()
    const { db, target } = setup({ legacy: [a, b, c] })

    const report = await migrateConfigAuditsIntoActivityLog(db, {
      dryRun: false,
    })

    expect(report.target).toBe(3)
    expect(target.docs.filter(d => d.kind === 'config-audit')).toHaveLength(3)
  })

  it('reports a _id that already exists under another kind and keeps it', async () => {
    const a = audit()
    const clash = {
      _id: a._id,
      kind: 'http',
      method: 'POST',
      createdAt: day(2),
    }
    const { db, target } = setup({ legacy: [a], target: [clash] })

    const report = await migrateConfigAuditsIntoActivityLog(db, {
      dryRun: false,
    })

    expect(report.errors).toHaveLength(1)
    expect(target.docs).toEqual([clash])
  })

  it('reports the clash in a dry-run without throwing', async () => {
    const a = audit()
    const clash = { _id: a._id, kind: 'http', createdAt: day(2) }
    const { db } = setup({ legacy: [a], target: [clash] })

    const report = await migrateConfigAuditsIntoActivityLog(db)

    expect(report.errors).toEqual([
      expect.stringContaining('bản ghi kind=http'),
    ])
  })

  it('reads the source in batches and copies every batch', async () => {
    const rows = [1, 2, 3, 4, 5].map(() => audit())
    const { db, target } = setup({ legacy: rows })

    const report = await migrateConfigAuditsIntoActivityLog(db, {
      dryRun: false,
      batchSize: 2,
    })

    expect(report.scanned).toBe(5)
    expect(report.target).toBe(5)
    expect(target.docs.filter(d => d.kind === 'config-audit')).toHaveLength(5)
  })

  it('keeps rows already written by the new code and other kinds untouched', async () => {
    const legacyRow = audit()
    const runtimeRow = {
      _id: new ObjectId(),
      kind: 'config-audit',
      scope: 'platform-fee',
      key: 'sched-1',
      version: 2,
      action: 'published',
      actorId: 'admin-2',
      createdAt: day(9),
    }
    const httpRow = { _id: new ObjectId(), kind: 'http', createdAt: day(8) }
    const { db, target } = setup({
      legacy: [legacyRow],
      target: [runtimeRow, httpRow],
    })

    const report = await migrateConfigAuditsIntoActivityLog(db, {
      dryRun: false,
    })

    expect(report.errors).toEqual([])
    expect(report.target).toBe(2)
    expect(target.docs).toHaveLength(3)
    expect(target.docs).toContain(runtimeRow)
    expect(target.docs).toContain(httpRow)
  })

  it('fails the batch when the copied _ids are not all found after the write', async () => {
    const a = audit()
    const { db } = setup({ legacy: [a] }, { dropInsert: true })

    await expect(
      migrateConfigAuditsIntoActivityLog(db, { dryRun: false })
    ).rejects.toThrow('count mismatch')
  })

  describe('rollback', () => {
    it('dry-run writes nothing and drops nothing', async () => {
      const a = audit()
      const { db, legacy, target } = setup({
        legacy: [],
        target: [{ ...a, kind: 'config-audit' }],
      })
      target.indexes.set('activity_logs_kind_scope_created', { kind: 1 })

      const report = await rollbackConfigAuditsFromActivityLog(db)

      expect(report.dryRun).toBe(true)
      expect(legacy.writes + target.writes).toBe(0)
      expect(target.indexes.size).toBe(1)
    })

    it('copies config-audit rows back with legacy fields only, keeps other kinds, drops kind indexes', async () => {
      const a = audit()
      const runtime = {
        _id: new ObjectId(),
        kind: 'config-audit',
        scope: 'rental-flow',
        key: 'flow-9',
        action: 'ASSIGNMENT_SUPERSEDED',
        actorId: 'admin-3',
        userId: 'not-a-legacy-field',
        createdAt: day(7),
      }
      const httpRow = {
        _id: new ObjectId(),
        kind: 'http',
        method: 'POST',
        createdAt: day(6),
      }
      const { db, legacy, target } = setup({
        legacy: [],
        target: [
          { ...a, kind: 'config-audit', reason: 'changed-later' },
          runtime,
          httpRow,
        ],
      })
      for (const name of CONFIG_AUDIT_INDEXES.map(i => i.name)) {
        target.indexes.set(name, {})
      }

      const report = await rollbackConfigAuditsFromActivityLog(db, {
        dryRun: false,
      })

      expect(report.errors).toEqual([])
      expect(report.restored).toBe(2)
      expect(report.target).toBe(0)
      const restoredA = legacy.docs.find(d => same(d._id, a._id))
      expect(restoredA?.reason).toBe('changed-later')
      expect(restoredA).not.toHaveProperty('kind')
      const restoredRuntime = legacy.docs.find(d => same(d._id, runtime._id))
      expect(restoredRuntime).not.toHaveProperty('userId')
      expect(restoredRuntime).toMatchObject({ key: 'flow-9' })
      expect(target.docs).toEqual([httpRow])
      expect(target.indexes.size).toBe(0)
    })

    it('halts and keeps the rows (and indexes) when the restore cannot be verified', async () => {
      const a = audit()
      const { db, target } = setup(
        { legacy: [], target: [{ ...a, kind: 'config-audit' }] },
        { dropReplace: true }
      )
      for (const name of CONFIG_AUDIT_INDEXES.map(i => i.name)) {
        target.indexes.set(name, {})
      }

      const report = await rollbackConfigAuditsFromActivityLog(db, {
        dryRun: false,
      })

      expect(report.errors).toEqual([
        expect.stringContaining('0/1 rows restored'),
      ])
      expect(target.docs).toHaveLength(1)
      expect(target.indexes.size).toBe(2)
    })
  })
})
