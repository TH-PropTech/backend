import type { Contract } from '../../modules/contracts/schemas/contract.schema'
import type {
  MigrationOptions,
  MigrationReport,
  MigrationRepository,
} from './migration.types'

export const CONTRACT_STATUS_MIGRATION_ID = '001-contract-status-expand'

const CONTRACT_STATUSES = new Set([
  'draft',
  'deposit-pending',
  'deposit-paid',
  'awaiting-signature',
  'active',
  'terminated',
  'cancelled',
  'completed',
])

export async function migrateContractStatus(
  repository: MigrationRepository<Contract>,
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? false
  const report: MigrationReport = {
    migrationId: CONTRACT_STATUS_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
  }
  const contracts = await repository.find()
  for (const contract of contracts) {
    report.scanned += 1
    if (!contract.status || !CONTRACT_STATUSES.has(contract.status)) {
      report.errors.push(
        `${contract._id.toHexString()}: UNKNOWN_CONTRACT_STATUS`
      )
      continue
    }
    const alreadyMigrated =
      contract.legacyFlow !== undefined &&
      contract.hashSchemaVersion !== undefined &&
      contract.depositPaidAt !== undefined &&
      contract.depositTxHash !== undefined &&
      contract.depositAgreementCode !== undefined &&
      contract.terminatedAt !== undefined &&
      contract.terminationReason !== undefined &&
      contract.terminationTxHash !== undefined &&
      contract.editorContent !== undefined &&
      contract.contentLockedHash !== undefined &&
      contract.contentLockedAt !== undefined
    if (alreadyMigrated) {
      report.skipped += 1
      continue
    }
    contract.legacyFlow = true
    contract.hashSchemaVersion = contract.hashSchemaVersion ?? 1
    contract.depositPaidAt = contract.depositPaidAt ?? null
    contract.depositTxHash = contract.depositTxHash ?? null
    contract.depositAgreementCode = contract.depositAgreementCode ?? null
    contract.terminatedAt = contract.terminatedAt ?? null
    contract.terminationReason = contract.terminationReason ?? null
    contract.terminationTxHash = contract.terminationTxHash ?? null
    contract.editorContent = contract.editorContent ?? null
    contract.contentLockedHash = contract.contentLockedHash ?? null
    contract.contentLockedAt = contract.contentLockedAt ?? null
    report.updated += 1
    if (!dryRun) await repository.save(contract)
  }
  return report
}
