import { ObjectId } from 'mongodb'
import {
  migrateDeviceBindingsToUsers,
  rollbackDeviceBindingsEmbed,
  type DeviceBindingsMigrationDb,
  type LegacyDeviceBinding,
  type UserSmartOtpDoc,
} from './007-device-bindings-embed'
import {
  migrateTicketMessagesToEmbedded,
  rollbackTicketMessagesEmbedding,
  type TicketMessagesMigrationDb,
} from './008-ticket-messages-embed'
import {
  migrateCommunityEntries,
  rollbackCommunityEntries,
  type CommunityMergeDb,
} from './009-community-entries-merge'
import {
  migrateMergeConfigAudits,
  rollbackMergeConfigAudits,
  type ConfigAuditMongoDatabase,
} from './010-merge-config-audits'
import {
  migrateContractDocuments,
  rollbackContractDocuments,
  type ContractDocumentsMergeDb,
} from './011-contract-documents-merge'
import {
  migrateRentalFlowConfigs,
  rollbackRentalFlowConfigs,
  type RentalFlowConfigMongoDatabase,
} from './014-rental-flow-configs-merge'
import {
  migrateMaintenanceTicketsToEmbedded,
  rollbackMaintenanceTicketsEmbedding,
} from './012-maintenance-tickets-embed'
import {
  migrateMergeSystemConfigs,
  rollbackMergeSystemConfigs,
  type SystemConfigMongoDatabase,
} from './013-merge-system-configs'
import {
  migrateReviewCases,
  rollbackReviewCases,
  type ReviewCaseMongoDatabase,
} from './015-review-cases-merge'
import {
  migrateSavedSearches,
  rollbackSavedSearches,
  type SavedSearchesMongoDatabase,
} from './016-saved-searches-merge'
import {
  migrateDistrictData,
  rollbackDistrictData,
  type DistrictDataMongoDatabase,
} from './017-district-data-merge'
import {
  migrateApartmentAnalyses,
  rollbackApartmentAnalyses,
  type ApartmentAnalysisMongoDatabase,
} from './018-apartment-analyses-merge'
import {
  migrateRolePermissionsToEmbedded,
  rollbackRolePermissionsEmbed,
  type RolePermissionsMigrationDb,
} from './019-role-permissions-embed'
import {
  migrateLegalDocuments,
  rollbackLegalDocuments,
  type LegalDocumentMongoDatabase,
} from './020-legal-documents-merge'
import {
  migrateOtps,
  rollbackOtps,
  type OtpMongoDatabase,
} from './021-otps-merge'
import {
  migrateSystemConfigsFeeGroq,
  rollbackSystemConfigsFeeGroq,
  type FeeGroqMongoDatabase,
} from './022-system-configs-fee-groq'
import {
  migrateActivityLogs,
  rollbackActivityLogs,
  type ActivityLogMongoDatabase,
} from './023-activity-logs-merge'
import {
  migrateRentalFlowAssignments,
  rollbackRentalFlowAssignments,
  type RentalFlowAssignmentMongoDatabase,
} from './024-rental-flow-assignments-merge'
import {
  migrateContractLayoutProfiles,
  rollbackContractLayoutProfiles,
  type ContractLayoutMongoDatabase,
} from './025-contract-layout-profiles-merge'
import {
  migrateKycRecordsToUsers,
  rollbackKycRecordsEmbed,
  type KycEmbedMigrationDb,
} from './026-kyc-records-embed'
import {
  migrateContractAmendmentsToEmbedded,
  rollbackContractAmendmentsEmbed,
  type ContractAmendmentsMigrationDb,
} from './027-contract-amendments-embed'
import {
  migrateSigningGrants,
  rollbackSigningGrants,
  type SigningMongoDatabase,
} from './028-signing-grants-merge'
import {
  migrateReviewsToEmbedded,
  rollbackReviewsEmbed,
  type ReviewsMongoDatabase,
} from './030-reviews-embed'
import {
  migrateConfigAuditsIntoActivityLog,
  rollbackConfigAuditsFromActivityLog,
  type ConfigAuditIntoActivityLogDatabase,
} from './031-config-audits-into-activity-log'
import {
  ensureLegalTermsVersionUnique,
  rollbackLegalTermsVersionUnique,
  type LegalTermsIndexDatabase,
} from './032-legal-terms-version-unique'
import {
  MigrationRunner,
  type MigrationCheckpointStore,
  type MigrationStep,
} from './migration.runner'
import type { MigrationReport } from './migration.types'

/** Tập con của `Db` (mongodb driver) mà CLI dùng; `Db` thật thỏa kiểu này. */
export interface CliDb {
  collection(name: string): CliCollection
}

/* eslint-disable @typescript-eslint/no-explicit-any -- cầu nối mỏng tới driver mongodb */
export type CliCollection = {
  find(filter?: any, options?: any): { toArray(): Promise<any[]> }
  findOne(filter: any): Promise<any>
  updateOne(filter: any, update: any, options?: any): Promise<any>
  insertOne(doc: any): Promise<unknown>
  deleteOne(filter: any): Promise<unknown>
  [key: string]: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const MIGRATION_CHECKPOINTS_COLLECTION = 'migration_checkpoints'

export type CliMigrationId =
  | '007'
  | '008'
  | '009'
  | '010'
  | '011'
  | '014'
  | '012'
  | '013'
  | '015'
  | '016'
  | '017'
  | '018'
  | '019'
  | '020'
  | '021'
  | '022'
  | '023'
  | '024'
  | '025'
  | '026'
  | '027'
  | '028'
  | '030'
  | '031'
  | '032'

export type CliArgs = {
  apply: boolean
  rollback: boolean
  only: CliMigrationId[]
}

const ALL: CliMigrationId[] = [
  '007',
  '008',
  '009',
  '010',
  '011',
  '014',
  '012',
  '013',
  '015',
  '016',
  '017',
  '018',
  '019',
  '020',
  '021',
  '022',
  '023',
  '024',
  '025',
  '026',
  '027',
  '028',
  '030',
  '031',
  '032',
]

/**
 * `--apply` mới ghi; mặc định dry-run. `--rollback` chạy hàm hoàn tác. `--only=007,009` chọn bước.
 * `only` luôn được sắp theo thứ tự chuẩn `ALL` (không theo thứ tự gõ), nên apply và rollback
 * đều tôn trọng ràng buộc thứ tự (013<022, 014<024, 023<031).
 */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { apply: false, rollback: false, only: [] }
  const requested: CliMigrationId[] = []
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true
    else if (arg === '--rollback') args.rollback = true
    else if (arg.startsWith('--only=')) {
      for (const id of arg.slice('--only='.length).split(',')) {
        if (!ALL.includes(id as CliMigrationId)) {
          throw new Error(`Unknown migration "${id}" (expected ${ALL.join()})`)
        }
        requested.push(id as CliMigrationId)
      }
    } else {
      throw new Error(`Unknown argument "${arg}"`)
    }
  }
  args.only =
    requested.length === 0 ? [...ALL] : ALL.filter(id => requested.includes(id))
  return args
}

export function createDeviceBindingsDb(db: CliDb): DeviceBindingsMigrationDb {
  const bindings = db.collection('device_bindings')
  const users = db.collection('users')
  return {
    readBindings: async () =>
      (await bindings.find({}).toArray()) as LegacyDeviceBinding[],
    readUsersWithDevices: async () =>
      (await users
        .find({ 'smartOTP.devices.0': { $exists: true } })
        .toArray()) as UserSmartOtpDoc[],
    upsertBinding: async (b): Promise<void> => {
      await bindings.updateOne(
        { userId: b.userId, deviceId: b.deviceId },
        {
          $set: {
            deviceName: b.deviceName,
            publicKey: b.publicKey,
            status: b.status,
            updatedAt: b.updatedAt ?? new Date(),
          },
          $setOnInsert: { _id: b._id, createdAt: b.createdAt ?? new Date() },
        },
        { upsert: true }
      )
    },
    findUser: async (id: ObjectId) =>
      (await users.findOne({ _id: id })) as UserSmartOtpDoc | null,
    updateUser: async (filter, update): Promise<{ matchedCount: number }> => {
      const result = (await users.updateOne(filter, update)) as {
        matchedCount: number
      }
      return { matchedCount: result.matchedCount }
    },
  }
}

export function createCheckpointStore(db: CliDb): MigrationCheckpointStore {
  const collection = db.collection(MIGRATION_CHECKPOINTS_COLLECTION)
  return {
    hasCompleted: async id => !!(await collection.findOne({ _id: id })),
    markCompleted: async (id, report): Promise<void> => {
      await collection.updateOne(
        { _id: id },
        { $set: { completedAt: new Date(), report } },
        { upsert: true }
      )
    },
    // Rollback thật phải xóa checkpoint, nếu không `--apply` kế tiếp bị bỏ qua im lặng.
    clearCompleted: async (id): Promise<void> => {
      await collection.deleteOne({ _id: id })
    },
  }
}

function steps(db: CliDb, only: readonly CliMigrationId[]): MigrationStep[] {
  const all: Array<[CliMigrationId, MigrationStep]> = [
    [
      '007',
      {
        id: '007-device-bindings-embed',
        run: o => migrateDeviceBindingsToUsers(createDeviceBindingsDb(db), o),
      },
    ],
    [
      '008',
      {
        id: '008-ticket-messages-embed',
        run: o =>
          migrateTicketMessagesToEmbedded(
            db as unknown as TicketMessagesMigrationDb,
            o
          ),
      },
    ],
    [
      '009',
      {
        id: '009-community-entries-merge',
        run: o => migrateCommunityEntries(db as unknown as CommunityMergeDb, o),
      },
    ],
    [
      '010',
      {
        id: '010-merge-config-audits',
        run: o =>
          migrateMergeConfigAudits(
            db as unknown as ConfigAuditMongoDatabase,
            o
          ),
      },
    ],
    [
      '011',
      {
        id: '011-contract-documents-merge',
        run: o =>
          migrateContractDocuments(
            db as unknown as ContractDocumentsMergeDb,
            o
          ),
      },
    ],
    [
      '014',
      {
        id: '014-rental-flow-configs-merge',
        run: o =>
          migrateRentalFlowConfigs(
            db as unknown as RentalFlowConfigMongoDatabase,
            o
          ),
      },
    ],
    [
      '012',
      {
        id: '012-maintenance-tickets-embed',
        run: o => migrateMaintenanceTicketsToEmbedded(db, o),
      },
    ],
    [
      '013',
      {
        id: '013-merge-system-configs',
        run: o =>
          migrateMergeSystemConfigs(
            db as unknown as SystemConfigMongoDatabase,
            o
          ),
      },
    ],
    [
      '015',
      {
        id: '015-review-cases-merge',
        run: o =>
          migrateReviewCases(db as unknown as ReviewCaseMongoDatabase, o),
      },
    ],
    [
      '016',
      {
        id: '016-saved-searches-merge',
        run: o =>
          migrateSavedSearches(db as unknown as SavedSearchesMongoDatabase, o),
      },
    ],
    [
      '017',
      {
        id: '017-district-data-merge',
        run: o =>
          migrateDistrictData(db as unknown as DistrictDataMongoDatabase, o),
      },
    ],
    [
      '018',
      {
        id: '018-apartment-analyses-merge',
        run: o =>
          migrateApartmentAnalyses(
            db as unknown as ApartmentAnalysisMongoDatabase,
            o
          ),
      },
    ],
    [
      '019',
      {
        id: '019-role-permissions-embed',
        run: o =>
          migrateRolePermissionsToEmbedded(
            db as unknown as RolePermissionsMigrationDb,
            o
          ),
      },
    ],
    [
      '020',
      {
        id: '020-legal-documents-merge',
        run: o =>
          migrateLegalDocuments(db as unknown as LegalDocumentMongoDatabase, o),
      },
    ],
    [
      '021',
      {
        id: '021-otps-merge',
        run: o => migrateOtps(db as unknown as OtpMongoDatabase, o),
      },
    ],
    [
      '022',
      {
        id: '022-system-configs-fee-groq',
        run: o =>
          migrateSystemConfigsFeeGroq(db as unknown as FeeGroqMongoDatabase, o),
      },
    ],
    [
      '023',
      {
        id: '023-activity-logs-merge',
        run: o =>
          migrateActivityLogs(db as unknown as ActivityLogMongoDatabase, o),
      },
    ],
    [
      '024',
      {
        id: '024-rental-flow-assignments-merge',
        run: o =>
          migrateRentalFlowAssignments(
            db as unknown as RentalFlowAssignmentMongoDatabase,
            o
          ),
      },
    ],
    [
      '025',
      {
        id: '025-contract-layout-profiles-merge',
        run: o =>
          migrateContractLayoutProfiles(
            db as unknown as ContractLayoutMongoDatabase,
            o
          ),
      },
    ],
    [
      '026',
      {
        id: '026-kyc-records-embed',
        run: o =>
          migrateKycRecordsToUsers(db as unknown as KycEmbedMigrationDb, o),
      },
    ],
    [
      '027',
      {
        id: '027-contract-amendments-embed',
        run: o =>
          migrateContractAmendmentsToEmbedded(
            db as unknown as ContractAmendmentsMigrationDb,
            o
          ),
      },
    ],
    [
      '028',
      {
        id: '028-signing-grants-merge',
        run: o =>
          migrateSigningGrants(db as unknown as SigningMongoDatabase, o),
      },
    ],
    [
      '030',
      {
        id: '030-reviews-embed',
        run: o =>
          migrateReviewsToEmbedded(db as unknown as ReviewsMongoDatabase, o),
      },
    ],
    [
      '031',
      {
        id: '031-config-audits-into-activity-log',
        run: o =>
          migrateConfigAuditsIntoActivityLog(
            db as unknown as ConfigAuditIntoActivityLogDatabase,
            o
          ),
      },
    ],
    [
      '032',
      {
        id: '032-legal-terms-version-unique',
        run: o =>
          ensureLegalTermsVersionUnique(
            db as unknown as LegalTermsIndexDatabase,
            o
          ),
      },
    ],
  ]
  return all.filter(([id]) => only.includes(id)).map(([, step]) => step)
}

/**
 * Chạy migration 007–032 (trừ 029). Mặc định dry-run (không ghi, không checkpoint).
 * `--apply`: chạy qua `MigrationRunner` (bỏ qua bước đã checkpoint; chỉ
 * checkpoint khi báo cáo `dryRun === false` và không lỗi). `--rollback`:
 * chạy hàm hoàn tác theo thứ tự ngược (dry-run nếu không có `--apply`).
 */
export async function runMigrationCli(
  db: CliDb,
  argv: readonly string[]
): Promise<MigrationReport[]> {
  const args = parseCliArgs(argv)
  const dryRun = !args.apply

  if (args.rollback) {
    const rollbacks: Record<CliMigrationId, () => Promise<MigrationReport>> = {
      '007': () =>
        rollbackDeviceBindingsEmbed(createDeviceBindingsDb(db), { dryRun }),
      '008': () =>
        rollbackTicketMessagesEmbedding(
          db as unknown as TicketMessagesMigrationDb,
          { dryRun }
        ),
      '009': () =>
        rollbackCommunityEntries(db as unknown as CommunityMergeDb, {
          dryRun,
        }),
      '010': () =>
        rollbackMergeConfigAudits(db as unknown as ConfigAuditMongoDatabase, {
          dryRun,
        }),
      '011': () =>
        rollbackContractDocuments(db as unknown as ContractDocumentsMergeDb, {
          dryRun,
        }),
      '014': () =>
        rollbackRentalFlowConfigs(
          db as unknown as RentalFlowConfigMongoDatabase,
          {
            dryRun,
          }
        ),
      '012': () => rollbackMaintenanceTicketsEmbedding(db, { dryRun }),
      '013': () =>
        rollbackMergeSystemConfigs(db as unknown as SystemConfigMongoDatabase, {
          dryRun,
        }),
      '015': () =>
        rollbackReviewCases(db as unknown as ReviewCaseMongoDatabase, {
          dryRun,
        }),
      '016': () =>
        rollbackSavedSearches(db as unknown as SavedSearchesMongoDatabase, {
          dryRun,
        }),
      '017': () =>
        rollbackDistrictData(db as unknown as DistrictDataMongoDatabase, {
          dryRun,
        }),
      '018': () =>
        rollbackApartmentAnalyses(
          db as unknown as ApartmentAnalysisMongoDatabase,
          { dryRun }
        ),
      '019': () =>
        rollbackRolePermissionsEmbed(
          db as unknown as RolePermissionsMigrationDb,
          {
            dryRun,
          }
        ),
      '020': () =>
        rollbackLegalDocuments(db as unknown as LegalDocumentMongoDatabase, {
          dryRun,
        }),
      '021': () => rollbackOtps(db as unknown as OtpMongoDatabase, { dryRun }),
      '022': () =>
        rollbackSystemConfigsFeeGroq(db as unknown as FeeGroqMongoDatabase, {
          dryRun,
        }),
      '023': () =>
        rollbackActivityLogs(db as unknown as ActivityLogMongoDatabase, {
          dryRun,
        }),
      '024': () =>
        rollbackRentalFlowAssignments(
          db as unknown as RentalFlowAssignmentMongoDatabase,
          { dryRun }
        ),
      '025': () =>
        rollbackContractLayoutProfiles(
          db as unknown as ContractLayoutMongoDatabase,
          { dryRun }
        ),
      '026': () =>
        rollbackKycRecordsEmbed(db as unknown as KycEmbedMigrationDb, {
          dryRun,
        }),
      '027': () =>
        rollbackContractAmendmentsEmbed(
          db as unknown as ContractAmendmentsMigrationDb,
          { dryRun }
        ),
      '028': () =>
        rollbackSigningGrants(db as unknown as SigningMongoDatabase, {
          dryRun,
        }),
      '030': () =>
        rollbackReviewsEmbed(db as unknown as ReviewsMongoDatabase, {
          dryRun,
        }),
      '031': () =>
        rollbackConfigAuditsFromActivityLog(
          db as unknown as ConfigAuditIntoActivityLogDatabase,
          { dryRun }
        ),
      '032': () =>
        rollbackLegalTermsVersionUnique(
          db as unknown as LegalTermsIndexDatabase,
          { dryRun }
        ),
    }
    const reports: MigrationReport[] = []
    const checkpoints = createCheckpointStore(db)
    // Luôn hoàn tác theo thứ tự ngược của danh sách chuẩn, không theo thứ tự gõ `--only`.
    const ordered = ALL.filter(id => args.only.includes(id)).reverse()
    for (const id of ordered) {
      const report = await rollbacks[id]()
      reports.push(report)
      const reported = (report as { dryRun?: boolean }).dryRun
      const applied = reported === false || reported === undefined
      if (applied && report.errors.length === 0) {
        const stepId = steps(db, [id])[0]?.id
        if (stepId) await checkpoints.clearCompleted?.(stepId)
      }
    }
    return reports
  }

  const runner = new MigrationRunner(
    steps(db, args.only),
    createCheckpointStore(db)
  )
  return runner.run({ dryRun })
}
