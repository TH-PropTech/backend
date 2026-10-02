export const RENTAL_FLOW_E2E_INDEX_MIGRATION_ID = '005-rental-flow-e2e-indexes'

type IndexKeys = Record<string, 1 | -1>

export interface MongoIndexCollection {
  createIndex(
    keys: IndexKeys,
    options?: { name?: string; unique?: boolean; sparse?: boolean }
  ): Promise<string>
}

export interface RentalFlowMongoDatabase {
  collection(name: string): MongoIndexCollection
}

const INDEXES: Array<{
  collection: string
  keys: IndexKeys
  options?: { name?: string; unique?: boolean; sparse?: boolean }
}> = [
  {
    collection: 'payments',
    keys: { contractId: 1, type: 1, periodKey: 1 },
    options: { name: 'payments_contract_type_period_unique', unique: true },
  },
  {
    collection: 'payment_attempts',
    keys: { provider: 1, txRef: 1 },
    options: { name: 'payment_attempts_provider_txref_unique', unique: true },
  },
  {
    collection: 'platform_fee_schedules',
    keys: { scheduleId: 1, version: 1 },
    options: {
      name: 'platform_fee_schedules_schedule_version_unique',
      unique: true,
    },
  },
  {
    collection: 'platform_fee_schedules',
    keys: { status: 1, effectiveFrom: 1 },
    options: { name: 'platform_fee_schedules_status_effective' },
  },
  {
    collection: 'platform_fee_audits',
    keys: { scheduleId: 1, createdAt: 1 },
    options: { name: 'platform_fee_audits_schedule_created' },
  },
  {
    collection: 'move_in_settlements',
    keys: { contractId: 1 },
    options: { name: 'move_in_settlements_contract_unique', unique: true },
  },
  {
    collection: 'contract_layout_profiles',
    keys: { profileKey: 1, version: 1 },
    options: {
      name: 'contract_layout_profiles_profile_version_unique',
      unique: true,
    },
  },
  {
    collection: 'contract_layout_profiles',
    keys: { profileKey: 1, status: 1 },
    options: { name: 'contract_layout_profiles_profile_status' },
  },
  {
    collection: 'contract_layout_profiles',
    keys: { legalProfile: 1, status: 1, templateKey: 1 },
    options: { name: 'contract_layout_profiles_legal_status_template' },
  },
  {
    collection: 'contract_layout_audits',
    keys: { profileKey: 1, version: 1, createdAt: 1 },
    options: { name: 'contract_layout_audits_profile_version_created' },
  },
  {
    collection: 'rental_transaction_events',
    keys: { transitionKey: 1 },
    options: {
      name: 'rental_transaction_events_transition_unique',
      unique: true,
    },
  },
  {
    collection: 'rental_transaction_events',
    keys: { applicationId: 1, occurredAt: 1 },
    options: { name: 'rental_transaction_events_application_occurred' },
  },
  {
    collection: 'rental_transaction_events',
    keys: { contractId: 1, occurredAt: 1 },
    options: { name: 'rental_transaction_events_contract_occurred' },
  },
  {
    collection: 'ledger_outbox',
    keys: { aggregateType: 1, aggregateId: 1, eventType: 1 },
    options: { name: 'ledger_outbox_aggregate_event_unique', unique: true },
  },
  {
    collection: 'ledger_outbox',
    keys: { status: 1, nextRetryAt: 1, leaseExpiresAt: 1 },
    options: { name: 'ledger_outbox_status_retry_lease' },
  },
  {
    collection: 'contract_artifacts',
    keys: { contractId: 1, revision: 1, amendmentId: 1 },
    options: {
      name: 'contract_artifacts_contract_revision_amendment_unique',
      unique: true,
    },
  },
]

export async function ensureRentalFlowE2EIndexes(
  database: RentalFlowMongoDatabase
): Promise<number> {
  for (const index of INDEXES) {
    await database
      .collection(index.collection)
      .createIndex(index.keys, index.options)
  }
  return INDEXES.length
}
