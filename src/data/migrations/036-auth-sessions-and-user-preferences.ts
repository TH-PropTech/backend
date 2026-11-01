import { safeDropIndex } from './migration.mongo-helpers'
import type { MigrationOptions, MigrationReport } from './migration.types'

export const AUTH_SESSIONS_AND_USER_PREFERENCES_MIGRATION_ID =
  '036-auth-sessions-and-user-preferences'

type IndexKeys = Record<string, 1 | -1>

export const AUTH_SESSION_INDEXES: Array<{
  collection: string
  keys: IndexKeys
  options: { name: string; unique?: boolean; expireAfterSeconds?: number }
}> = [
  {
    collection: 'auth_sessions',
    keys: { userId: 1 },
    options: { name: 'auth_sessions_user_id' },
  },
  {
    collection: 'auth_sessions',
    keys: { refreshTokenHash: 1 },
    options: { name: 'auth_sessions_refresh_token_hash' },
  },
  {
    collection: 'auth_sessions',
    keys: { expiresAt: 1 },
    options: {
      name: 'auth_sessions_expires_at_ttl',
      expireAfterSeconds: 0,
    },
  },
]

export interface AuthSessionsMigrationCollection {
  createIndex(
    keys: IndexKeys,
    options?: { name?: string; unique?: boolean; expireAfterSeconds?: number }
  ): Promise<string>
  dropIndex(name: string): Promise<unknown>
  countDocuments?(filter?: Record<string, unknown>): Promise<number>
}

export interface AuthSessionsMigrationDatabase {
  collection(name: string): AuthSessionsMigrationCollection
}

/**
 * Migration 036: Tạo chỉ mục cho collection `auth_sessions` (userId, refreshTokenHash, TTL expiresAt)
 * và đảm bảo môi trường sẵn sàng cho `notificationPreferences`.
 * Idempotent, mặc định dry-run.
 */
export async function migrateAuthSessionsAndUserPreferences(
  database: AuthSessionsMigrationDatabase,
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? true
  const errors: string[] = []

  let usersScanned = 0
  try {
    const usersCollection = database.collection('users')
    if (usersCollection.countDocuments) {
      usersScanned = await usersCollection.countDocuments({
        notificationPreferences: { $exists: false },
      })
    }
  } catch {
    // Không bắt buộc phải có users collection
  }

  if (!dryRun) {
    for (const {
      collection,
      keys,
      options: indexOptions,
    } of AUTH_SESSION_INDEXES) {
      try {
        await database.collection(collection).createIndex(keys, indexOptions)
      } catch (err) {
        errors.push(
          `Không thể tạo chỉ mục ${indexOptions.name}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  const updatedCount =
    !dryRun && errors.length === 0 ? AUTH_SESSION_INDEXES.length : 0
  const skippedCount = dryRun ? AUTH_SESSION_INDEXES.length : 0

  return {
    migrationId: AUTH_SESSIONS_AND_USER_PREFERENCES_MIGRATION_ID,
    scanned: AUTH_SESSION_INDEXES.length + usersScanned,
    updated: updatedCount,
    skipped: skippedCount,
    errors,
    dryRun,
  }
}

export async function rollbackAuthSessionsAndUserPreferences(
  database: AuthSessionsMigrationDatabase,
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? true
  let dropped = 0

  if (!dryRun) {
    for (const { collection, options: indexOptions } of AUTH_SESSION_INDEXES) {
      const ok = await safeDropIndex(
        database.collection(collection),
        indexOptions.name
      )
      if (ok) dropped++
    }
  }

  return {
    migrationId: AUTH_SESSIONS_AND_USER_PREFERENCES_MIGRATION_ID,
    scanned: AUTH_SESSION_INDEXES.length,
    updated: dryRun ? 0 : dropped,
    skipped: dryRun ? AUTH_SESSION_INDEXES.length : 0,
    errors: [],
    dryRun,
  }
}
