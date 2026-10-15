import { ObjectId } from 'mongodb'
import {
  parseCliArgs,
  runMigrationCli,
  type CliCollection,
  type CliDb,
} from './migration.cli'

type Doc = Record<string, unknown>

function memoryDb(seed: Record<string, Doc[]> = {}): {
  db: CliDb
  data: Record<string, Doc[]>
} {
  const data: Record<string, Doc[]> = seed
  const match = (doc: Doc, filter: Doc = {}): boolean =>
    Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && '$in' in (v as Doc)) {
        return ((v as { $in: unknown[] }).$in ?? []).some(
          x => String(x) === String(doc[k])
        )
      }
      if (v && typeof v === 'object' && '$exists' in (v as Doc)) return false
      return String(doc[k]) === String(v)
    })
  const db: CliDb = {
    collection: (name: string): CliCollection => {
      const docs = (data[name] ??= [])
      return {
        find: (filter?: Doc) => ({
          toArray: () => Promise.resolve(docs.filter(d => match(d, filter))),
        }),
        findOne: (filter: Doc) =>
          Promise.resolve(docs.find(d => match(d, filter)) ?? null),
        countDocuments: (filter?: Doc) =>
          Promise.resolve(docs.filter(d => match(d, filter)).length),
        distinct: () => Promise.resolve([]),
        insertOne: (doc: Doc): Promise<unknown> => {
          docs.push(doc)
          return Promise.resolve({})
        },
        updateOne: (
          filter: Doc,
          update: Doc,
          options?: { upsert?: boolean }
        ): Promise<unknown> => {
          const found = docs.find(d => match(d, filter))
          if (found) {
            Object.assign(found, (update.$set as Doc) ?? {})
            return Promise.resolve({ matchedCount: 1, upsertedCount: 0 })
          }
          if (options?.upsert) {
            docs.push({
              ...filter,
              ...((update.$setOnInsert as Doc) ?? {}),
              ...((update.$set as Doc) ?? {}),
            })
            return Promise.resolve({ matchedCount: 0, upsertedCount: 1 })
          }
          return Promise.resolve({ matchedCount: 0 })
        },
        replaceOne: () => Promise.resolve({ matchedCount: 0 }),
        deleteMany: () => Promise.resolve({ deletedCount: 0 }),
        deleteOne: (filter: Doc): Promise<unknown> => {
          const i = docs.findIndex(d => match(d, filter))
          if (i >= 0) docs.splice(i, 1)
          return Promise.resolve({ deletedCount: i >= 0 ? 1 : 0 })
        },
        createIndex: () => Promise.resolve('ok'),
        dropIndex: () => Promise.resolve(),
      }
    },
  }
  return { db, data }
}

describe('migration CLI', () => {
  it('parses flags; defaults to dry-run over 007-011', () => {
    expect(parseCliArgs([])).toEqual({
      apply: false,
      rollback: false,
      only: expect.arrayContaining([
        '007',
        '008',
        '009',
        '010',
        '011',
      ]) as string[],
    })
    expect(parseCliArgs(['--apply', '--only=009'])).toEqual({
      apply: true,
      rollback: false,
      only: ['009'],
    })
    expect(() => parseCliArgs(['--only=999'])).toThrow('Unknown migration')
    expect(() => parseCliArgs(['--bogus'])).toThrow('Unknown argument')
  })

  it('dry-run by default: writes nothing and records no checkpoint', async () => {
    const postId = new ObjectId()
    const { db, data } = memoryDb({
      community_posts: [{ _id: postId, authorId: 'u1' }],
    })
    const reports = await runMigrationCli(db, ['--only=009'])
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ dryRun: true, updated: 1 })
    expect(data.community_entries ?? []).toHaveLength(0)
    expect(data.migration_checkpoints ?? []).toHaveLength(0)
  })

  it('--apply copies and checkpoints; a second apply skips the step', async () => {
    const postId = new ObjectId()
    const { db, data } = memoryDb({
      community_posts: [{ _id: postId, authorId: 'u1' }],
    })
    const first = await runMigrationCli(db, ['--apply', '--only=009'])
    expect(first[0]).toMatchObject({ dryRun: false, updated: 1 })
    expect(data.community_entries).toHaveLength(1)
    expect(data.migration_checkpoints).toHaveLength(1)

    const second = await runMigrationCli(db, ['--apply', '--only=009'])
    expect(second).toEqual([])
  })

  it('runs the 011 contract documents merge through the CLI (dry-run, apply, rollback)', async () => {
    const artifactId = new ObjectId()
    const { db, data } = memoryDb({
      contract_artifacts: [{ _id: artifactId, contractId: 'c1', revision: 1 }],
    })
    const dry = await runMigrationCli(db, ['--only=011'])
    expect(dry[0]).toMatchObject({ dryRun: true, updated: 1 })
    expect(data.contract_documents ?? []).toHaveLength(0)

    const applied = await runMigrationCli(db, ['--apply', '--only=011'])
    expect(applied[0]).toMatchObject({ dryRun: false, updated: 1, errors: [] })
    expect(data.contract_documents).toEqual([
      expect.objectContaining({ _id: artifactId, kind: 'canonical' }),
    ])
    expect(data.migration_checkpoints).toHaveLength(1)

    const rollback = await runMigrationCli(db, ['--rollback', '--only=011'])
    expect(rollback[0]).toMatchObject({ dryRun: true, scanned: 1 })
  })

  it('runs the 014 rental flow configs merge through the CLI (dry-run, apply, rollback)', async () => {
    const profileId = new ObjectId()
    const { db, data } = memoryDb({
      rental_flow_profiles: [
        {
          _id: profileId,
          profileId: 'safe-default-profile',
          status: 'published',
        },
      ],
    })
    const dry = await runMigrationCli(db, ['--only=014'])
    expect(dry[0]).toMatchObject({ dryRun: true, updated: 1 })
    expect(data.rental_flow_configs ?? []).toHaveLength(0)

    const applied = await runMigrationCli(db, ['--apply', '--only=014'])
    expect(applied[0]).toMatchObject({ dryRun: false, updated: 1, errors: [] })
    expect(data.rental_flow_configs).toEqual([
      expect.objectContaining({
        _id: profileId,
        kind: 'profile',
        key: 'safe-default-profile',
      }),
    ])
    expect(data.migration_checkpoints).toHaveLength(1)

    const rollback = await runMigrationCli(db, ['--rollback', '--only=014'])
    expect(rollback[0]).toMatchObject({ dryRun: true, scanned: 1 })
  })

  it('runs the 012 maintenance tickets embed through the CLI (dry-run, orphans block apply)', async () => {
    const aptId = new ObjectId()
    const { db, data } = memoryDb({
      apartments: [{ _id: aptId }],
      maintenance_tickets: [
        { _id: new ObjectId(), propertyId: 'missing', description: 'x' },
      ],
    })
    const dry = await runMigrationCli(db, ['--only=012'])
    expect(dry[0]).toMatchObject({ dryRun: true, sourceTickets: 1 })

    const applied = await runMigrationCli(db, ['--apply', '--only=012'])
    expect(applied[0]?.errors).toHaveLength(1)
    expect(data.migration_checkpoints ?? []).toHaveLength(0)
  })

  it('runs the 013 system configs merge through the CLI (dry-run, apply, rollback)', async () => {
    const jobId = new ObjectId()
    const { db, data } = memoryDb({
      job_configs: [{ _id: jobId, jobName: 'job-a', enabled: false }],
    })
    const dry = await runMigrationCli(db, ['--only=013'])
    expect(dry[0]).toMatchObject({ dryRun: true, updated: 1 })
    expect(data.system_configs ?? []).toHaveLength(0)

    const applied = await runMigrationCli(db, ['--apply', '--only=013'])
    expect(applied[0]).toMatchObject({ dryRun: false, updated: 1, errors: [] })
    expect(data.system_configs).toEqual([
      expect.objectContaining({ _id: jobId, scope: 'job', key: 'job-a' }),
    ])
    expect(data.migration_checkpoints).toHaveLength(1)

    const rollback = await runMigrationCli(db, ['--rollback', '--only=013'])
    expect(rollback[0]).toMatchObject({ dryRun: true, restored: 1 })
  })

  it('rolls back in canonical reverse order regardless of --only order', async () => {
    const { db } = memoryDb()
    const reports = await runMigrationCli(db, [
      '--rollback',
      '--only=011,013,009',
    ])
    expect(reports.map(r => r.migrationId.slice(0, 3))).toEqual([
      '013',
      '011',
      '009',
    ])
  })

  it('a real rollback clears the checkpoint so the next --apply runs again', async () => {
    const postId = new ObjectId()
    const { db, data } = memoryDb({
      community_posts: [{ _id: postId, authorId: 'u1' }],
    })
    await runMigrationCli(db, ['--apply', '--only=009'])
    expect(data.migration_checkpoints).toHaveLength(1)

    // dry-run rollback không đụng checkpoint
    await runMigrationCli(db, ['--rollback', '--only=009'])
    expect(data.migration_checkpoints).toHaveLength(1)

    const rolled = await runMigrationCli(db, [
      '--rollback',
      '--apply',
      '--only=009',
    ])
    expect(rolled[0]?.errors).toEqual([])
    expect(data.migration_checkpoints ?? []).toHaveLength(0)

    const again = await runMigrationCli(db, ['--apply', '--only=009'])
    expect(again).toHaveLength(1)
  })
})
