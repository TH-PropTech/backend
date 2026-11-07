import type { Contract } from '../schemas/contract.schema'
import { resolveEffectiveCommercial } from './resolve-effective-commercial'

/** Mức in trên bố cục dựng sẵn khi hợp đồng không nhập tỷ lệ. */
export const STRUCTURED_LAYOUT_DEFAULT_LATE_PENALTY_RATE = 10

/**
 * Nhánh render văn bản hợp đồng:
 * - `template`: mẫu quản trị (`lease-template.articles.ts`), in đúng giá trị đã nhập, 0 là 0%/năm;
 * - `structured`: bố cục dựng sẵn (Điều 9 của projector), tỷ lệ 0 hoặc trống in ra 10%/năm.
 */
export type LatePenaltyRenderBranch = 'template' | 'structured'

export type LatePenaltyRateOptions = {
  /** Mặc định suy ra từ hợp đồng theo cùng quy tắc chọn mẫu của ContractArtifactService. */
  renderBranch?: LatePenaltyRenderBranch
  /**
   * `effective` (mặc định): điều khoản hiệu lực, gồm phụ lục đã ký, dùng để tính lãi.
   * `signed`: giá trị in trong văn bản gốc đã ký, dùng khi render lại văn bản.
   */
  source?: 'effective' | 'signed'
}

/**
 * Cùng quy tắc chọn mẫu với `ContractArtifactService` và `ContractViewService`: có
 * `contractTemplateRef` hoặc `termsRef` khóa `VN_*` thì dùng mẫu quản trị; còn lại là
 * bố cục dựng sẵn. Artifact của bố cục dựng sẵn mang templateKey là `termsRef.key`
 * (không bắt đầu bằng `VN_`) hoặc `legacy-contract-template`.
 */
export function inferLatePenaltyRenderBranch(
  contract: Pick<Contract, 'contractTemplateRef' | 'termsRef'>
): LatePenaltyRenderBranch {
  return contract.contractTemplateRef ||
    contract.termsRef?.key.startsWith('VN_')
    ? 'template'
    : 'structured'
}

function signedRate(
  contract: Contract,
  branch: LatePenaltyRenderBranch
): number | undefined {
  return branch === 'template'
    ? (contract.commercialDraft?.latePenaltyRate ?? contract.latePenaltyRate)
    : contract.latePenaltyRate
}

/**
 * Nguồn duy nhất của tỷ lệ lãi chậm trả (%/năm): cả renderer văn bản lẫn bộ tính lãi đều
 * gọi hàm này, nên số in ra và số tính luôn là một.
 */
export function resolveLatePenaltyRate(
  contract: Contract,
  options: LatePenaltyRateOptions = {}
): number {
  const branch = options.renderBranch ?? inferLatePenaltyRenderBranch(contract)
  const raw =
    options.source === 'signed'
      ? signedRate(contract, branch)
      : resolveEffectiveCommercial(contract).latePenaltyRate
  return branch === 'template'
    ? (raw ?? 0)
    : raw || STRUCTURED_LAYOUT_DEFAULT_LATE_PENALTY_RATE
}
