export interface TrustItemDto {
  key: 'landlord-kyc' | 'ownership' | 'listing-verified' | 'ledger' | 'record'
  label: string
  ok: boolean
  points: number
  maxPoints: number
}

export interface TrustScoreDto {
  score: number
  items: TrustItemDto[]
}

export interface PriceTrendSeriesDto {
  /** Nhãn tháng `YYYY-MM`, cũ → mới. */
  months: string[]
  /** Giá thuê/tháng (VND) của căn này; null khi tin chưa tồn tại tháng đó. */
  apartment: Array<number | null>
  project: Array<number | null> | null
  district: Array<number | null> | null
  projectName: string | null
  districtName: string | null
  projectSampleCount: number
  districtSampleCount: number
}

export interface ApartmentInsightsResponseDto {
  priceTrend: PriceTrendSeriesDto
  trust: TrustScoreDto
}
