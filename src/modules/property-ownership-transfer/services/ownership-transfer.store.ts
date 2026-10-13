import type { OwnershipTransferManifestRecord } from '../utils/ownership-transfer.manifest'
import type { OwnershipTransferFinalReport } from '../schemas/property-ownership-transfer.schema'

export const OWNERSHIP_TRANSFER_STORE = Symbol('OWNERSHIP_TRANSFER_STORE')

export interface OwnershipTransferApplyInput {
  readonly transferId: string
  readonly targetLandlordId: string
  readonly idempotencyKey: string
  readonly records: readonly OwnershipTransferManifestRecord[]
  readonly expectedPreviewHash: string
}

export interface OwnershipTransferStore {
  apply(
    input: OwnershipTransferApplyInput
  ): Promise<OwnershipTransferFinalReport>
}

export class OwnershipTransferTransactionUnavailableError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'OwnershipTransferTransactionUnavailableError'
  }
}

export class OwnershipTransferApplyConflictError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'OwnershipTransferApplyConflictError'
  }
}

export function isTransactionUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('transaction numbers are only allowed') ||
    message.includes('transactions are not supported') ||
    message.includes('replica set') ||
    message.includes('transaction is not supported')
  )
}
