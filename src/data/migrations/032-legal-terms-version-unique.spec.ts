import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  ensureLegalTermsVersionUnique,
  LEGAL_TERMS_VERSION_UNIQUE_INDEX,
  rollbackLegalTermsVersionUnique,
  type DuplicateTermsVersion,
  type LegalTermsIndexDatabase,
} from './032-legal-terms-version-unique'

function fakeDb(duplicates: DuplicateTermsVersion[] = []): {
  db: LegalTermsIndexDatabase
  collection: {
    aggregate: Mock<(pipeline: object[]) => unknown>
    createIndex: Mock
    dropIndex: Mock
  }
} {
  const collection = {
    aggregate: vi.fn<(pipeline: object[]) => unknown>(() => ({
      toArray: (): Promise<DuplicateTermsVersion[]> =>
        Promise.resolve(duplicates),
    })),
    createIndex: vi
      .fn()
      .mockResolvedValue(LEGAL_TERMS_VERSION_UNIQUE_INDEX.name),
    dropIndex: vi.fn().mockResolvedValue(undefined),
  }
  const db = {
    collection: vi.fn(() => collection),
  } as unknown as LegalTermsIndexDatabase
  return { db, collection }
}

const DUPLICATE: DuplicateTermsVersion = {
  _id: { key: 'rental-service-terms', version: 1 },
  ids: ['a1', 'b2'],
  count: 2,
}

describe('032-legal-terms-version-unique', () => {
  it('creates the partial unique index when no duplicates exist', async () => {
    const { db, collection } = fakeDb()

    const report = await ensureLegalTermsVersionUnique(db, { dryRun: false })

    expect(collection.createIndex).toHaveBeenCalledWith(
      { key: 1, version: 1 },
      {
        name: 'legal_documents_terms_key_version_published_unique',
        unique: true,
        partialFilterExpression: { kind: 'terms', status: 'published' },
      }
    )
    expect(report).toMatchObject({ updated: 1, skipped: 0, errors: [] })
  })

  it('reports duplicates and skips the index without touching documents', async () => {
    const { db, collection } = fakeDb([DUPLICATE])

    const report = await ensureLegalTermsVersionUnique(db, { dryRun: false })

    expect(collection.createIndex).not.toHaveBeenCalled()
    expect(report.errors).toEqual([
      'Trùng điều khoản rental-service-terms v1: a1, b2',
    ])
    expect(report).toMatchObject({ updated: 0, skipped: 1 })
  })

  it('defaults to dry-run and never creates the index', async () => {
    const { db, collection } = fakeDb()

    const report = await ensureLegalTermsVersionUnique(db)

    expect(collection.createIndex).not.toHaveBeenCalled()
    expect(report).toMatchObject({ dryRun: true, updated: 0, errors: [] })
  })

  it('only scans published terms', async () => {
    const { db, collection } = fakeDb()

    await ensureLegalTermsVersionUnique(db)

    const pipeline = collection.aggregate.mock.calls[0]?.[0]
    expect(pipeline?.[0]).toEqual({
      $match: { kind: 'terms', status: 'published' },
    })
  })

  it('rollback drops the index on apply and is a no-op on dry-run', async () => {
    const applied = fakeDb()
    const dry = fakeDb()

    const report = await rollbackLegalTermsVersionUnique(applied.db, {
      dryRun: false,
    })
    await rollbackLegalTermsVersionUnique(dry.db)

    expect(applied.collection.dropIndex).toHaveBeenCalledWith(
      LEGAL_TERMS_VERSION_UNIQUE_INDEX.name
    )
    expect(report.updated).toBe(1)
    expect(dry.collection.dropIndex).not.toHaveBeenCalled()
  })

  it('rollback treats a missing index as skipped', async () => {
    const { db, collection } = fakeDb()
    collection.dropIndex.mockRejectedValueOnce({ code: 27 })

    const report = await rollbackLegalTermsVersionUnique(db, { dryRun: false })

    expect(report).toMatchObject({ updated: 0, skipped: 1, errors: [] })
  })
})
