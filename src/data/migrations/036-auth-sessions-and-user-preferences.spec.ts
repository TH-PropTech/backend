/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  migrateAuthSessionsAndUserPreferences,
  rollbackAuthSessionsAndUserPreferences,
  AUTH_SESSIONS_AND_USER_PREFERENCES_MIGRATION_ID,
  AUTH_SESSION_INDEXES,
  type AuthSessionsMigrationDatabase,
} from './036-auth-sessions-and-user-preferences'

describe('036-auth-sessions-and-user-preferences migration', () => {
  it('dry-run reports scanned indexes without creating them', async () => {
    const createIndexMock = jest.fn()
    const db: AuthSessionsMigrationDatabase = {
      collection: jest.fn().mockReturnValue({
        createIndex: createIndexMock,
        dropIndex: jest.fn(),
        countDocuments: jest.fn().mockResolvedValue(5),
      }),
    }

    const report = await migrateAuthSessionsAndUserPreferences(db, {
      dryRun: true,
    })

    expect(report.migrationId).toBe(
      AUTH_SESSIONS_AND_USER_PREFERENCES_MIGRATION_ID
    )
    expect(report.dryRun).toBe(true)
    expect(report.scanned).toBe(AUTH_SESSION_INDEXES.length + 5)
    expect(report.updated).toBe(0)
    expect(report.skipped).toBe(AUTH_SESSION_INDEXES.length)
    expect(createIndexMock).not.toHaveBeenCalled()
  })

  it('applies migration and creates all auth_sessions indexes', async () => {
    const createdIndices: Array<{
      keys: unknown
      options?:
        | { name?: string; expireAfterSeconds?: number; unique?: boolean }
        | undefined
    }> = []
    const db: AuthSessionsMigrationDatabase = {
      collection: jest.fn().mockReturnValue({
        createIndex: jest.fn(
          (
            keys: unknown,
            options?: {
              name?: string
              expireAfterSeconds?: number
              unique?: boolean
            }
          ) => {
            createdIndices.push({ keys, options })
            return Promise.resolve(options?.name ?? '')
          }
        ),
        dropIndex: jest.fn(),
        countDocuments: jest.fn().mockResolvedValue(0),
      }),
    }

    const report = await migrateAuthSessionsAndUserPreferences(db, {
      dryRun: false,
    })

    expect(report.dryRun).toBe(false)
    expect(report.updated).toBe(AUTH_SESSION_INDEXES.length)
    expect(report.errors).toHaveLength(0)
    expect(createdIndices).toHaveLength(AUTH_SESSION_INDEXES.length)
    expect(createdIndices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          options: expect.objectContaining({ name: 'auth_sessions_user_id' }),
        }),
        expect.objectContaining({
          options: expect.objectContaining({
            name: 'auth_sessions_refresh_token_hash',
          }),
        }),
        expect.objectContaining({
          options: expect.objectContaining({
            name: 'auth_sessions_expires_at_ttl',
            expireAfterSeconds: 0,
          }),
        }),
      ])
    )
  })

  it('rolls back by dropping indexes safely', async () => {
    const dropped: string[] = []
    const db: AuthSessionsMigrationDatabase = {
      collection: jest.fn().mockReturnValue({
        createIndex: jest.fn(),
        dropIndex: jest.fn((name: string) => {
          dropped.push(name)
          return Promise.resolve(true)
        }),
      }),
    }

    const dryReport = await rollbackAuthSessionsAndUserPreferences(db, {
      dryRun: true,
    })
    expect(dryReport.dryRun).toBe(true)
    expect(dryReport.updated).toBe(0)
    expect(dropped).toHaveLength(0)

    const applyReport = await rollbackAuthSessionsAndUserPreferences(db, {
      dryRun: false,
    })
    expect(applyReport.dryRun).toBe(false)
    expect(applyReport.updated).toBe(AUTH_SESSION_INDEXES.length)
    expect(dropped).toEqual([
      'auth_sessions_user_id',
      'auth_sessions_refresh_token_hash',
      'auth_sessions_expires_at_ttl',
    ])
  })
})
