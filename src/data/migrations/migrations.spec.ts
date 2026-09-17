import { ObjectId } from 'mongodb'
import { migrateApartmentRentalPackages } from './000-apartment-rental-packages'
import { migrateContractStatus } from './001-contract-status-expand'
import { migrateLedgerRuntime } from './002-ledger-runtime'
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

  it('dry-runs ledger runtime migration without writing and applies null defaults idempotently', async () => {
    const rawOutbox = {
      _id: new ObjectId(),
      aggregateType: 'contract',
      aggregateId: 'c-1',
      eventType: 'contract.activated',
      dependencyKey: undefined,
      claimToken: undefined,
      claimedAt: undefined,
      leaseExpiresAt: undefined,
      confirmedAt: undefined,
      networkMode: undefined,
      blockNumber: undefined,
      errorCode: undefined,
    }
    const rawContract = {
      _id: new ObjectId(),
      depositHash: undefined,
      ledgerStatus: undefined,
      ledgerNetworkMode: undefined,
      ledgerRecordedAt: undefined,
    }
    const rawDeposit = {
      _id: new ObjectId(),
      depositHash: undefined,
      ledgerStatus: undefined,
      depositLedgerTxId: undefined,
      ledgerRecordedAt: undefined,
    }

    const outboxRepo = {
      find: jest.fn().mockImplementation(() => [{ ...rawOutbox }]),
      save: jest.fn().mockImplementation(doc => Promise.resolve(doc)),
    }
    const contractRepo = {
      find: jest.fn().mockImplementation(() => [{ ...rawContract }]),
      save: jest.fn().mockImplementation(doc => Promise.resolve(doc)),
    }
    const depositRepo = {
      find: jest.fn().mockImplementation(() => [{ ...rawDeposit }]),
      save: jest.fn().mockImplementation(doc => Promise.resolve(doc)),
    }

    const repos = { outboxRepo, contractRepo, depositRepo }

    // 1. Dry-run
    const dryReport = await migrateLedgerRuntime(repos, { dryRun: true })
    expect(dryReport).toMatchObject({
      scanned: 3,
      updated: 3,
      skipped: 0,
      dryRun: true,
    })
    expect(outboxRepo.save).not.toHaveBeenCalled()
    expect(contractRepo.save).not.toHaveBeenCalled()
    expect(depositRepo.save).not.toHaveBeenCalled()

    // 2. Real run
    const applyReport = await migrateLedgerRuntime(repos, { dryRun: false })
    expect(applyReport).toMatchObject({
      scanned: 3,
      updated: 3,
      skipped: 0,
      dryRun: false,
    })
    expect(outboxRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ dependencyKey: null })
    )
    expect(contractRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ depositHash: null })
    )
    expect(depositRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ depositHash: null })
    )

    // 3. Idempotent rerun
    const migratedOutbox = {
      ...rawOutbox,
      dependencyKey: null,
      claimToken: null,
      claimedAt: null,
      leaseExpiresAt: null,
      confirmedAt: null,
      networkMode: null,
      blockNumber: null,
      errorCode: null,
    }
    const migratedContract = {
      ...rawContract,
      depositHash: null,
      ledgerStatus: null,
      ledgerNetworkMode: null,
      ledgerRecordedAt: null,
    }
    const migratedDeposit = {
      ...rawDeposit,
      depositHash: null,
      ledgerStatus: null,
      depositLedgerTxId: null,
      ledgerRecordedAt: null,
    }

    outboxRepo.find.mockImplementation(() => [migratedOutbox])
    contractRepo.find.mockImplementation(() => [migratedContract])
    depositRepo.find.mockImplementation(() => [migratedDeposit])

    const rerunReport = await migrateLedgerRuntime(repos, { dryRun: false })
    expect(rerunReport).toMatchObject({
      scanned: 3,
      updated: 0,
      skipped: 3,
    })
  })
})
