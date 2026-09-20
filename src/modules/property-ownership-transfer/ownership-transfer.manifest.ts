import { createHash } from 'node:crypto'

export const OWNERSHIP_TRANSFER_SCHEMA_VERSION = '1'

export type OwnershipTransferManifestEntityType =
  | 'apartment'
  | 'booking'
  | 'rentalApplication'
  | 'contract'
  | 'depositAgreement'
  | 'payment'
  | 'dispute'

export interface OwnershipTransferManifestRecordInput {
  readonly entityType: OwnershipTransferManifestEntityType
  readonly entityId: string
  readonly fromLandlordId: string
  readonly version: string
}

export interface OwnershipTransferManifestRecord extends OwnershipTransferManifestRecordInput {
  readonly toLandlordId: string
}

export interface OwnershipTransferManifestInput {
  readonly targetLandlordId: string
  readonly records: readonly OwnershipTransferManifestRecordInput[]
}

export interface OwnershipTransferManifest {
  readonly schemaVersion: string
  readonly targetLandlordId: string
  readonly sourceOwnerIds: readonly string[]
  readonly records: readonly OwnershipTransferManifestRecord[]
}

export interface OwnershipTransferManifestResult {
  readonly manifest: OwnershipTransferManifest
  readonly previewHash: string
}

export function normalizeOwnershipTransferEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function createOwnershipTransferManifest(
  input: OwnershipTransferManifestInput
): OwnershipTransferManifestResult {
  const records = [...input.records]
    .map(record => ({
      ...record,
      toLandlordId: input.targetLandlordId,
    }))
    .sort((left, right) => {
      const entityOrder = left.entityType.localeCompare(right.entityType)
      return entityOrder !== 0
        ? entityOrder
        : left.entityId.localeCompare(right.entityId)
    })

  const sourceOwnerIds = [
    ...new Set(records.map(record => record.fromLandlordId)),
  ].sort()
  const manifest: OwnershipTransferManifest = {
    schemaVersion: OWNERSHIP_TRANSFER_SCHEMA_VERSION,
    targetLandlordId: input.targetLandlordId,
    sourceOwnerIds,
    records,
  }

  const canonicalManifest = JSON.stringify(manifest)
  const previewHash = `sha256:${createHash('sha256')
    .update(canonicalManifest, 'utf8')
    .digest('hex')}`

  return { manifest, previewHash }
}
