import type { ApartmentAnalysis } from './apartment-analysis.schema'
import type {
  ConditionFinding,
  OverallCondition,
} from './condition-analysis.schema'
import type {
  AffordabilityStatus,
  ConfidenceLabel,
  EstimateRange,
  OneTimeCostItem,
} from './living-cost-profile.schema'

/** Bản ghi kind='condition' với các trường bắt buộc của hình `ConditionAnalysis` cũ. */
export type ConditionAnalysisRow = ApartmentAnalysis & {
  kind: 'condition'
  apartmentId: string
  imageUrl: string
  imageStorageKey: string
  findings: ConditionFinding[]
  overallCondition: OverallCondition
  checklist: string[]
  model: string
  isPrivate: boolean
}

/** Hình JSON cũ của ConditionAnalysis (không có `kind`, không có `updatedAt`). */
export type ConditionAnalysisView = Omit<
  ConditionAnalysisRow,
  'kind' | 'updatedAt'
>

/** Bản ghi kind='living-cost' với các trường bắt buộc của hình `LivingCostProfile` cũ. */
export type LivingCostRow = ApartmentAnalysis & {
  kind: 'living-cost'
  name: string
  monthlyRent: number
  serviceFee: number
  parkingFee: number
  internetFee: number
  electricityEstimate: EstimateRange
  waterEstimate: EstimateRange
  oneTimeCosts: OneTimeCostItem[]
  occupants: number
  totalEstimate: EstimateRange
  affordabilityStatus: AffordabilityStatus
  confidenceLabel: ConfidenceLabel
}

/** Hình JSON cũ của LivingCostProfile (không có `kind`). */
export type LivingCostProfileView = Omit<LivingCostRow, 'kind'>

const CONDITION_FIELDS = [
  '_id',
  'userId',
  'apartmentId',
  'imageUrl',
  'imageStorageKey',
  'findings',
  'overallCondition',
  'checklist',
  'model',
  'isPrivate',
  'createdAt',
] as const satisfies ReadonlyArray<keyof ConditionAnalysisView>

const LIVING_COST_FIELDS = [
  '_id',
  'userId',
  'name',
  'apartmentId',
  'monthlyRent',
  'serviceFee',
  'parkingFee',
  'internetFee',
  'electricityEstimate',
  'waterEstimate',
  'commuteEstimate',
  'oneTimeCosts',
  'occupants',
  'monthlyBudget',
  'totalEstimate',
  'affordabilityStatus',
  'confidenceLabel',
  'createdAt',
  'updatedAt',
] as const satisfies ReadonlyArray<keyof LivingCostProfileView>

/** Chỉ giữ các trường đã có giá trị (khác undefined) để JSON khớp bản ghi cũ. */
function pick<T>(source: object, fields: ReadonlyArray<string>): T {
  const record = source as Record<string, unknown>
  const view: Record<string, unknown> = {}
  for (const field of fields) {
    if (record[field] !== undefined) view[field] = record[field]
  }
  return view as T
}

/** Ánh xạ bản ghi `kind='condition'` về hình `ConditionAnalysis` cũ. */
export function toConditionAnalysisView(
  row: ApartmentAnalysis
): ConditionAnalysisView {
  return pick<ConditionAnalysisView>(row, CONDITION_FIELDS)
}

/** Ánh xạ bản ghi `kind='living-cost'` về hình `LivingCostProfile` cũ. */
export function toLivingCostProfileView(
  row: ApartmentAnalysis
): LivingCostProfileView {
  return pick<LivingCostProfileView>(row, LIVING_COST_FIELDS)
}
