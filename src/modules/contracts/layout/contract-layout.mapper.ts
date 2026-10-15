import type { ContractLayoutProfile } from '../schemas/contract-layout-profile.schema'
import type { ContractTemplate } from '../schemas/contract-template.schema'

/** Đúng các khóa của hình `ContractLayoutProfile` cũ (không có `kind` và trường riêng của mẫu). */
const LAYOUT_RESPONSE_KEYS = [
  '_id',
  'profileKey',
  'version',
  'status',
  'legalProfile',
  'templateKey',
  'blocks',
  'supplementaryClauses',
  'disclosures',
  'contentHash',
  'draftRevision',
  'createdBy',
  'updatedBy',
  'publishedBy',
  'publishedAt',
  'createdAt',
  'updatedAt',
] as const satisfies ReadonlyArray<keyof ContractTemplate>

/**
 * G-LAY: dòng `contract_templates` có kind='layout' -> hình JSON cũ của
 * `ContractLayoutProfile` (bỏ `kind`). Khóa undefined bị bỏ, null giữ nguyên,
 * giống khi serialize entity cũ.
 */
export function toContractLayoutProfile(
  row: ContractTemplate
): ContractLayoutProfile {
  const out: Record<string, unknown> = {}
  for (const key of LAYOUT_RESPONSE_KEYS) {
    if (row[key] !== undefined) out[key] = row[key]
  }
  return out as unknown as ContractLayoutProfile
}
