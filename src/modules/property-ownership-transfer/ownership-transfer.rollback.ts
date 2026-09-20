import type { OwnershipTransferManifestEntityType } from './ownership-transfer.manifest'

export interface OwnershipTransferRollbackState {
  readonly entityType: OwnershipTransferManifestEntityType
  readonly entityId: string
  readonly targetLandlordId: string
  readonly currentLandlordId: string | null
  readonly expectedAfterVersion: string
  readonly currentVersion: string
}

export interface OwnershipTransferRollbackCheck {
  readonly safe: boolean
  readonly conflicts: readonly string[]
}

const IMMUTABLE_ENTITY_TYPES = new Set<OwnershipTransferManifestEntityType>([
  'contract',
  'depositAgreement',
  'payment',
  'dispute',
])

/**
 * A compensating rollback may only restore operational ownership when no
 * post-transfer mutation has happened. Legal, financial, and ledger records
 * are intentionally excluded from rollback ownership writes.
 */
export function checkOwnershipTransferRollback(
  states: readonly OwnershipTransferRollbackState[]
): OwnershipTransferRollbackCheck {
  const conflicts: string[] = []

  for (const state of states) {
    if (IMMUTABLE_ENTITY_TYPES.has(state.entityType)) continue

    if (state.currentVersion !== state.expectedAfterVersion) {
      conflicts.push(`${state.entityType}/${state.entityId}:version-changed`)
    }
    if (state.currentLandlordId !== state.targetLandlordId) {
      conflicts.push(`${state.entityType}/${state.entityId}:owner-changed`)
    }
  }

  return { safe: conflicts.length === 0, conflicts }
}
