import type { ObjectId } from 'mongodb'
import type { MigrationOptions, MigrationReport } from './migration.types'

/**
 * G-RBAC: nhúng collection `permissions` vào `roles.permissions[]`.
 *
 * - Mặc định chạy thử (dry-run); chỉ ghi khi truyền `{ dryRun: false }`.
 * - Idempotent theo role: role đã có `permissions` (đã nhúng, kể cả sau khi chuyển code)
 *   bị bỏ qua, nên quyền đã xóa sau chuyển code KHÔNG bị hồi sinh. Ghi bằng một
 *   `updateOne` có điều kiện `permissions $exists:false` + `$set` (nguyên tử).
 * - `_id` cũ của từng quyền được giữ làm `_id` của phần tử nhúng.
 * - Khử trùng (action, subject) theo `updatedAt` mới nhất; trần `ROLE_PERMISSIONS_LIMIT`
 *   (6 action x 19 subject); role vượt trần chỉ được báo cáo, không ghi.
 * - Role chưa có quyền nào được gán `permissions: []` (mặc định).
 * - Kiểm đếm sau khi áp dụng: mọi `_id` đã nhúng phải có trong role, lệch thì ném lỗi.
 * - Quyền mồ côi (roleId không còn role) chỉ được báo cáo.
 * - Không xóa collection `permissions`, không sửa nó. Không tạo chỉ mục mới khi áp dụng
 *   (truy vấn chỉ theo `_id`/`name` của `roles`, chỉ mục `name` đã có).
 * - `rollbackRolePermissionsEmbed` tạo lại chỉ mục unique `(roleId, action, subject)` trên
 *   `permissions`, rồi sao ngược MỌI quyền đang nhúng (kể cả thay đổi sau chuyển code)
 *   về `permissions`, xóa bản cũ không còn nhúng, và chỉ bỏ `permissions` của role khi
 *   sao ngược của role đó đã đủ và không lỗi.
 */
export const ROLE_PERMISSIONS_EMBED_MIGRATION_ID = '019-role-permissions-embed'

/** Trần quyền mỗi role: 6 action x 19 subject (khớp `MAX_ROLE_PERMISSIONS` của schema). */
const ROLE_PERMISSIONS_LIMIT = 114

const UNIQUE_INDEX_KEYS = { roleId: 1, action: 1, subject: 1 } as const
const UNIQUE_INDEX_NAME = 'roleId_1_action_1_subject_1'

type Doc = Record<string, unknown>

export interface MigrationCollection {
  find(
    filter?: Doc,
    options?: { projection?: Doc }
  ): { toArray(): Promise<Doc[]> }
  countDocuments(filter?: Doc): Promise<number>
  updateOne(
    filter: Doc,
    update: Doc
  ): Promise<{ matchedCount: number; modifiedCount?: number }>
  replaceOne(
    filter: Doc,
    doc: Doc,
    options?: { upsert?: boolean }
  ): Promise<{ matchedCount: number }>
  deleteMany(filter: Doc): Promise<unknown>
  createIndex(
    keys: Record<string, 1 | -1>,
    options?: { name?: string; unique?: boolean }
  ): Promise<unknown>
}

export interface RolePermissionsMigrationDb {
  collection(name: string): MigrationCollection
}

/** Quyền nhúng (khớp `RolePermission` của `role.schema.ts`). */
export type EmbeddedRolePermission = {
  _id: ObjectId
  action: string
  subject: string
  allowed: boolean
  createdAt: Date
  updatedAt: Date
}

export type RolePermissionsMigrationReport = MigrationReport & {
  /** Số role đã xét (migrate) hoặc đã xét khi rollback. */
  scanned: number
  /** Số quyền nguồn (`permissions`) đã đọc. */
  sourcePermissions: number
  /** Số quyền đã/sẽ được nhúng (sau khử trùng). */
  embeddedPermissions: number
  /** Role chưa có quyền nào, được gán `permissions: []`. */
  backfilledRoles: number
  /** Quyền nguồn có roleId không còn role: bỏ qua, không nhúng. */
  orphanPermissions: number
  orphanRoleIds: string[]
  /** Role vượt trần quyền: không nhúng, cần xử lý tay. */
  oversizedRoleIds: string[]
  /** Sau khi áp dụng: tổng số quyền kỳ vọng và số tìm thấy trong role. */
  expectedPermissions: number
  verifiedPermissions: number
}

function newReport(
  dryRun: boolean,
  id = ROLE_PERMISSIONS_EMBED_MIGRATION_ID
): RolePermissionsMigrationReport {
  return {
    migrationId: id,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    sourcePermissions: 0,
    embeddedPermissions: 0,
    backfilledRoles: 0,
    orphanPermissions: 0,
    orphanRoleIds: [],
    oversizedRoleIds: [],
    expectedPermissions: 0,
    verifiedPermissions: 0,
  }
}

function time(value: unknown): number {
  return value instanceof Date ? value.getTime() : 0
}

/** Khử trùng (action, subject): giữ bản có updatedAt mới nhất (vị trí lần đầu, như Map). */
function dedupeRows(rows: Doc[]): Map<string, Doc> {
  const byKey = new Map<string, Doc>()
  for (const row of rows) {
    const key = `${String(row.action)}:${String(row.subject)}`
    const prev = byKey.get(key)
    if (!prev || time(row.updatedAt) >= time(prev.updatedAt)) {
      byKey.set(key, row)
    }
  }
  return byKey
}

function toEmbedded(row: Doc): EmbeddedRolePermission {
  const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date()
  return {
    _id: row._id as ObjectId,
    action: String(row.action),
    subject: String(row.subject),
    allowed: row.allowed === undefined ? true : Boolean(row.allowed),
    createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : createdAt,
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Nhúng `permissions` vào `roles.permissions[]`. */
export async function migrateRolePermissionsToEmbedded(
  db: RolePermissionsMigrationDb,
  options: MigrationOptions = {}
): Promise<RolePermissionsMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const roles = db.collection('roles')
  const legacy = db.collection('permissions')

  const roleDocs = await roles.find({}).toArray()
  const roleIds = new Set(roleDocs.map(r => String(r._id)))
  const sourceRows = await legacy.find({}).toArray()
  report.sourcePermissions = sourceRows.length

  const rowsByRole = new Map<string, Doc[]>()
  const orphanIds = new Set<string>()
  for (const row of sourceRows) {
    const roleId = String(row.roleId)
    if (!roleIds.has(roleId)) {
      report.orphanPermissions += 1
      report.skipped += 1
      orphanIds.add(roleId)
      continue
    }
    const list = rowsByRole.get(roleId) ?? []
    list.push(row)
    rowsByRole.set(roleId, list)
  }
  report.orphanRoleIds = [...orphanIds]

  const written: Array<[ObjectId, EmbeddedRolePermission[]]> = []

  for (const role of roleDocs) {
    report.scanned += 1
    if (Array.isArray(role.permissions)) {
      report.skipped += 1 // đã nhúng: không chạm lại
      continue
    }
    const roleOid = role._id as ObjectId
    const roleId = String(role._id)
    const rows = rowsByRole.get(roleId) ?? []
    const entries = [...dedupeRows(rows).values()].map(toEmbedded)
    report.skipped += rows.length - entries.length // bản trùng (action, subject)

    if (entries.length > ROLE_PERMISSIONS_LIMIT) {
      report.skipped += 1
      report.oversizedRoleIds.push(roleId)
      report.errors.push(
        `role ${roleId}: ${entries.length} permissions exceed the ${ROLE_PERMISSIONS_LIMIT} cap; not migrated`
      )
      continue
    }
    if (rows.length === 0) report.backfilledRoles += 1
    report.embeddedPermissions += entries.length

    if (dryRun) {
      report.updated += 1
      continue
    }
    const result = await roles.updateOne(
      { _id: roleOid, permissions: { $exists: false } },
      { $set: { permissions: entries } }
    )
    if (result.matchedCount === 0) {
      // Role vừa được nhúng bởi luồng khác: bỏ qua, không ghi đè
      report.embeddedPermissions -= entries.length
      report.skipped += 1
      continue
    }
    report.updated += 1
    written.push([roleOid, entries])
  }

  if (!dryRun) {
    for (const [, entries] of written) {
      report.expectedPermissions += entries.length
    }
    for (const [roleOid, entries] of written) {
      const [after] = await roles.find({ _id: roleOid }).toArray()
      const present = new Set(
        ((after?.permissions as Doc[] | undefined) ?? []).map(p =>
          String(p._id)
        )
      )
      for (const entry of entries) {
        if (present.has(String(entry._id))) report.verifiedPermissions += 1
        else
          report.errors.push(
            `${String(roleOid)}:${entry.action}:${entry.subject} missing after migrate`
          )
      }
    }
    if (report.verifiedPermissions !== report.expectedPermissions) {
      throw new Error(
        `${ROLE_PERMISSIONS_EMBED_MIGRATION_ID}: count mismatch ` +
          `(expected ${report.expectedPermissions}, found ${report.verifiedPermissions})`
      )
    }
  }

  return report
}

/**
 * Hoàn tác: với mỗi role đang nhúng `permissions`, xóa bản cũ không còn trong nhúng,
 * sao ngược từng quyền nhúng về `permissions` (giữ `_id`), rồi mới `$unset`
 * `permissions` của role nếu sao ngược đủ và không lỗi. Collection nguồn không bị xóa.
 * Dry-run mặc định.
 */
export async function rollbackRolePermissionsEmbed(
  db: RolePermissionsMigrationDb,
  options: MigrationOptions = {}
): Promise<RolePermissionsMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(
    dryRun,
    `${ROLE_PERMISSIONS_EMBED_MIGRATION_ID}:rollback`
  )
  const roles = db.collection('roles')
  const legacy = db.collection('permissions')

  const embeddedRoles = await roles
    .find({ permissions: { $exists: true } })
    .toArray()
  if (!dryRun && embeddedRoles.length > 0) {
    // Trước khi sao ngược: khôi phục ràng buộc unique của collection cũ (fail-fast, chưa ghi gì).
    await legacy.createIndex(UNIQUE_INDEX_KEYS, {
      name: UNIQUE_INDEX_NAME,
      unique: true,
    })
  }

  for (const role of embeddedRoles) {
    report.scanned += 1
    const roleOid = role._id as ObjectId
    const roleId = String(role._id)
    const embedded = (
      Array.isArray(role.permissions) ? role.permissions : []
    ) as Doc[]
    report.embeddedPermissions += embedded.length
    if (dryRun) {
      report.updated += 1
      continue
    }

    const keepIds = embedded.map(p => p._id as ObjectId)
    // Bản cũ không còn trong nhúng (đã xóa/thay sau chuyển code) bỏ trước để không trùng unique.
    await legacy.deleteMany({ roleId, _id: { $nin: keepIds } })

    let ok = true
    for (const p of embedded) {
      try {
        await legacy.replaceOne(
          { _id: p._id },
          {
            _id: p._id,
            roleId,
            action: p.action,
            subject: p.subject,
            allowed: p.allowed,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          },
          { upsert: true }
        )
      } catch (error) {
        ok = false
        report.errors.push(
          `${roleId}:${String(p.action)}:${String(p.subject)} copy back failed: ${errorText(error)}`
        )
      }
    }

    if (ok) {
      const restored = await legacy.find({ roleId }).toArray()
      const ids = new Set(restored.map(r => String(r._id)))
      const lacking = keepIds.filter(id => !ids.has(String(id)))
      if (lacking.length > 0 || restored.length !== keepIds.length) {
        ok = false
        report.errors.push(
          `role ${roleId}: ${lacking.length} permissions not restored (${restored.length}/${keepIds.length}); permissions[] kept`
        )
      }
    }
    if (!ok) continue

    await roles.updateOne({ _id: roleOid }, { $unset: { permissions: '' } })
    report.verifiedPermissions += keepIds.length
    report.updated += 1
  }

  return report
}
