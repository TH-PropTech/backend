import { ObjectId } from 'mongodb'
import { migrateApartmentRentalPackages } from './000-apartment-rental-packages'
import { migrateContractStatus } from './001-contract-status-expand'
import { migrateLedgerRuntime } from './002-ledger-runtime'
import {
  migrateContractStep4Persistence,
  rollbackContractStep4Persistence,
} from './003-contract-step4-persistence'
import { MigrationRunner } from './migration.runner'

type LegacyApartment = {
  _id?: ObjectId
  rentalReservation: {
    applicationId: string
    reservedAt: Date
    mode: 'application-accepted' | 'deposit-paid'
    revision?: number | null
    acceptedAt?: Date | null
    releasedAt?: Date | null
    depositPaidAt?: Date | null
  }
}

type LegacyContract = {
  _id?: ObjectId
  packageSnapshot: {
    packageId: string
    version: number
    durationMonths: 1
    monthlyRent: number
    depositPolicy: { type: 'MONTHS_OF_RENT'; months: number }
    resolvedDepositAmount: number
  }
  artifactRef?: unknown
  tenantSignature?: unknown
  landlordSignature?: unknown
}

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

  it('migrates persistence extensions without rewriting legacy one-month snapshots and rolls back only added fields', async () => {
    const legacyApartment: LegacyApartment = {
      _id: new ObjectId(),
      rentalReservation: {
        applicationId: 'application-1',
        reservedAt: new Date('2026-01-01T00:00:00.000Z'),
        mode: 'application-accepted' as const,
      },
    }
    const legacyContract: LegacyContract = {
      _id: new ObjectId(),
      packageSnapshot: {
        packageId: 'legacy-one-month',
        version: 1,
        durationMonths: 1 as const,
        monthlyRent: 10_000_000,
        depositPolicy: { type: 'MONTHS_OF_RENT' as const, months: 1 },
        resolvedDepositAmount: 10_000_000,
      },
      artifactRef: undefined,
      tenantSignature: undefined,
      landlordSignature: undefined,
    }

    const apartmentRepository = {
      find: jest.fn().mockResolvedValue([legacyApartment]),
      save: jest.fn().mockImplementation(document => Promise.resolve(document)),
    }
    const contractRepository = {
      find: jest.fn().mockResolvedValue([legacyContract]),
      save: jest.fn().mockImplementation(document => Promise.resolve(document)),
    }

    const repositories = { apartmentRepository, contractRepository }
    const report = await migrateContractStep4Persistence(repositories)

    expect(report).toMatchObject({
      scanned: 2,
      updated: 2,
      skipped: 0,
      errors: [],
      dryRun: false,
    })
    expect(legacyContract.packageSnapshot.durationMonths).toBe(1)
    expect(legacyContract.artifactRef).toBeNull()
    expect(legacyContract.tenantSignature).toBeNull()
    expect(legacyContract.landlordSignature).toBeNull()
    expect(legacyApartment.rentalReservation.revision).toBe(1)
    expect(legacyApartment.rentalReservation.acceptedAt).toEqual(
      legacyApartment.rentalReservation.reservedAt
    )

    const rollbackReport = await rollbackContractStep4Persistence(repositories)

    expect(rollbackReport).toMatchObject({
      scanned: 2,
      updated: 2,
      skipped: 0,
      errors: [],
      dryRun: false,
    })
    expect(legacyContract.packageSnapshot.durationMonths).toBe(1)
    expect(legacyContract.artifactRef).toBeUndefined()
    expect(legacyContract.tenantSignature).toBeUndefined()
    expect(legacyContract.landlordSignature).toBeUndefined()
    expect(legacyApartment.rentalReservation.revision).toBeUndefined()
    expect(legacyApartment.rentalReservation.acceptedAt).toBeUndefined()
  })

  it('supports a dry-run without mutating persistence documents', async () => {
    const apartment: LegacyApartment = {
      rentalReservation: {
        applicationId: 'application-1',
        reservedAt: new Date('2026-01-01T00:00:00.000Z'),
        mode: 'deposit-paid' as const,
        depositPaidAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    }
    const contract: LegacyContract = {
      packageSnapshot: {
        packageId: 'legacy-one-month',
        version: 1,
        durationMonths: 1 as const,
        monthlyRent: 10_000_000,
        depositPolicy: { type: 'MONTHS_OF_RENT' as const, months: 1 },
        resolvedDepositAmount: 10_000_000,
      },
    }
    const repositories = {
      apartmentRepository: {
        find: jest.fn().mockResolvedValue([apartment]),
        save: jest.fn(),
      },
      contractRepository: {
        find: jest.fn().mockResolvedValue([contract]),
        save: jest.fn(),
      },
    }

    const report = await migrateContractStep4Persistence(repositories, {
      dryRun: true,
    })

    expect(report.updated).toBe(2)
    expect(repositories.apartmentRepository.save).not.toHaveBeenCalled()
    expect(repositories.contractRepository.save).not.toHaveBeenCalled()
    expect(apartment.rentalReservation.revision).toBeUndefined()
    expect(contract.artifactRef).toBeUndefined()
  })
})
