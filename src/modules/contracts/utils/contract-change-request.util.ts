import { BadRequestException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import type { ContractCommercialDraft } from '../schemas/contract.schema'
import type { ContractChangeRequestChange } from '../schemas/contract-change-request.schema'
import { MAX_CUSTOM_CLAUSES_LENGTH } from '../legal/lease-compliance.validator'

/** Số ngày một yêu cầu chỉnh sửa được chờ bên còn lại trả lời. */
export const CHANGE_REQUEST_TTL_DAYS = 7

export const CHANGE_REQUEST_FIELDS = new Set<keyof ContractCommercialDraft>([
  'monthlyRent',
  'deposit',
  'durationMonths',
  'paymentDay',
  'latePenaltyRate',
  'terminationNoticeDays',
  'utilities',
  'handoverNotes',
  'inventoryReference',
  'customClauses',
])

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Áp các thay đổi lên bản sao của bản nháp; field ngoài danh sách cho phép bị từ chối. */
export function applyChangeRequest(
  before: ContractCommercialDraft,
  changes: Array<{ field: string; after: unknown }>
): ContractCommercialDraft {
  const next = JSON.parse(JSON.stringify(before)) as Record<string, unknown>
  for (const change of changes) {
    if (
      !CHANGE_REQUEST_FIELDS.has(change.field as keyof ContractCommercialDraft)
    )
      throw new BadRequestException('CONTRACT_CHANGE_FIELD_NOT_ALLOWED')
    if (change.after === undefined)
      throw new BadRequestException('CONTRACT_CHANGE_VALUE_REQUIRED')
    next[change.field] = change.after
  }
  const clauses = next['customClauses']
  if (
    clauses !== undefined &&
    clauses !== null &&
    (typeof clauses !== 'string' || clauses.length > MAX_CUSTOM_CLAUSES_LENGTH)
  )
    throw new BadRequestException('CONTRACT_CHANGE_CLAUSES_INVALID')
  return next as ContractCommercialDraft
}

/** Chỉ giữ trường thực sự đổi, kèm giá trị trước và sau. */
export function diffCommercial(
  before: ContractCommercialDraft,
  after: ContractCommercialDraft
): ContractChangeRequestChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys]
    .filter(key =>
      CHANGE_REQUEST_FIELDS.has(key as keyof ContractCommercialDraft)
    )
    .filter(
      key =>
        !sameValue(
          before[key as keyof ContractCommercialDraft],
          after[key as keyof ContractCommercialDraft]
        )
    )
    .map(key => ({
      field: key,
      before: before[key as keyof ContractCommercialDraft] ?? null,
      after: after[key as keyof ContractCommercialDraft] ?? null,
    }))
}

export function hashCommercial(input: ContractCommercialDraft): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}
