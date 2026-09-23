import type {
  MigrationOptions,
  MigrationReport,
  MigrationRepository,
} from './migration.types'

export const CONTRACT_STEP4_PERSISTENCE_MIGRATION_ID =
  '003-contract-step4-persistence'

type ReservationDocument = {
  applicationId: string
  reservedAt: Date
  mode: 'application-accepted' | 'deposit-paid'
  revision?: number | null
  acceptedAt?: Date | null
  depositPaidAt?: Date | null
  leaseActivatedAt?: Date | null
  releasedAt?: Date | null
}

type ApartmentPersistenceDocument = {
  rentalReservation?: ReservationDocument | null
}

type ContractPersistenceDocument = {
  packageSnapshot?: { durationMonths: number } | null
  artifactRef?: unknown
  tenantSignature?: unknown
  landlordSignature?: unknown
}

export type ContractStep4PersistenceRepositories = {
  apartmentRepository: MigrationRepository<ApartmentPersistenceDocument>
  contractRepository: MigrationRepository<ContractPersistenceDocument>
}

function createReport(dryRun: boolean): MigrationReport {
  return {
    migrationId: CONTRACT_STEP4_PERSISTENCE_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
  }
}

export async function migrateContractStep4Persistence(
  repositories: ContractStep4PersistenceRepositories,
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? false
  const report = createReport(dryRun)

  const apartments = await repositories.apartmentRepository.find()
  for (const apartment of apartments) {
    report.scanned += 1
    const reservation = apartment.rentalReservation
    if (
      !reservation ||
      (reservation.revision !== undefined &&
        reservation.acceptedAt !== undefined &&
        reservation.releasedAt !== undefined)
    ) {
      report.skipped += 1
      continue
    }

    if (!dryRun) {
      reservation.revision = reservation.revision ?? 1
      reservation.acceptedAt = reservation.acceptedAt ?? reservation.reservedAt
      reservation.releasedAt = reservation.releasedAt ?? null
    }
    report.updated += 1
    if (!dryRun) await repositories.apartmentRepository.save(apartment)
  }

  const contracts = await repositories.contractRepository.find()
  for (const contract of contracts) {
    report.scanned += 1
    const needsUpdate =
      contract.artifactRef === undefined ||
      contract.tenantSignature === undefined ||
      contract.landlordSignature === undefined
    if (!needsUpdate) {
      report.skipped += 1
      continue
    }

    if (!dryRun) {
      contract.artifactRef = contract.artifactRef ?? null
      contract.tenantSignature = contract.tenantSignature ?? null
      contract.landlordSignature = contract.landlordSignature ?? null
    }
    report.updated += 1
    if (!dryRun) await repositories.contractRepository.save(contract)
  }

  return report
}

export async function rollbackContractStep4Persistence(
  repositories: ContractStep4PersistenceRepositories,
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? false
  const report = createReport(dryRun)

  const apartments = await repositories.apartmentRepository.find()
  for (const apartment of apartments) {
    report.scanned += 1
    const reservation = apartment.rentalReservation
    if (!reservation) {
      report.skipped += 1
      continue
    }

    delete reservation.revision
    delete reservation.acceptedAt
    delete reservation.releasedAt
    report.updated += 1
    if (!dryRun) await repositories.apartmentRepository.save(apartment)
  }

  const contracts = await repositories.contractRepository.find()
  for (const contract of contracts) {
    report.scanned += 1
    if (
      contract.artifactRef === undefined &&
      contract.tenantSignature === undefined &&
      contract.landlordSignature === undefined
    ) {
      report.skipped += 1
      continue
    }

    delete contract.artifactRef
    delete contract.tenantSignature
    delete contract.landlordSignature
    report.updated += 1
    if (!dryRun) await repositories.contractRepository.save(contract)
  }

  return report
}
