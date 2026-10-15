import type { ContractArtifact } from './contract-artifact.schema'
import type { ContractDocument } from './contract-document.schema'

const CANONICAL_FIELDS = [
  '_id',
  'contractId',
  'revision',
  'templateRef',
  'legalProfile',
  'gridFsFileId',
  'artifactHash',
  'canonicalContentHash',
  'rendererVersion',
  'sourceSchemaVersion',
  'amendmentId',
  'byteLength',
  'contentType',
  'lockedAt',
  'createdAt',
] as const satisfies ReadonlyArray<keyof ContractArtifact>

/**
 * Ánh xạ bản ghi `ContractDocument{kind:'canonical'}` về hình `ContractArtifact`
 * cũ: bỏ `kind`, `updatedAt` và mọi trường của bản đã ký; không thêm khóa nào
 * mà bản ghi không có (giữ `toEqual` với dữ liệu cũ).
 */
export function toContractArtifact(
  document: ContractDocument
): ContractArtifact {
  const source = document as unknown as Record<string, unknown>
  const view: Record<string, unknown> = {}
  for (const field of CANONICAL_FIELDS) {
    if (source[field] !== undefined) view[field] = source[field]
  }
  return view as unknown as ContractArtifact
}
