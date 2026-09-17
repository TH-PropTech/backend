import type { Contract } from '../../modules/contracts/schemas/contract.schema'
import type { DepositAgreement } from '../../modules/contracts/schemas/deposit-agreement.schema'
import type { LedgerOutbox } from '../../modules/fabric/schemas/ledger-outbox.schema'
import type {
  MigrationOptions,
  MigrationReport,
  MigrationRepository,
} from './migration.types'

export const LEDGER_RUNTIME_MIGRATION_ID = '002-ledger-runtime'

export interface LedgerRuntimeRepositories {
  outboxRepo: MigrationRepository<LedgerOutbox>
  contractRepo: MigrationRepository<Contract>
  depositRepo: MigrationRepository<DepositAgreement>
}

export async function migrateLedgerRuntime(
  repos: LedgerRuntimeRepositories,
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? false
  const report: MigrationReport = {
    migrationId: LEDGER_RUNTIME_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
  }

  // 1. Migrate ledger_outbox
  const outboxRecords = await repos.outboxRepo.find()
  for (const record of outboxRecords) {
    report.scanned += 1
    const alreadyMigrated =
      record.dependencyKey !== undefined &&
      record.claimToken !== undefined &&
      record.claimedAt !== undefined &&
      record.leaseExpiresAt !== undefined &&
      record.confirmedAt !== undefined &&
      record.networkMode !== undefined &&
      record.blockNumber !== undefined &&
      record.errorCode !== undefined

    if (alreadyMigrated) {
      report.skipped += 1
      continue
    }

    record.dependencyKey = record.dependencyKey ?? null
    record.claimToken = record.claimToken ?? null
    record.claimedAt = record.claimedAt ?? null
    record.leaseExpiresAt = record.leaseExpiresAt ?? null
    record.confirmedAt = record.confirmedAt ?? null
    record.networkMode = record.networkMode ?? null
    record.blockNumber = record.blockNumber ?? null
    record.errorCode = record.errorCode ?? null
    report.updated += 1
    if (!dryRun) await repos.outboxRepo.save(record)
  }

  // 2. Migrate contracts
  const contracts = await repos.contractRepo.find()
  for (const contract of contracts) {
    report.scanned += 1
    const alreadyMigrated =
      contract.depositHash !== undefined &&
      contract.ledgerStatus !== undefined &&
      contract.ledgerNetworkMode !== undefined &&
      contract.ledgerRecordedAt !== undefined

    if (alreadyMigrated) {
      report.skipped += 1
      continue
    }

    contract.depositHash = contract.depositHash ?? null
    contract.ledgerStatus = contract.ledgerStatus ?? null
    contract.ledgerNetworkMode = contract.ledgerNetworkMode ?? null
    contract.ledgerRecordedAt = contract.ledgerRecordedAt ?? null
    report.updated += 1
    if (!dryRun) await repos.contractRepo.save(contract)
  }

  // 3. Migrate deposit_agreements
  const deposits = await repos.depositRepo.find()
  for (const deposit of deposits) {
    report.scanned += 1
    const alreadyMigrated =
      deposit.depositHash !== undefined &&
      deposit.ledgerStatus !== undefined &&
      deposit.depositLedgerTxId !== undefined &&
      deposit.ledgerRecordedAt !== undefined

    if (alreadyMigrated) {
      report.skipped += 1
      continue
    }

    deposit.depositHash = deposit.depositHash ?? null
    deposit.ledgerStatus = deposit.ledgerStatus ?? null
    deposit.depositLedgerTxId = deposit.depositLedgerTxId ?? null
    deposit.ledgerRecordedAt = deposit.ledgerRecordedAt ?? null
    report.updated += 1
    if (!dryRun) await repos.depositRepo.save(deposit)
  }

  return report
}
