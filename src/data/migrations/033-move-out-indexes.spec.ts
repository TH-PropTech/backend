import { describe, expect, it, vi } from 'vitest'
import {
  ensureMoveOutIndexes,
  MOVE_OUT_INDEXES,
  rollbackMoveOutIndexes,
  type DuplicateContract,
  type MoveOutIndexDatabase,
} from './033-move-out-indexes'

function fakeDb(duplicates: Record<string, DuplicateContract[]> = {}): {
  db: MoveOutIndexDatabase
  calls: Array<{ collection: string; op: string; arg: unknown }>
} {
  const calls: Array<{ collection: string; op: string; arg: unknown }> = []
  const db = {
    collection: (name: string): object => ({
      aggregate: (): { toArray: () => Promise<DuplicateContract[]> } => ({
        toArray: (): Promise<DuplicateContract[]> =>
          Promise.resolve(duplicates[name] ?? []),
      }),
      createIndex: vi.fn((_keys: unknown, options: unknown) => {
        calls.push({ collection: name, op: 'create', arg: options })
        return Promise.resolve('ok')
      }),
      dropIndex: vi.fn((indexName: string) => {
        calls.push({ collection: name, op: 'drop', arg: indexName })
        return indexName.includes('status')
          ? Promise.reject(Object.assign(new Error('missing'), { code: 27 }))
          : Promise.resolve(undefined)
      }),
    }),
  } as unknown as MoveOutIndexDatabase
  return { db, calls }
}

describe('033-move-out-indexes', () => {
  it('dry-run reports without creating anything', async () => {
    const { db, calls } = fakeDb()
    const report = await ensureMoveOutIndexes(db)
    expect(report).toMatchObject({ dryRun: true, updated: 0, errors: [] })
    expect(calls).toEqual([])
  })

  it('apply creates every index with its name', async () => {
    const { db, calls } = fakeDb()
    const report = await ensureMoveOutIndexes(db, { dryRun: false })
    expect(report.updated).toBe(MOVE_OUT_INDEXES.length)
    expect(calls.map(call => call.arg)).toEqual(
      MOVE_OUT_INDEXES.map(index => index.options)
    )
  })

  it('creates nothing and reports when a contract has duplicate records', async () => {
    const { db, calls } = fakeDb({
      move_out_handovers: [{ _id: 'c1', count: 2 }],
    })
    const report = await ensureMoveOutIndexes(db, { dryRun: false })
    expect(report.errors).toEqual([
      'Trùng contractId c1 trong move_out_handovers (2 bản ghi)',
    ])
    expect(report).toMatchObject({ updated: 0, skipped: 3 })
    expect(calls).toEqual([])
  })

  it('rollback drops indexes and tolerates a missing one', async () => {
    const { db, calls } = fakeDb()
    const report = await rollbackMoveOutIndexes(db, { dryRun: false })
    expect(calls).toHaveLength(3)
    expect(report).toMatchObject({ updated: 2, skipped: 1, errors: [] })
  })

  it('rollback dry-run drops nothing', async () => {
    const { db, calls } = fakeDb()
    expect(await rollbackMoveOutIndexes(db)).toMatchObject({ updated: 0 })
    expect(calls).toEqual([])
  })
})
