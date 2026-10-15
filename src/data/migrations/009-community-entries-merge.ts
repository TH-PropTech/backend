import type { MigrationOptions, MigrationReport } from './migration.types'

/**
 * G-CMT: sao `community_posts` (kind='post') và `community_comments`
 * (kind='comment') sang collection mới `community_entries`, GIỮ `_id` cũ.
 *
 * - Mặc định chạy thử (dry-run); chỉ ghi khi truyền `{ dryRun: false }`.
 * - Idempotent: `updateOne(..., { $setOnInsert }, { upsert: true })` theo `_id`;
 *   bản ghi đã có trong đích bị bỏ qua. `_id` đã tồn tại ở đích với kind khác
 *   (va chạm) được báo lỗi và không ghi đè.
 * - Kiểm đếm theo kind sau khi áp dụng: mọi `_id` nguồn phải có trong đích đúng
 *   kind, lệch thì lỗi (dừng).
 * - Tạo 3 chỉ mục `(kind, ...)` khi áp dụng (production tắt synchronize).
 * - Không xóa collection cũ. Rollback: với `_id` có ở cả hai bên, `replaceOne`
 *   bản cũ bằng bản ở `community_entries` (bỏ `kind`); `_id` chỉ có ở đích được
 *   chèn; `_id` chỉ có ở collection cũ (đã xóa sau khi chuyển code) chỉ được báo
 *   cáo trong `deletedAtTarget`, không bị đụng tới. Sau đó xóa theo `kind` khỏi
 *   `community_entries` và bỏ 3 chỉ mục.
 */
export const COMMUNITY_ENTRIES_MERGE_MIGRATION_ID =
  '009-community-entries-merge'

export const COMMUNITY_ENTRIES_COLLECTION = 'community_entries'

/** Khớp 3 `@Index` của `CommunityEntry`. */
export const COMMUNITY_ENTRY_INDEXES: ReadonlyArray<{
  name: string
  keys: Record<string, 1 | -1>
}> = [
  {
    name: 'community_entries_kind_post_created',
    keys: { kind: 1, postId: 1, createdAt: 1 },
  },
  {
    name: 'community_entries_kind_status_created',
    keys: { kind: 1, status: 1, createdAt: 1 },
  },
  {
    name: 'community_entries_kind_author_created',
    keys: { kind: 1, authorId: 1, createdAt: 1 },
  },
]

type Doc = Record<string, unknown>

export interface MergeCollection {
  find(
    filter?: Doc,
    options?: { projection?: Doc }
  ): { toArray(): Promise<Doc[]> }
  countDocuments(filter?: Doc): Promise<number>
  insertOne(doc: Doc): Promise<unknown>
  updateOne(
    filter: Doc,
    update: Doc,
    options?: { upsert?: boolean }
  ): Promise<{ matchedCount: number; upsertedCount?: number }>
  replaceOne(filter: Doc, doc: Doc): Promise<{ matchedCount: number }>
  deleteMany(filter: Doc): Promise<{ deletedCount?: number }>
  createIndex(
    keys: Record<string, 1 | -1>,
    options?: { name?: string }
  ): Promise<unknown>
  dropIndex(name: string): Promise<unknown>
}

export interface CommunityMergeDb {
  collection(name: string): MergeCollection
}

export type CommunityMergeReport = MigrationReport & {
  sourceCounts: { post: number; comment: number }
  targetCounts: { post: number; comment: number }
  /** Rollback: _id còn ở collection cũ nhưng đã bị xóa ở đích (không hồi sinh). */
  deletedAtTarget: string[]
}

type Kind = 'post' | 'comment'

const SOURCES: Array<{ kind: Kind; collection: string }> = [
  { kind: 'post', collection: 'community_posts' },
  { kind: 'comment', collection: 'community_comments' },
]

function newReport(dryRun: boolean): CommunityMergeReport {
  return {
    migrationId: COMMUNITY_ENTRIES_MERGE_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    sourceCounts: { post: 0, comment: 0 },
    targetCounts: { post: 0, comment: 0 },
    deletedAtTarget: [],
  }
}

export async function migrateCommunityEntries(
  db: CommunityMergeDb,
  options: MigrationOptions = {}
): Promise<CommunityMergeReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = db.collection(COMMUNITY_ENTRIES_COLLECTION)

  // Tất cả _id đã có ở đích (kèm kind) để nhận biết trùng/va chạm.
  const present = new Map<string, unknown>()
  for (const row of await target
    .find({}, { projection: { _id: 1, kind: 1 } })
    .toArray()) {
    present.set(String(row._id), row.kind)
  }

  for (const { kind, collection } of SOURCES) {
    const source = await db.collection(collection).find({}).toArray()
    report.sourceCounts[kind] = source.length

    for (const doc of source) {
      report.scanned += 1
      const id = String(doc._id)
      if (present.has(id)) {
        if (present.get(id) === kind) {
          report.skipped += 1
        } else {
          report.skipped += 1
          report.errors.push(
            `${collection}/${id}: _id already used by kind=${String(present.get(id))} in ${COMMUNITY_ENTRIES_COLLECTION}; not copied`
          )
        }
        continue
      }
      report.updated += 1
      if (dryRun) continue
      await target.updateOne(
        { _id: doc._id },
        { $setOnInsert: { ...doc, kind } },
        { upsert: true }
      )
    }

    // Kiểm đếm: mọi _id nguồn phải nằm ở đích đúng kind.
    if (!dryRun) {
      const found = await target.countDocuments({
        kind,
        _id: { $in: source.map(d => d._id) },
      })
      report.targetCounts[kind] = found
      if (found !== source.length) {
        report.errors.push(
          `${collection}: ${found}/${source.length} documents present as kind=${kind} after apply; stopped`
        )
        return report
      }
    }
  }

  if (!dryRun) {
    for (const index of COMMUNITY_ENTRY_INDEXES) {
      await target.createIndex(index.keys, { name: index.name })
    }
  }

  if (dryRun) {
    report.targetCounts.post = await target.countDocuments({ kind: 'post' })
    report.targetCounts.comment = await target.countDocuments({
      kind: 'comment',
    })
  }
  return report
}

export async function rollbackCommunityEntries(
  db: CommunityMergeDb,
  options: MigrationOptions = {}
): Promise<CommunityMergeReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const target = db.collection(COMMUNITY_ENTRIES_COLLECTION)

  for (const { kind, collection } of SOURCES) {
    const legacy = db.collection(collection)
    const entries = await target.find({ kind }).toArray()
    const entryIds = new Set(entries.map(e => String(e._id)))
    const legacyIds = new Set(
      (await legacy.find({}, { projection: { _id: 1 } }).toArray()).map(d =>
        String(d._id)
      )
    )
    report.targetCounts[kind] = entries.length
    report.sourceCounts[kind] = legacyIds.size

    // _id còn ở collection cũ nhưng đã bị xóa ở đích: chỉ báo cáo.
    for (const id of legacyIds) {
      if (!entryIds.has(id)) report.deletedAtTarget.push(id)
    }

    for (const entry of entries) {
      report.scanned += 1
      report.updated += 1
      if (dryRun) continue
      const restored = { ...entry }
      delete restored.kind
      if (legacyIds.has(String(entry._id))) {
        // Bản ở đích là bản mới nhất (status/upvotes/commentsCount...).
        await legacy.replaceOne({ _id: entry._id }, restored)
      } else {
        await legacy.insertOne(restored)
      }
    }

    if (dryRun) continue
    // Chỉ xóa khỏi đích khi collection cũ đã chứa đủ.
    const have = await legacy.countDocuments({
      _id: { $in: entries.map(e => e._id) },
    })
    if (have !== entries.length) {
      report.errors.push(
        `${collection}: ${have}/${entries.length} entries restored; ${COMMUNITY_ENTRIES_COLLECTION} kind=${kind} kept; stopped`
      )
      return report
    }
    await target.deleteMany({ kind })
  }

  if (!dryRun) {
    for (const index of COMMUNITY_ENTRY_INDEXES) {
      try {
        await target.dropIndex(index.name)
      } catch {
        // chỉ mục chưa tồn tại: bỏ qua để rollback chạy lại được
      }
    }
  }
  return report
}
