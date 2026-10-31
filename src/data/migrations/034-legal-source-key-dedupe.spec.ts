import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  dedupeLegalSourceKeys,
  LEGAL_SOURCE_KEY_UNIQUE_INDEX,
  rollbackLegalSourceKeyDedupe,
  type LegalSourceDedupeDatabase,
} from './034-legal-source-key-dedupe'

type Row = Record<string, unknown> & { _id: string }

/** Giả lập có trạng thái: deleteMany/createIndex thật sự đổi dữ liệu để kiểm idempotent. */
function fakeDb(
  initial: Row[],
  indexes: Array<{ name: string; unique?: boolean }> = []
): {
  db: LegalSourceDedupeDatabase
  collection: Record<string, Mock>
  rows: () => Row[]
} {
  let rows = [...initial]
  let idx = [...indexes]
  const collection = {
    find: vi.fn(() => ({
      toArray: (): Promise<Row[]> => Promise.resolve([...rows]),
    })),
    deleteMany: vi.fn(
      (filter: {
        _id: { $in: string[] }
      }): Promise<{ deletedCount: number }> => {
        rows = rows.filter(r => !filter._id.$in.includes(r._id))
        return Promise.resolve({ deletedCount: filter._id.$in.length })
      }
    ),
    indexes: vi.fn(() => Promise.resolve([...idx])),
    createIndex: vi.fn(
      (_k: unknown, o: { name: string; unique?: boolean }): Promise<string> => {
        idx = [...idx.filter(i => i.name !== o.name), o]
        return Promise.resolve(o.name)
      }
    ),
    dropIndex: vi.fn((name: string): Promise<undefined> => {
      idx = idx.filter(i => i.name !== name)
      return Promise.resolve(undefined)
    }),
  }
  const db = {
    collection: (): typeof collection => collection,
  } as unknown as LegalSourceDedupeDatabase
  return { db, collection, rows: () => rows }
}

const older = new Date('2026-01-01')
const newer = new Date('2026-02-01')

describe('034-legal-source-key-dedupe', () => {
  it('keeps the newest updatedAt per key, deletes the rest and logs them', async () => {
    const { db, collection, rows } = fakeDb([
      { _id: 'a', kind: 'source', key: 'k1', updatedAt: older },
      { _id: 'b', kind: 'source', key: 'k1', updatedAt: newer },
      { _id: 'c', kind: 'source', key: 'k2', updatedAt: older },
    ])

    const report = await dedupeLegalSourceKeys(db, { dryRun: false })

    expect(
      rows()
        .map(r => r._id)
        .sort()
    ).toEqual(['b', 'c'])
    expect(report.removed.map(r => r._id)).toEqual(['a'])
    expect(report).toMatchObject({ scanned: 3, updated: 2, errors: [] })
    expect(collection.createIndex).toHaveBeenCalledWith(
      { key: 1 },
      {
        name: LEGAL_SOURCE_KEY_UNIQUE_INDEX.name,
        ...LEGAL_SOURCE_KEY_UNIQUE_INDEX.options,
      }
    )
  })

  it('breaks updatedAt ties with the larger _id', async () => {
    const { db, rows } = fakeDb([
      { _id: 'a1', kind: 'source', key: 'k', updatedAt: newer },
      { _id: 'a2', kind: 'source', key: 'k', updatedAt: newer },
      { _id: 'a0', kind: 'source', key: 'k' },
    ])

    await dedupeLegalSourceKeys(db, { dryRun: false })

    expect(rows().map(r => r._id)).toEqual(['a2'])
  })

  it('deletes nothing but still creates the index when there are no duplicates', async () => {
    const { db, collection } = fakeDb([
      { _id: 'a', kind: 'source', key: 'k1' },
      { _id: 'b', kind: 'source', key: 'k2' },
    ])

    const report = await dedupeLegalSourceKeys(db, { dryRun: false })

    expect(collection.deleteMany).not.toHaveBeenCalled()
    expect(collection.createIndex).toHaveBeenCalledTimes(1)
    expect(report.removed).toEqual([])
  })

  it('is safe on an empty collection', async () => {
    const { db, collection } = fakeDb([])

    const report = await dedupeLegalSourceKeys(db, { dryRun: false })

    expect(collection.deleteMany).not.toHaveBeenCalled()
    expect(report).toMatchObject({ scanned: 0, errors: [] })
  })

  it('is idempotent when run twice', async () => {
    const { db, collection } = fakeDb([
      { _id: 'a', kind: 'source', key: 'k', updatedAt: older },
      { _id: 'b', kind: 'source', key: 'k', updatedAt: newer },
    ])

    await dedupeLegalSourceKeys(db, { dryRun: false })
    const second = await dedupeLegalSourceKeys(db, { dryRun: false })

    expect(second).toMatchObject({ updated: 0, removed: [], errors: [] })
    expect(collection.deleteMany).toHaveBeenCalledTimes(1)
    expect(collection.createIndex).toHaveBeenCalledTimes(1)
  })

  it('replaces the plain same-name index left by migration 020', async () => {
    const { db, collection } = fakeDb(
      [{ _id: 'a', kind: 'source', key: 'k' }],
      [{ name: 'legal_documents_source_key_unique' }]
    )

    await dedupeLegalSourceKeys(db, { dryRun: false })

    expect(collection.dropIndex).toHaveBeenCalledWith(
      'legal_documents_source_key_unique'
    )
    expect(collection.createIndex).toHaveBeenCalledTimes(1)
  })

  it('does not write anything on dry-run but reports what would be removed', async () => {
    const { db, collection } = fakeDb([
      { _id: 'a', kind: 'source', key: 'k', updatedAt: older },
      { _id: 'b', kind: 'source', key: 'k', updatedAt: newer },
    ])

    const report = await dedupeLegalSourceKeys(db)

    expect(report.dryRun).toBe(true)
    expect(report.removed.map(r => r._id)).toEqual(['a'])
    expect(collection.deleteMany).not.toHaveBeenCalled()
    expect(collection.createIndex).not.toHaveBeenCalled()
  })

  it('leaves keyless sources untouched and skips the index when more than one', async () => {
    const { db, collection, rows } = fakeDb([
      { _id: 'a', kind: 'source' },
      { _id: 'b', kind: 'source', key: null },
    ])

    const report = await dedupeLegalSourceKeys(db, { dryRun: false })

    expect(rows()).toHaveLength(2)
    expect(collection.createIndex).not.toHaveBeenCalled()
    expect(report.warnings).toHaveLength(1)
  })

  it('rollback drops the index on apply, no-ops on dry-run and when missing', async () => {
    const applied = fakeDb(
      [],
      [{ name: 'legal_documents_source_key_unique', unique: true }]
    )
    const dry = fakeDb(
      [],
      [{ name: 'legal_documents_source_key_unique', unique: true }]
    )
    const missing = fakeDb([])

    const report = await rollbackLegalSourceKeyDedupe(applied.db, {
      dryRun: false,
    })
    await rollbackLegalSourceKeyDedupe(dry.db)
    const none = await rollbackLegalSourceKeyDedupe(missing.db, {
      dryRun: false,
    })

    expect(report.updated).toBe(1)
    expect(applied.collection.dropIndex).toHaveBeenCalledTimes(1)
    expect(dry.collection.dropIndex).not.toHaveBeenCalled()
    expect(none).toMatchObject({ updated: 0, skipped: 1 })
  })
})
