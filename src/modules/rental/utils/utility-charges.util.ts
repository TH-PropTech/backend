import { BadRequestException } from '@nestjs/common'
import type { UtilityRates } from '../../properties/utils/rental-package.util'

type Meter = { electricity: number; water: number }
type MeterPhotoSet = { electricity: string[]; water: string[] }

/** Mỗi dòng khấu trừ nhận tối đa 5 ảnh; lấy 2 ảnh mỗi biên bản để không vượt trần. */
const PHOTOS_PER_RECORD = 2

export type UtilityChargeKind = 'electricity' | 'water' | 'service'

export type UtilityChargeSuggestion = {
  kind: UtilityChargeKind
  reason: string
  amount: number
  evidenceUrls: string[]
  source: 'meter-suggestion'
}

export type UtilityChargeNote =
  | 'NO_RATES'
  | 'NO_MOVE_IN_READINGS'
  | 'ELECTRICITY_READING_REGRESSION'
  | 'WATER_READING_REGRESSION'
  | 'NO_SERVICE_MONTHS'

export type UtilityChargeInput = {
  rates: UtilityRates | null | undefined
  moveIn: Meter | null | undefined
  moveOut: Meter
  moveInPhotos?: MeterPhotoSet | null | undefined
  moveOutPhotos?: MeterPhotoSet | null | undefined
  /** Số tháng phí dịch vụ chưa thu do Chủ nhà khai báo. */
  unpaidServiceMonths: number
}

const vnd = (value: number): string => value.toLocaleString('vi-VN')

function photosFor(
  kind: 'electricity' | 'water',
  input: UtilityChargeInput
): string[] {
  return [
    ...(input.moveInPhotos?.[kind] ?? []).slice(0, PHOTOS_PER_RECORD),
    ...(input.moveOutPhotos?.[kind] ?? []).slice(0, PHOTOS_PER_RECORD),
  ]
}

function meterLine(
  kind: 'electricity' | 'water',
  input: UtilityChargeInput,
  rate: number
): UtilityChargeSuggestion | UtilityChargeNote | null {
  const before = input.moveIn![kind]
  const after = input.moveOut[kind]
  if (after < before) {
    return kind === 'electricity'
      ? 'ELECTRICITY_READING_REGRESSION'
      : 'WATER_READING_REGRESSION'
  }
  const used = after - before
  const amount = Math.round(used * rate)
  if (amount <= 0) return null
  const label = kind === 'electricity' ? 'điện' : 'nước'
  const unit = kind === 'electricity' ? 'kWh' : 'm³'
  return {
    kind,
    reason: `Tiền ${label}: chỉ số đầu ${before}, chỉ số cuối ${after}, tiêu thụ ${used} ${unit} x ${vnd(rate)} đồng/${unit}`,
    amount,
    evidenceUrls: photosFor(kind, input),
    source: 'meter-suggestion',
  }
}

/**
 * Gợi ý các dòng khấu trừ điện, nước, dịch vụ từ chỉ số công tơ và đơn giá hai bên
 * đã thỏa thuận trong hợp đồng. Chỉ tính toán, không ghi gì; Chủ nhà sửa trước khi gửi.
 */
export function buildUtilityChargeSuggestions(input: UtilityChargeInput): {
  lines: UtilityChargeSuggestion[]
  notes: UtilityChargeNote[]
} {
  const lines: UtilityChargeSuggestion[] = []
  const notes: UtilityChargeNote[] = []
  const { rates } = input
  if (!rates) return { lines, notes: ['NO_RATES'] }

  if (!input.moveIn) {
    notes.push('NO_MOVE_IN_READINGS')
  } else {
    const rateByKind = {
      electricity: rates.electricityPerKwh,
      water: rates.waterPerM3,
    } as const
    for (const kind of ['electricity', 'water'] as const) {
      const result = meterLine(kind, input, rateByKind[kind])
      if (result === null) continue
      if (typeof result === 'string') notes.push(result)
      else lines.push(result)
    }
  }

  if (rates.serviceFeeMonthly > 0) {
    if (input.unpaidServiceMonths > 0) {
      lines.push({
        kind: 'service',
        reason: `Phí dịch vụ ${input.unpaidServiceMonths} tháng chưa thu x ${vnd(rates.serviceFeeMonthly)} đồng/tháng`,
        amount: rates.serviceFeeMonthly * input.unpaidServiceMonths,
        evidenceUrls: [],
        source: 'meter-suggestion',
      })
    } else {
      notes.push('NO_SERVICE_MONTHS')
    }
  }
  return { lines, notes }
}

/** Ảnh công tơ chỉ được lấy từ kho ảnh của hệ thống (đường tải lên của căn hộ). */
export function assertMeterPhotosHosted(
  storage: { isOwnPublicUrl(url: string): boolean } | undefined,
  photos: MeterPhotoSet | undefined
): void {
  if (!storage || !photos) return
  const urls = [...photos.electricity, ...photos.water]
  if (urls.some(url => !storage.isOwnPublicUrl(url))) {
    throw new BadRequestException(
      'Ảnh công tơ phải được tải lên từ hệ thống. Vui lòng tải lại ảnh.'
    )
  }
}
