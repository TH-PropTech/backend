import { getMetadataArgsStorage } from 'typeorm'
import { BlockchainLog } from './blockchain-log.schema'
import { LedgerOutbox } from './ledger-outbox.schema'
import { FabricGovernanceSnapshot } from './fabric-governance-snapshot.schema'
import { LedgerReconciliationRun } from './ledger-reconciliation-run.schema'
import { LedgerReconciliationFinding } from './ledger-reconciliation-finding.schema'

type MetadataTarget = string | (new (...args: never[]) => object)

function getColumnNames(target: MetadataTarget): string[] {
  return getMetadataArgsStorage()
    .columns.filter(column => column.target === target)
    .map(column =>
      typeof column.propertyName === 'string' ? column.propertyName : ''
    )
    .filter(Boolean)
}

function getIndexColumns(target: MetadataTarget): string[][] {
  return getMetadataArgsStorage()
    .indices.filter(index => index.target === target)
    .map(index => index.columns)
    .filter((columns): columns is string[] => Array.isArray(columns))
}

describe('fabric module persistence schema (PROP-399)', () => {
  it('keeps ledger_outbox.dependencyKey readable while adding optional multi-parent dependencyKeys (D12/B1)', () => {
    expect(getColumnNames(LedgerOutbox)).toEqual(
      expect.arrayContaining(['dependencyKey', 'dependencyKeys'])
    )
    const legacy = new LedgerOutbox()
    expect(legacy.dependencyKey).toBeUndefined()
    expect(legacy.dependencyKeys).toBeUndefined()
    legacy.dependencyKeys = ['contract:c1:contract.activated']
    expect(legacy.dependencyKeys).toHaveLength(1)
  })

  it('extends blockchain_logs with optional indexed evidence references (D6)', () => {
    const columns = getColumnNames(BlockchainLog)
    expect(columns).toEqual(
      expect.arrayContaining([
        'governanceSnapshotId',
        'settlementId',
        'handoverRevision',
        'schemaVersion',
        'payloadHash',
      ])
    )
    const legacy = new BlockchainLog()
    expect(legacy.governanceSnapshotId).toBeUndefined()
    expect(getIndexColumns(BlockchainLog)).toEqual(
      expect.arrayContaining([
        ['contractId', 'createdAt'],
        ['eventType', 'createdAt'],
        ['txHash'],
      ])
    )
  })

  it('persists an immutable, versioned governance snapshot manifest (D2)', () => {
    const snapshot = new FabricGovernanceSnapshot()
    expect(getColumnNames(FabricGovernanceSnapshot)).toEqual(
      expect.arrayContaining([
        'snapshotCode',
        'version',
        'manifestSchemaVersion',
        'status',
        'components',
        'manifestHash',
        'ledgerStatus',
        'txHash',
        'blockNumber',
        'publishedBy',
        'publishedAt',
      ])
    )
    expect(getIndexColumns(FabricGovernanceSnapshot)).toEqual(
      expect.arrayContaining([['version'], ['snapshotCode']])
    )
    expect(snapshot.status).toBeUndefined()
  })

  it('persists a bounded, resumable reconciliation run with checkpoint and counters (D7)', () => {
    expect(getColumnNames(LedgerReconciliationRun)).toEqual(
      expect.arrayContaining([
        'scopeHash',
        'scope',
        'status',
        'checkpoint',
        'counters',
        'requestedBy',
        'startedAt',
        'completedAt',
        'lastErrorCode',
      ])
    )
  })

  it('persists reconciliation findings deduplicated by fingerprint (D7)', () => {
    expect(getColumnNames(LedgerReconciliationFinding)).toEqual(
      expect.arrayContaining([
        'runId',
        'fingerprint',
        'contractId',
        'aggregateType',
        'aggregateId',
        'eventType',
        'category',
        'expectedHash',
        'observedHash',
        'status',
        'recoveryOutboxId',
        'resolution',
        'firstSeenAt',
        'lastSeenAt',
      ])
    )
    expect(getIndexColumns(LedgerReconciliationFinding)).toContainEqual([
      'fingerprint',
    ])
  })
})
