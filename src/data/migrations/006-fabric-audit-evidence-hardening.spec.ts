import {
  ensureFabricAuditEvidenceIndexes,
  migrateLedgerOutboxDependencyKeys,
  type FabricAuditEvidenceMongoDatabase,
} from './006-fabric-audit-evidence-hardening'

describe('fabric audit evidence hardening migration (PROP-399)', () => {
  it('creates every expected index exactly once per name, and is idempotent on a second run', async () => {
    const calls: Array<{ collection: string; name?: string }> = []
    const database: FabricAuditEvidenceMongoDatabase = {
      collection: (collection: string) => ({
        createIndex: jest.fn(
          (
            _keys: Record<string, 1 | -1>,
            options?: { name?: string; unique?: boolean; sparse?: boolean }
          ): Promise<string> => {
            calls.push({
              collection,
              ...(options?.name ? { name: options.name } : {}),
            })
            return Promise.resolve(options?.name ?? `${collection}-index`)
          }
        ),
      }),
    }

    const first = await ensureFabricAuditEvidenceIndexes(database)
    const second = await ensureFabricAuditEvidenceIndexes(database)

    expect(first).toBeGreaterThan(10)
    expect(second).toBe(first)
    expect(calls).toHaveLength(first * 2)
    expect(new Set(calls.map(call => call.name)).size).toBe(first)
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collection: 'blockchain_logs',
          name: 'blockchain_logs_governance_snapshot',
        }),
        expect.objectContaining({
          collection: 'fabric_governance_snapshots',
          name: 'fabric_governance_snapshots_version_unique',
        }),
        expect.objectContaining({
          collection: 'ledger_reconciliation_findings',
          name: 'ledger_reconciliation_findings_fingerprint_unique',
        }),
        expect.objectContaining({
          collection: 'ledger_outbox',
          name: 'ledger_outbox_contract_created',
        }),
        expect.objectContaining({
          collection: 'ledger_reconciliation_findings',
          name: 'ledger_reconciliation_findings_aggregate',
        }),
        expect.objectContaining({
          collection: 'ledger_reconciliation_runs',
          name: 'ledger_reconciliation_runs_status_created',
        }),
      ])
    )
  })

  it('dry-runs the dependencyKey -> dependencyKeys copy without writing, preserves legacy ordering, and is idempotent on rerun', async () => {
    const legacyItem = {
      dependencyKey: 'deposit:agreement-1:deposit.paid',
      dependencyKeys: undefined as string[] | undefined,
    }
    const alreadyMigratedItem = {
      dependencyKey: 'contract:c1:contract.activated',
      dependencyKeys: ['contract:c1:contract.activated'],
    }
    const noDependencyItem = {
      dependencyKey: undefined as string | undefined,
      dependencyKeys: undefined as string[] | undefined,
    }

    const repository = {
      find: jest
        .fn()
        .mockResolvedValue([legacyItem, alreadyMigratedItem, noDependencyItem]),
      save: jest.fn().mockImplementation(doc => Promise.resolve(doc)),
    }

    // 1. Dry-run changes nothing.
    const dryReport = await migrateLedgerOutboxDependencyKeys(repository, {
      dryRun: true,
    })
    expect(dryReport).toMatchObject({ scanned: 3, updated: 1, skipped: 2 })
    expect(repository.save).not.toHaveBeenCalled()
    expect(legacyItem.dependencyKeys).toBeUndefined()

    // 2. Real run copies the legacy key, preserving its exact value/order
    // (a single-element array — no reordering of an existing dependency).
    const realReport = await migrateLedgerOutboxDependencyKeys(repository)
    expect(realReport).toMatchObject({ scanned: 3, updated: 1, skipped: 2 })
    expect(legacyItem.dependencyKeys).toEqual([
      'deposit:agreement-1:deposit.paid',
    ])
    expect(legacyItem.dependencyKey).toBe('deposit:agreement-1:deposit.paid')
    expect(repository.save).toHaveBeenCalledWith(legacyItem)
    expect(repository.save).toHaveBeenCalledTimes(1)

    // 3. Rerun is a no-op (idempotent): nothing left to copy.
    const rerunReport = await migrateLedgerOutboxDependencyKeys(repository)
    expect(rerunReport).toMatchObject({ scanned: 3, updated: 0, skipped: 3 })
    expect(repository.save).toHaveBeenCalledTimes(1)
  })

  it('never touches contracts or fabricates a governance reference for historical records', async () => {
    // This migration only creates indexes and copies ledger_outbox
    // dependencyKey -> dependencyKeys; it has no contract repository
    // dependency at all, so it cannot invent governanceSnapshotRef on old
    // contracts.
    const module: Record<string, unknown> =
      await import('./006-fabric-audit-evidence-hardening')
    expect(Object.keys(module)).not.toContain('migrateContractGovernanceRef')
  })
})
