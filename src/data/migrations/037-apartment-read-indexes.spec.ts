import { describe, expect, it, vi } from 'vitest'
import {
  APARTMENT_READ_INDEXES,
  ensureApartmentReadIndexes,
  rollbackApartmentReadIndexes,
  type ApartmentIndexDatabase,
} from './037-apartment-read-indexes'

function fakeDb(existing: string[] = []): {
  db: ApartmentIndexDatabase
  calls: Array<{ op: string; arg: unknown }>
} {
  const calls: Array<{ op: string; arg: unknown }> = []
  const db = {
    collection: (): object => ({
      createIndex: vi.fn((_keys: unknown, options: { name: string }) => {
        calls.push({ op: 'create', arg: options.name })
        return Promise.resolve(options.name)
      }),
      dropIndex: vi.fn((name: string) => {
        calls.push({ op: 'drop', arg: name })
        return existing.includes(name)
          ? Promise.resolve(undefined)
          : Promise.reject(Object.assign(new Error('missing'), { code: 27 }))
      }),
    }),
  } as unknown as ApartmentIndexDatabase
  return { db, calls }
}

describe('037-apartment-read-indexes', () => {
  it('dry-run reports the indexes without writing', async () => {
    const { db, calls } = fakeDb()

    const report = await ensureApartmentReadIndexes(db)

    expect(report).toMatchObject({
      dryRun: true,
      scanned: APARTMENT_READ_INDEXES.length,
      updated: 0,
      errors: [],
    })
    expect(calls).toEqual([])
  })

  it('apply creates every index under its declared name', async () => {
    const { db, calls } = fakeDb()

    const report = await ensureApartmentReadIndexes(db, { dryRun: false })

    expect(report.updated).toBe(APARTMENT_READ_INDEXES.length)
    expect(calls.map(call => call.arg)).toEqual(
      APARTMENT_READ_INDEXES.map(index => index.options.name)
    )
  })

  it('can be applied twice without error', async () => {
    const { db } = fakeDb()

    await ensureApartmentReadIndexes(db, { dryRun: false })
    const second = await ensureApartmentReadIndexes(db, { dryRun: false })

    expect(second.errors).toEqual([])
  })

  it('rollback drops only its own indexes and tolerates missing ones', async () => {
    const own = APARTMENT_READ_INDEXES.map(index => index.options.name)
    const { db, calls } = fakeDb([own[0] as string])

    const report = await rollbackApartmentReadIndexes(db, { dryRun: false })

    expect(calls.map(call => call.arg)).toEqual(own)
    expect(report).toMatchObject({ updated: 1, errors: [] })
  })

  it('rollback dry-run drops nothing', async () => {
    const { db, calls } = fakeDb()

    await rollbackApartmentReadIndexes(db)

    expect(calls).toEqual([])
  })

  it('uses unique index names that start with the collection name', () => {
    const names = APARTMENT_READ_INDEXES.map(index => index.options.name)

    expect(new Set(names).size).toBe(names.length)
    expect(names.every(name => name.startsWith('apartments_'))).toBe(true)
  })
})
