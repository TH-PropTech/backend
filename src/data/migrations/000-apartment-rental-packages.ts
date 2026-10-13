import type { Apartment } from '../../modules/properties/schemas/apartment.schema'
import type {
  MigrationOptions,
  MigrationReport,
  MigrationRepository,
} from './migration.types'

export const APARTMENT_RENTAL_PACKAGES_MIGRATION_ID =
  '000-apartment-rental-packages'

export async function migrateApartmentRentalPackages(
  repository: MigrationRepository<Apartment>,
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? false
  const report: MigrationReport = {
    migrationId: APARTMENT_RENTAL_PACKAGES_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
  }
  const apartments = await repository.find()
  for (const apartment of apartments) {
    report.scanned += 1
    const packages = apartment.rentalPackages ?? []
    const expectedMode = packages.length > 0 ? 'packages' : 'legacy'
    const alreadyMigrated =
      apartment.pricingMode === expectedMode &&
      apartment.pricingRevision !== undefined &&
      apartment.legacyFlow !== undefined
    if (alreadyMigrated) {
      report.skipped += 1
      continue
    }
    apartment.pricingMode = expectedMode
    apartment.pricingRevision = apartment.pricingRevision ?? 0
    apartment.rentalPackages = packages
    apartment.legacyFlow = expectedMode === 'legacy'
    report.updated += 1
    if (!dryRun) await repository.save(apartment)
  }
  return report
}
