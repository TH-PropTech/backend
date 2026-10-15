import type { ContractTemplate } from '../schemas/contract-template.schema'

/** Hình phản hồi mẫu hợp đồng: không lộ `kind` (phân loại nội bộ template/layout). */
export type ContractTemplateResponse = Omit<ContractTemplate, 'kind'>

/**
 * Bỏ `kind` khỏi dòng `contract_templates` trước khi trả API. Các trường khác giữ nguyên
 * (khóa undefined không được sinh ra, giống khi serialize entity).
 */
export function toContractTemplateResponse(
  row: ContractTemplate
): ContractTemplateResponse {
  const { kind: _kind, ...rest } = row
  void _kind
  return rest
}
