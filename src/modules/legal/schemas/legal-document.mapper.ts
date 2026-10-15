import type { LegalSourceKind } from '../utils/legal-sources.types'
import type { LegalSource } from './legal-source.schema'
import type { SourceLegalDocument } from './legal-document.schema'

/**
 * Ánh xạ bản ghi `LegalDocument{kind:'source'}` về hình `LegalSource` cũ: bỏ
 * discriminator `kind`, trả `docKind` về `kind` (LegalSourceKind) để DTO/response
 * giữ nguyên JSON.
 */
export function toLegacyLegalSource(doc: SourceLegalDocument): LegalSource {
  const { kind: _discriminator, docKind, ...rest } = doc
  void _discriminator
  return { ...rest, kind: docKind }
}

/** Đổi `kind` (LegalSourceKind, hình DTO/seed cũ) sang `docKind` của bản ghi hợp nhất. */
export function toSourceDocumentFields<T extends { kind?: LegalSourceKind }>(
  input: T
): Omit<T, 'kind'> & { docKind?: LegalSourceKind } {
  const { kind, ...rest } = input
  return kind === undefined ? rest : { ...rest, docKind: kind }
}
