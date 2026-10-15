/* eslint-disable @typescript-eslint/explicit-function-return-type -- in-memory Mongo fakes */
import { ObjectId } from 'mongodb'
import {
  COMMUNITY_ENTRY_INDEXES,
  migrateCommunityEntries,
  rollbackCommunityEntries,
  type CommunityMergeDb,
  type MergeCollection,
} from './009-community-entries-merge'

type Doc = Record<string, unknown>

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && '$in' in (cond as Doc)) {
      return ((cond as Doc).$in as unknown[]).some(
        x => String(x) === String(doc[key])
      )
    }
    return String(doc[key]) === String(cond)
  })
}

function fake(
  docs: Doc[]
): MergeCollection & { docs: Doc[]; indexes: Map<string, unknown> } {
  const indexes = new Map<string, unknown>()
  return {
    docs,
    find: (filter = {}) => ({
      toArray: () => Promise.resolve(docs.filter(d => matches(d, filter))),
    }),
    countDocuments: (filter = {}) =>
      Promise.resolve(docs.filter(d => matches(d, filter)).length),
    insertOne: doc => {
      docs.push({ ...doc })
      return Promise.resolve({})
    },
    updateOne: (filter, update, options) => {
      const found = docs.find(d => matches(d, filter))
      if (found) return Promise.resolve({ matchedCount: 1 })
      if (options?.upsert) {
        docs.push({ ...(update.$setOnInsert as Doc) })
        return Promise.resolve({ matchedCount: 0, upsertedCount: 1 })
      }
      return Promise.resolve({ matchedCount: 0 })
    },
    replaceOne: (filter, doc) => {
      const idx = docs.findIndex(d => matches(d, filter))
      if (idx < 0) return Promise.resolve({ matchedCount: 0 })
      docs[idx] = { ...doc }
      return Promise.resolve({ matchedCount: 1 })
    },
    createIndex: (keys, options) => {
      indexes.set(options?.name ?? JSON.stringify(keys), keys)
      return Promise.resolve('ok')
    },
    dropIndex: name => {
      if (!indexes.delete(name)) return Promise.reject(new Error('no index'))
      return Promise.resolve()
    },
    indexes,
    deleteMany: filter => {
      let deleted = 0
      for (let i = docs.length - 1; i >= 0; i -= 1) {
        if (matches(docs[i] as Doc, filter)) {
          docs.splice(i, 1)
          deleted += 1
        }
      }
      return Promise.resolve({ deletedCount: deleted })
    },
  }
}

function setup(posts: Doc[], comments: Doc[], entries: Doc[] = []) {
  const cols = {
    community_posts: fake(posts),
    community_comments: fake(comments),
    community_entries: fake(entries),
  }
  const db: CommunityMergeDb = {
    collection: name => cols[name as keyof typeof cols],
  }
  return { db, ...cols }
}

const post = (): Doc => ({
  _id: new ObjectId(),
  authorId: 'u1',
  title: 't',
  status: 'approved',
})
const comment = (postId: ObjectId): Doc => ({
  _id: new ObjectId(),
  postId: String(postId),
  parentId: null,
  authorId: 'u2',
})

describe('009 community entries merge migration (G-CMT)', () => {
  it('is a dry run by default and writes nothing', async () => {
    const p = post()
    const { db, community_entries } = setup([p], [comment(p._id as ObjectId)])

    const report = await migrateCommunityEntries(db)

    expect(report).toMatchObject({
      dryRun: true,
      scanned: 2,
      updated: 2,
      errors: [],
      sourceCounts: { post: 1, comment: 1 },
    })
    expect(community_entries.docs).toHaveLength(0)
  })

  it('copies with kind, keeps _id, leaves old collections, and is idempotent', async () => {
    const p = post()
    const c = comment(p._id as ObjectId)
    const { db, community_entries, community_posts, community_comments } =
      setup([p], [c])

    const first = await migrateCommunityEntries(db, { dryRun: false })
    const second = await migrateCommunityEntries(db, { dryRun: false })

    expect(first).toMatchObject({
      updated: 2,
      errors: [],
      targetCounts: { post: 1, comment: 1 },
    })
    expect(community_entries.docs).toEqual([
      { ...p, kind: 'post' },
      { ...c, kind: 'comment' },
    ])
    expect(second).toMatchObject({ updated: 0, skipped: 2, errors: [] })
    expect(community_entries.docs).toHaveLength(2)
    expect(community_posts.docs).toHaveLength(1)
    expect(community_comments.docs).toHaveLength(1)
  })

  it('reports an _id collision across kinds and does not overwrite', async () => {
    const p = post()
    const clash = { ...comment(p._id as ObjectId), _id: p._id }
    const { db, community_entries } = setup([p], [clash])

    const report = await migrateCommunityEntries(db, { dryRun: false })

    expect(report.errors.length).toBeGreaterThan(0)
    expect(community_entries.docs).toHaveLength(1)
    expect(community_entries.docs[0]).toMatchObject({ kind: 'post' })
  })

  it('rolls back: restores entries created after the cutover, then removes by kind; old collections stay', async () => {
    const p = post()
    const c = comment(p._id as ObjectId)
    const { db, community_entries, community_posts, community_comments } =
      setup([p], [c])
    await migrateCommunityEntries(db, { dryRun: false })
    const native: Doc = { ...post(), kind: 'post' }
    community_entries.docs.push(native)

    const dry = await rollbackCommunityEntries(db)
    expect(dry.dryRun).toBe(true)
    expect(community_entries.docs).toHaveLength(3)

    const report = await rollbackCommunityEntries(db, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(community_entries.docs).toHaveLength(0)
    expect(community_posts.docs).toHaveLength(2)
    expect(community_posts.docs[1]).not.toHaveProperty('kind')
    expect(community_posts.docs[1]?._id).toBe(native._id)
    expect(community_comments.docs).toHaveLength(1)
  })

  it('creates the three kind indexes on apply only, idempotently', async () => {
    const p = post()
    const { db, community_entries } = setup([p], [])
    await migrateCommunityEntries(db)
    expect(community_entries.indexes.size).toBe(0)
    await migrateCommunityEntries(db, { dryRun: false })
    await migrateCommunityEntries(db, { dryRun: false })
    expect([...community_entries.indexes.values()]).toEqual(
      COMMUNITY_ENTRY_INDEXES.map(i => i.keys)
    )
    expect(community_entries.indexes.size).toBe(3)
  })

  it('rollback replaces legacy docs by the entry version (no kind), reports deleted entries without resurrecting, and drops indexes', async () => {
    const p = post()
    const c = comment(p._id as ObjectId)
    const deletedPost = post()
    const { db, community_entries, community_posts, community_comments } =
      setup([p, deletedPost], [c])
    await migrateCommunityEntries(db, { dryRun: false })
    // after the code switch: p approved -> rejected with upvotes; c edited;
    // deletedPost removed through the API
    const entryP = community_entries.docs.find(d => d._id === p._id) as Doc
    entryP.status = 'rejected'
    entryP.upvotes = 5
    const entryC = community_entries.docs.find(d => d._id === c._id) as Doc
    entryC.commentsCount = 3
    community_entries.docs.splice(
      community_entries.docs.findIndex(d => d._id === deletedPost._id),
      1
    )

    const dry = await rollbackCommunityEntries(db)
    expect(dry).toMatchObject({
      dryRun: true,
      updated: 2,
      deletedAtTarget: [String(deletedPost._id)],
    })
    expect(community_posts.docs[0]).toEqual(p)

    const report = await rollbackCommunityEntries(db, { dryRun: false })

    expect(report.errors).toEqual([])
    expect(report.deletedAtTarget).toEqual([String(deletedPost._id)])
    expect(community_posts.docs).toHaveLength(2)
    expect(community_posts.docs.find(d => d._id === p._id)).toMatchObject({
      status: 'rejected',
      upvotes: 5,
    })
    expect(community_posts.docs.find(d => d._id === p._id)).not.toHaveProperty(
      'kind'
    )
    // reported, not touched: the legacy copy is left exactly as it was
    expect(community_posts.docs.find(d => d._id === deletedPost._id)).toEqual(
      deletedPost
    )
    expect(community_comments.docs[0]).toMatchObject({ commentsCount: 3 })
    expect(community_entries.docs).toHaveLength(0)
    expect(community_entries.indexes.size).toBe(0)
  })
})
