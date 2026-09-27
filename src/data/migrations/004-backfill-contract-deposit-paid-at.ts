import type {
  MigrationOptions,
  MigrationReport,
  MigrationRepository,
} from './migration.types'

export const CONTRACT_DEPOSIT_PAID_AT_BACKFILL_MIGRATION_ID =
  '004-backfill-contract-deposit-paid-at'

type BackfillDepositAgreement = {
  _id: { toHexString(): string }
  applicationId?: string | null
  status: string
  paidAt?: Date | null
}

type BackfillContract = {
  depositAgreementId?: string | null
  rentalApplicationId?: string | null
  depositPaidAt?: Date | null
}

export interface ContractDepositPaidAtBackfillRepositories {
  contractRepository: MigrationRepository<BackfillContract>
  depositAgreementRepository: MigrationRepository<BackfillDepositAgreement>
}

export async function backfillContractDepositPaidAt(
  repositories: ContractDepositPaidAtBackfillRepositories,
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? false
  const report: MigrationReport = {
    migrationId: CONTRACT_DEPOSIT_PAID_AT_BACKFILL_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
  }
  const agreements = await repositories.depositAgreementRepository.find()
  const paidByAgreementId = new Map<string, Date>()
  const paidByApplicationId = new Map<string, Date>()

  for (const agreement of agreements) {
    if (
      !['paid', 'applied-to-lease-security'].includes(agreement.status) ||
      !agreement.paidAt
    ) {
      continue
    }
    paidByAgreementId.set(agreement._id.toHexString(), agreement.paidAt)
    if (agreement.applicationId) {
      paidByApplicationId.set(agreement.applicationId, agreement.paidAt)
    }
  }

  const contracts = await repositories.contractRepository.find()
  for (const contract of contracts) {
    report.scanned += 1
    const paidAt =
      (contract.depositAgreementId
        ? paidByAgreementId.get(contract.depositAgreementId)
        : undefined) ??
      (contract.rentalApplicationId
        ? paidByApplicationId.get(contract.rentalApplicationId)
        : undefined)
    if (contract.depositPaidAt || !paidAt) {
      report.skipped += 1
      continue
    }

    contract.depositPaidAt = paidAt
    report.updated += 1
    if (!dryRun) await repositories.contractRepository.save(contract)
  }

  return report
}
