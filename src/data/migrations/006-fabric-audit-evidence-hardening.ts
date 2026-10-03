import type {
  MigrationOptions,
  MigrationReport,
  MigrationRepository,
} from './migration.types'

export const FABRIC_AUDIT_EVIDENCE_HARDENING_MIGRATION_ID =
  '006-fabric-audit-evidence-hardening'

type IndexKeys = Record<string, 1 | -1>

export interface MongoIndexCollection {
  createIndex(
    keys: IndexKeys,
    options?: { name?: string; unique?: boolean; sparse?: boolean }
  ): Promise<string>
}

export interface FabricAuditEvidenceMongoDatabase {
  collection(name: string): MongoIndexCollection
}

const INDEXES: Array<{
  collection: string
  keys: IndexKeys
  options?: { name?: string; unique?: boolean; sparse?: boolean }
}> = [
  // D6: blockchain_logs lookup indexes, including each new aggregate reference.
  {
    collection: 'blockchain_logs',
    keys: { contractId: 1, createdAt: -1 },
    options: { name: 'blockchain_logs_contract_created' },
  },
  {
    collection: 'blockchain_logs',
    keys: { eventType: 1, createdAt: -1 },
    options: { name: 'blockchain_logs_event_created' },
  },
  {
    collection: 'blockchain_logs',
    keys: { txHash: 1 },
    options: { name: 'blockchain_logs_txhash', sparse: true },
  },
  {
    collection: 'blockchain_logs',
    keys: { governanceSnapshotId: 1 },
    options: { name: 'blockchain_logs_governance_snapshot', sparse: true },
  },
  {
    collection: 'blockchain_logs',
    keys: { settlementId: 1 },
    options: { name: 'blockchain_logs_settlement', sparse: true },
  },
  {
    collection: 'blockchain_logs',
    keys: { handoverRevision: 1 },
    options: { name: 'blockchain_logs_handover_revision', sparse: true },
  },
  {
    collection: 'blockchain_logs',
    keys: { schemaVersion: 1 },
    options: { name: 'blockchain_logs_schema_version', sparse: true },
  },
  {
    collection: 'blockchain_logs',
    keys: { payloadHash: 1 },
    options: { name: 'blockchain_logs_payload_hash', sparse: true },
  },
  // D2: governance snapshot manifest — unique code/version, status lookup.
  {
    collection: 'fabric_governance_snapshots',
    keys: { version: 1 },
    options: {
      name: 'fabric_governance_snapshots_version_unique',
      unique: true,
    },
  },
  {
    collection: 'fabric_governance_snapshots',
    keys: { snapshotCode: 1 },
    options: {
      name: 'fabric_governance_snapshots_code_unique',
      unique: true,
    },
  },
  {
    collection: 'fabric_governance_snapshots',
    keys: { ledgerStatus: 1, publishedAt: -1 },
    options: { name: 'fabric_governance_snapshots_status_published' },
  },
  // D6: Audit Center queries over ledger_outbox (contract/event/state filters, oldest pending).
  {
    collection: 'ledger_outbox',
    keys: { contractId: 1, createdAt: -1 },
    options: { name: 'ledger_outbox_contract_created', sparse: true },
  },
  {
    collection: 'ledger_outbox',
    keys: { eventType: 1, updatedAt: -1 },
    options: { name: 'ledger_outbox_event_updated' },
  },
  {
    collection: 'ledger_outbox',
    keys: { status: 1, nextRetryAt: 1, leaseExpiresAt: 1 },
    options: { name: 'ledger_outbox_status_retry_lease' },
  },
  // D7: bounded, resumable reconciliation runs/findings.
  {
    collection: 'ledger_reconciliation_runs',
    keys: { status: 1, createdAt: -1 },
    options: { name: 'ledger_reconciliation_runs_status_created' },
  },
  {
    collection: 'ledger_reconciliation_findings',
    keys: { fingerprint: 1 },
    options: {
      name: 'ledger_reconciliation_findings_fingerprint_unique',
      unique: true,
    },
  },
  {
    collection: 'ledger_reconciliation_findings',
    keys: { runId: 1, category: 1, status: 1 },
    options: { name: 'ledger_reconciliation_findings_run_category_status' },
  },
  {
    collection: 'ledger_reconciliation_findings',
    keys: { aggregateType: 1, aggregateId: 1, eventType: 1 },
    options: { name: 'ledger_reconciliation_findings_aggregate' },
  },
  {
    collection: 'ledger_reconciliation_findings',
    keys: { contractId: 1, lastSeenAt: -1 },
    options: { name: 'ledger_reconciliation_findings_contract_lastseen' },
  },
]

export async function ensureFabricAuditEvidenceIndexes(
  database: FabricAuditEvidenceMongoDatabase
): Promise<number> {
  for (const index of INDEXES) {
    await database
      .collection(index.collection)
      .createIndex(index.keys, index.options)
  }
  return INDEXES.length
}

type OutboxDependencyKeysDoc = {
  dependencyKey?: string | null
  dependencyKeys?: string[] | null
}

export type OutboxDependencyKeysRepository =
  MigrationRepository<OutboxDependencyKeysDoc>

/**
 * PROP-399 D12/B1: copy the legacy single `dependencyKey` into the new
 * `dependencyKeys` array so multi-parent dependency checks see every
 * already-existing single-parent item too. Does not remove `dependencyKey` —
 * it stays readable for one release. Idempotent: a document that already
 * has `dependencyKeys` set is left untouched.
 */
export async function migrateLedgerOutboxDependencyKeys(
  repository: OutboxDependencyKeysRepository,
  options: MigrationOptions = {}
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? false
  const report: MigrationReport = {
    migrationId: FABRIC_AUDIT_EVIDENCE_HARDENING_MIGRATION_ID,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
  }

  const items = await repository.find()
  for (const item of items) {
    report.scanned += 1
    if (!item.dependencyKey || item.dependencyKeys) {
      report.skipped += 1
      continue
    }
    report.updated += 1
    if (!dryRun) {
      item.dependencyKeys = [item.dependencyKey]
      await repository.save(item)
    }
  }

  return report
}
