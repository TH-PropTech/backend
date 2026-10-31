import {
  MOVE_IN_SETTLEMENT_OVERDUE_BODY,
  MOVE_IN_SETTLEMENT_OVERDUE_LEGACY_TITLE,
  MOVE_IN_SETTLEMENT_OVERDUE_TITLE,
} from '../../modules/rental/utils/move-in-settlement-overdue.message'
import type { MigrationOptions, MigrationReport } from './migration.types'

/**
 * Việt hóa thông báo cũ `Move-in settlement overdue`: chỉ bản ghi khớp ĐÚNG tiêu đề cũ bị đổi
 * `title`/`body`. Nội dung cũ có id hợp đồng nhưng id vẫn còn ở `data.contractId` (code cũ đã
 * ghi), nên không cần trích từ body. Idempotent vì sau khi đổi tiêu đề không còn khớp.
 * Mặc định dry-run.
 */
export const MOVE_IN_OVERDUE_NOTIFICATIONS_VI_MIGRATION_ID =
  '035-move-in-overdue-notifications-vi'

const FILTER = { title: MOVE_IN_SETTLEMENT_OVERDUE_LEGACY_TITLE }

/** Tập con của `Collection` trong mongodb driver mà migration cần. */
export interface NotificationsMongoCollection {
  countDocuments(filter: Record<string, unknown>): Promise<number>
  updateMany(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<{ modifiedCount?: number }>
}

export interface NotificationsMongoDatabase {
  collection(name: string): NotificationsMongoCollection
}

export async function localizeMoveInOverdueNotifications(
  database: NotificationsMongoDatabase,
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? true
  const collection = database.collection('notifications')
  const scanned = await collection.countDocuments(FILTER)
  const result = dryRun
    ? { modifiedCount: 0 }
    : await collection.updateMany(FILTER, {
        $set: {
          title: MOVE_IN_SETTLEMENT_OVERDUE_TITLE,
          body: MOVE_IN_SETTLEMENT_OVERDUE_BODY,
        },
      })
  const updated = result.modifiedCount ?? 0
  return {
    migrationId: MOVE_IN_OVERDUE_NOTIFICATIONS_VI_MIGRATION_ID,
    scanned,
    updated,
    skipped: scanned - updated,
    errors: [],
    dryRun,
  }
}

/** Không hoàn tác: chuỗi tiếng Anh cũ chứa id nội bộ nên không được khôi phục. */
export function rollbackMoveInOverdueNotificationsVi(
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  return Promise.resolve({
    migrationId: MOVE_IN_OVERDUE_NOTIFICATIONS_VI_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun: options.dryRun ?? true,
  })
}
