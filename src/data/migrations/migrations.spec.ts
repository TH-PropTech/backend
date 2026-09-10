import { ObjectId } from 'mongodb'
import { migrateApartmentRentalPackages } from './000-apartment-rental-packages'
import { migrateContractStatus } from './001-contract-status-expand'
import { MigrationRunner } from './migration.runner'

describe('PROP-321 migrations', () => {
  it('dry-runs apartment package defaults without writing and applies them idempotently', async () => {
    const apartment = {
      pricingMode: undefined,
      pricingRevision: undefined,
      rentalPackages: undefined,
      legacyFlow: undefined,
    }
    const repository = {
      find: jest.fn().mockResolvedValue([apartment]),
      save: jest.fn().mockResolvedValue(apartment),
    }

    await expect(
      migrateApartmentRentalPackages(repository)
    ).resolves.toMatchObject({
      scanned: 1,
      updated: 1,
      dryRun: false,
    })
    expect(repository.save).toHaveBeenCalledTimes(1)
    await expect(
      migrateApartmentRentalPackages(repository, { dryRun: true })
    ).resolves.toMatchObject({
      scanned: 1,
      skipped: 1,
      updated: 0,
      dryRun: true,
    })
    expect(repository.save).toHaveBeenCalledTimes(1)
  })

  it('backfills contract lifecycle defaults and reports unknown statuses without writing them', async () => {
    const valid = {
      _id: new ObjectId(),
      status: 'active' as const,
      hashSchemaVersion: undefined,
      depositPaidAt: undefined,
      depositTxHash: undefined,
      depositAgreementCode: undefined,
      terminatedAt: undefined,
      terminationReason: undefined,
      terminationTxHash: undefined,
      editorContent: undefined,
      contentLockedHash: undefined,
      contentLockedAt: undefined,
      legacyFlow: undefined,
    }
    const invalid = {
      ...valid,
      _id: new ObjectId(),
      status: 'unknown' as never,
    }
    const repository = {
      find: jest.fn().mockResolvedValue([valid, invalid]),
      save: jest.fn().mockResolvedValue(valid),
    }

    const report = await migrateContractStatus(repository)
    expect(report).toMatchObject({
      scanned: 2,
      updated: 1,
      errors: [`${invalid._id.toHexString()}: UNKNOWN_CONTRACT_STATUS`],
    })
    expect(valid.legacyFlow).toBe(true)
    expect(valid.hashSchemaVersion).toBe(1)
    expect(valid.terminationReason).toBeNull()
    expect(repository.save).toHaveBeenCalledTimes(1)
  })

  it('skips completed checkpoints on apply but still executes dry-run verification', async () => {
    const run = jest.fn().mockResolvedValue({
      migrationId: '000-test',
      scanned: 1,
      updated: 0,
      skipped: 1,
      errors: [],
      dryRun: false,
    })
    const checkpointStore = {
      hasCompleted: jest.fn().mockResolvedValue(true),
      markCompleted: jest.fn(),
    }
    const runner = new MigrationRunner(
      [{ id: '000-test', run }],
      checkpointStore
    )

    await expect(runner.run()).resolves.toEqual([])
    expect(run).not.toHaveBeenCalled()
    await expect(runner.run({ dryRun: true })).resolves.toHaveLength(1)
    expect(run).toHaveBeenCalledWith({ dryRun: true })
    expect(checkpointStore.markCompleted).not.toHaveBeenCalled()
  })
})
